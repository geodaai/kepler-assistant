/**
 * The single `geoda.analysis` command consolidating ALL GeoDa operations.
 *
 * Per the migration design, every GeoDa feature (spatial weights, LISA, global
 * Moran, spatial regression, data classification, rate, standardization,
 * thiessen polygons, MST, cartogram) is exposed as ONE RoomCommand whose input
 * is a `z.discriminatedUnion('analysis', [...])` — the same pattern `executeApi`
 * uses for `apiName`. The model picks the operation via the `analysis` field:
 *
 *   executeApi({
 *     call: { apiName: "executeCommand", args: { commandId: "geoda.analysis", input: { analysis: "lisa", datasetName, variableName, method, weightsId } } },
 *     reasoning: "Run LISA on the income variable"
 *   })
 *
 * The geometry ops (area/buffer/centroid/dissolve/length/perimeter/spatial-join)
 * are intentionally NOT here — the LLM writes the DuckDB spatial SQL and runs it
 * via `geo.spatial-query` (see `geo-commands.ts`).
 *
 * The GeoDa compute lives in the shared kepler-assistant `AnalysisEngine` (the
 * same engine the MCP service exposes); this command is a thin shim that keeps
 * the registry shape (zod schema, metadata, description, output contract) stable
 * while delegating execution to the engine. Two small responsibilities stay in
 * the shim:
 *
 *  - the `weightsId → neighbor list` cache: the engine returns `weights` (the
 *    neighbor list) from `spatial-weights` and the LISA / global-moran /
 *    regression ops accept `weights` directly, so the shim keeps the ID-based
 *    contract the model knows and resolves it before delegating;
 *  - per-operation output shaping so `rate` / `standardize` still report
 *    `count` and `classify` reports `breaks` (the model + harness contract).
 *
 * The `AnalysisInput` discriminated union (with its custom "Missing or invalid
 * required field" error) is kept verbatim: the room-store registry validates
 * input against it before `execute` runs, which is what produces the actionable
 * missing-`analysis` message.
 */

import type {RoomCommand} from '@sqlrooms/room-store';
import {z} from 'zod';
import {runAnalysis} from '../analysis';
import type {KeplerContext} from '../mcp';

/**
 * Neighbor lists returned by the engine's `spatial-weights`, cached by the
 * `weightsId` the engine reports (`<datasetName>-<type>`). LISA / global-moran
 * / regression take the neighbor list directly, so the shim resolves the
 * model-facing `weightsId` back to `weights` before delegating.
 */
const globalWeightsCache: Record<string, number[][]> = {};

/**
 * Discriminated-union input schema for `geoda.analysis`. Each operation carries
 * only the fields it needs; the `analysis` field selects the operation.
 */
const AnalysisInput = z.discriminatedUnion(
  'analysis',
  [
  z.object({
    analysis: z.literal('spatial-weights'),
    datasetName: z.string(),
    type: z.enum(['queen', 'rook', 'knn', 'threshold']),
    k: z.number().optional().describe('Number of neighbors for knn weights'),
    orderOfContiguity: z.number().optional(),
    includeLowerOrder: z.boolean().optional(),
    precisionThreshold: z.number().optional(),
    distanceThreshold: z
      .number()
      .optional()
      .describe('Distance threshold for threshold-based weights'),
    isMile: z.boolean().optional(),
    useCentroids: z.boolean().optional()
  }),
  z.object({
    analysis: z.literal('lisa'),
    datasetName: z.string(),
    variableName: z.string(),
    method: z
      .enum(['localMoran', 'localGeary', 'localG', 'localGStar', 'quantileLisa'])
      .describe('The LISA method to use'),
    weightsId: z.string().optional().describe('ID of spatial weights to use'),
    permutation: z.number().optional().describe('Number of permutations (default 999)'),
    significanceThreshold: z
      .number()
      .optional()
      .describe('Significance threshold for filtering results (default 0.05)'),
    k: z.number().optional().describe('Number of quantiles for quantile LISA'),
    quantile: z.number().optional().describe('Quantile value for quantile LISA')
  }),
  z.object({
    analysis: z.literal('global-moran'),
    datasetName: z.string(),
    variableName: z.string(),
    weightsId: z
      .string()
      .optional()
      .describe('ID of spatial weights. If not provided, create weights first.')
  }),
  z.object({
    analysis: z.literal('regression'),
    datasetName: z.string(),
    dependentVariable: z.string(),
    independentVariables: z.array(z.string()),
    modelType: z.enum(['classic', 'spatial-lag', 'spatial-error']),
    weightsId: z
      .string()
      .optional()
      .describe('ID of spatial weights (required for spatial models)')
  }),
  z.object({
    analysis: z.literal('classify'),
    datasetName: z.string(),
    variableName: z.string(),
    method: z.enum([
      'quantile',
      'natural breaks',
      'equal interval',
      'percentile',
      'box',
      'standard deviation',
      'unique values'
    ]),
    k: z
      .number()
      .optional()
      .describe('Number of bins (required for quantile, natural breaks, equal interval)'),
    hinge: z.number().optional().describe('Hinge value for box method (default 1.5)')
  }),
  z.object({
    analysis: z.literal('rate'),
    datasetName: z.string(),
    eventVariable: z.string(),
    baseVariable: z.string(),
    method: z
      .enum(['excessRisk', 'empiricalBayes'])
      .optional()
      .describe('Rate method (default: excessRisk)'),
    outputDatasetName: z.string()
  }),
  z.object({
    analysis: z.literal('standardize'),
    datasetName: z.string(),
    variableName: z.string(),
    method: z.enum([
      'deviationFromMean',
      'standardizeMAD',
      'rangeAdjust',
      'rangeStandardize',
      'standardize'
    ]),
    outputDatasetName: z.string()
  }),
  z.object({
    analysis: z.literal('thiessen-polygons'),
    datasetName: z.string(),
    outputDatasetName: z.string()
  }),
  z.object({
    analysis: z.literal('mst'),
    datasetName: z.string(),
    outputDatasetName: z.string()
  }),
  z.object({
    analysis: z.literal('cartogram'),
    datasetName: z.string(),
    weightVariable: z.string().describe('Property name to use as weight'),
    iterations: z
      .number()
      .optional()
      .describe('Number of iterations for cartogram optimization (default 100)'),
    outputDatasetName: z.string()
  })
  ],
  {
    // The model frequently omits the `analysis` discriminator entirely. The
    // default Zod message ("Invalid discriminator value. Expected ...") reads
    // as if the value were wrong when it is actually missing — say exactly what
    // to do instead.
    error: issue => ({
      message: `Missing or invalid required field "analysis". Must be one of: ${
        'options' in issue ? (issue.options as string[]).map(String).join(', ') : 'see the command description'
      }`
    })
  }
);

/** Resolve a `weightsId` to the engine's neighbor list, or undefined. */
function getCachedWeights(weightsId?: string): number[][] | undefined {
  return weightsId ? globalWeightsCache[weightsId] : undefined;
}

/** Shape the engine result for the model / harness per operation. */
function shapeOutput(analysis: string, data: Record<string, any>): Record<string, unknown> {
  switch (analysis) {
    case 'spatial-weights':
      // The neighbor list is cached for follow-up ops; the model sees the
      // weightsId + meta, not the raw matrix.
      return {weightsId: data.weightsId, weightsMeta: data.weightsMeta, details: data.details};
    case 'lisa': {
      // Back-compat fields the old command computed: globalMoranI (localMoran
      // only) and the significance threshold.
      const globalMoranI =
        data.method === 'localMoran' && Array.isArray(data.lisaValues) && data.lisaValues.length
          ? data.lisaValues.reduce((a: number, b: number) => a + b, 0) / data.lisaValues.length
          : null;
      return {
        ...(globalMoranI != null ? {globalMoranI} : {}),
        datasetName: data.datasetName,
        variableName: data.variableName,
        method: data.method,
        significanceThreshold: data.significanceThreshold ?? 0.05,
        clusterColorAndLabels: data.clusterColorAndLabels,
        totalObservations: data.totalObservations,
        details: data.details
      };
    }
    case 'global-moran':
      return {
        globalMoranI: data.globalMoranI,
        details: data.details,
        datasetName: data.datasetName,
        variableName: data.variableName,
        totalObservations: data.totalObservations
      };
    case 'regression':
      // Keep the old `result` aggregate key the model relied on.
      return {
        modelType: data.modelType,
        dependentVariable: data.dependentVariable,
        independentVariables: data.independentVariables,
        result: {
          observations: data.observations,
          rSquared: data.rSquared,
          adjustedRSquared: data.adjustedRSquared,
          coefficients: data.coefficients
        },
        details: data.details
      };
    case 'classify':
      return {
        datasetName: data.datasetName,
        variableName: data.variableName,
        method: data.method,
        breaks: data.breaks,
        details: data.details
      };
    case 'rate':
    case 'standardize':
      return {
        datasetName: data.datasetName,
        method: data.method,
        outputDatasetName: data.outputDatasetName,
        outputVariableName: data.outputVariableName,
        count: Array.isArray(data.result) ? data.result.length : 0,
        details: data.details
      };
    case 'thiessen-polygons':
      return {outputDatasetName: data.outputDatasetName, featureCount: data.featureCount, details: data.details};
    case 'mst':
      return {outputDatasetName: data.outputDatasetName, edgeCount: data.edgeCount, details: data.details};
    case 'cartogram':
      return {outputDatasetName: data.outputDatasetName, featureCount: data.featureCount, details: data.details};
    default:
      return {...data};
  }
}

export function getGeodaAnalysisCommand(_ctx: KeplerContext): RoomCommand {
  return {
    id: 'geoda.analysis',
    name: 'GeoDa spatial analysis',
    group: 'GeoDa',
    description:
      'Run any GeoDa spatial analysis operation: spatial-weights, lisa, global-moran, regression, classify, rate, standardize, thiessen-polygons, mst, cartogram. Pick the operation via the "analysis" field.',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: AnalysisInput as any,
    execute: async (_execCtx, input) => {
      const args = input as z.infer<typeof AnalysisInput>;
      try {
        // The engine implements localMoran/localGeary for LISA; the other
        // methods from the schema would silently fall back to localMoran, so
        // reject them explicitly instead of returning wrong results.
        if (args.analysis === 'lisa' && !['localMoran', 'localGeary'].includes(args.method)) {
          return {
            success: false,
            commandId: 'geoda.analysis',
            error: `LISA method "${args.method}" is not supported by the shared analysis engine. Use localMoran or localGeary.`
          };
        }

        // Resolve weightsId → neighbor list for the ops that consume one.
        const engineArgs: Record<string, unknown> = {...(args as Record<string, unknown>)};
        if (['lisa', 'global-moran'].includes(args.analysis) && args.analysis) {
          const weights = getCachedWeights((args as {weightsId?: string}).weightsId);
          if (!weights) {
            return {
              success: false,
              commandId: 'geoda.analysis',
              error:
                'Weights not found. Please create spatial weights first using the geoda.analysis spatial-weights operation.'
            };
          }
          engineArgs.weights = weights;
        } else if (args.analysis === 'regression') {
          if (args.weightsId) {
            const weights = getCachedWeights(args.weightsId);
            if (!weights) {
              return {
                success: false,
                commandId: 'geoda.analysis',
                error:
                  'Weights not found. Please create spatial weights first using the geoda.analysis spatial-weights operation.'
              };
            }
            engineArgs.weights = weights;
          } else if (args.modelType !== 'classic') {
            return {
              success: false,
              commandId: 'geoda.analysis',
              error: 'Weights are required for spatial-lag or spatial-error models'
            };
          }
        }

        const result = await runAnalysis('geoda.analysis', engineArgs);
        if (!result.success) {
          return {success: false, commandId: 'geoda.analysis', error: result.error};
        }
        const data = (result.data ?? {}) as Record<string, any>;

        // Cache the neighbor list the engine just built so follow-up ops can
        // resolve the returned weightsId.
        if (args.analysis === 'spatial-weights' && Array.isArray(data.weights)) {
          globalWeightsCache[data.weightsId] = data.weights;
        }

        return {
          success: true,
          commandId: 'geoda.analysis',
          data: shapeOutput(args.analysis, data)
        };
      } catch (error) {
        return {
          success: false,
          commandId: 'geoda.analysis',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  };
}
