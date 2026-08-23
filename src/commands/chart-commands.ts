/**
 * Chart commands — the five analytical tools (histogram, boxplot, scatterplot,
 * bubble, pcp) exposed as `RoomCommand`s routed through `executeApi`.
 *
 * The chart compute lives in the shared kepler-assistant `AnalysisEngine` (the
 * same engine the MCP service exposes); these commands are thin shims that keep
 * the registry shape (zod schema, metadata, description) stable while delegating
 * execution to the engine and re-mapping the engine's `table`/`column` naming
 * back to the app's `datasetName`/`variableName` contract.
 *
 * The histogram renderer is dispatched by `commandId` rather than tool name —
 * see `tools/echarts-renderers.tsx` (`getEchartsToolRenderers` registers an
 * `executeApi` renderer that checks `output.commandId === 'chart.histogram'`).
 * The engine returns the renderer-only payload (`histogramData`, `barDataIndexes`,
 * `source`) under `data.__ui` so an MCP adapter can strip it; `barDataIndexes`
 * survives through `result.data` so the renderer can use it for brush-selection
 * → map highlighting.
 */

import type {RoomCommand} from '@sqlrooms/room-store';
import {z} from 'zod';
import {runAnalysis} from '../analysis';

/** A chart.* shim: delegate to the engine, then shape the output. */
function shim(
  meta: {id: string; name: string; group: string; keywords?: string[]},
  inputSchema: z.ZodType,
  tool: string,
  toInput: (input: any) => Record<string, unknown>,
  toOutput: (data: any) => Record<string, unknown>
): RoomCommand {
  return {
    id: meta.id,
    name: meta.name,
    group: meta.group,
    keywords: meta.keywords,
    description: `Generate a ${meta.name.toLowerCase()} for numeric variables in a dataset. Delegates to the shared analysis engine.`,
    metadata: {readOnly: true, riskLevel: 'low', idempotent: true},
    inputSchema: inputSchema as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis(tool, toInput(input ?? {}));
        if (!result.success) {
          return {success: false, commandId: meta.id, error: result.error};
        }
        return {success: true, commandId: meta.id, data: toOutput(result.data ?? {})};
      } catch (error) {
        return {
          success: false,
          commandId: meta.id,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}

/**
 * Build the five chart commands. Returns a map keyed by command id (e.g.
 * `chart.histogram`) for flat-merge into the catalog.
 */
export function getChartCommands(): Record<string, RoomCommand> {
  const histogram: RoomCommand = shim(
    {
      id: 'chart.histogram',
      name: 'Histogram',
      group: 'Chart',
      keywords: ['histogram', 'distribution', 'frequency', 'bin']
    },
    z.object({
      datasetName: z.string().describe('The name of the dataset'),
      variableName: z.string().describe('The name of the numeric variable'),
      numberOfBins: z
        .number()
        .optional()
        .describe('Number of bins for the histogram. Default is 7.')
    }),
    'chart.histogram',
    ({datasetName, variableName, numberOfBins}) => ({
      table: datasetName,
      column: variableName,
      bins: numberOfBins
    }),
    d => ({
      datasetName: d.table,
      variableName: d.column,
      numberOfBins: d.bins,
      totalValues: d.totalValues,
      details: d.details,
      __ui: d.__ui
    })
  );

  const boxplot: RoomCommand = shim(
    {
      id: 'chart.boxplot',
      name: 'Boxplot',
      group: 'Chart',
      keywords: ['boxplot', 'quartile', 'iqr', 'outlier']
    },
    z.object({
      datasetName: z.string().describe('The name of the dataset'),
      variableNames: z
        .array(z.string())
        .describe('The names of the numeric variables to create boxplots for')
    }),
    'chart.boxplot',
    ({datasetName, variableNames}) => ({table: datasetName, variableNames}),
    d => ({
      datasetName: d.table,
      variables: d.variables,
      boxplots: d.boxplots,
      __ui: d.__ui
    })
  );

  const scatterplot: RoomCommand = shim(
    {
      id: 'chart.scatterplot',
      name: 'Scatterplot',
      group: 'Chart',
      keywords: ['scatterplot', 'correlation', 'scatter']
    },
    z.object({
      datasetName: z.string().describe('The name of the dataset'),
      xVariableName: z.string().describe('X-axis variable'),
      yVariableName: z.string().describe('Y-axis variable')
    }),
    'chart.scatterplot',
    ({datasetName, xVariableName, yVariableName}) => ({
      table: datasetName,
      xVariableName,
      yVariableName
    }),
    d => ({
      datasetName: d.table,
      xVariableName: d.xVariableName,
      yVariableName: d.yVariableName,
      totalPoints: d.totalPoints,
      correlation: d.correlation,
      xStats: d.xStats,
      yStats: d.yStats
    })
  );

  const bubble: RoomCommand = shim(
    {
      id: 'chart.bubble',
      name: 'Bubble chart',
      group: 'Chart',
      keywords: ['bubble', 'chart', 'three variables']
    },
    z.object({
      datasetName: z.string().describe('The name of the dataset'),
      xVariableName: z.string().describe('X-axis variable'),
      yVariableName: z.string().describe('Y-axis variable'),
      sizeVariableName: z.string().describe('Variable for bubble size')
    }),
    'chart.bubble',
    ({datasetName, xVariableName, yVariableName, sizeVariableName}) => ({
      table: datasetName,
      xVariableName,
      yVariableName,
      sizeVariableName
    }),
    d => ({
      datasetName: d.table,
      xVariableName: d.xVariableName,
      yVariableName: d.yVariableName,
      sizeVariableName: d.sizeVariableName,
      totalPoints: d.totalPoints,
      xStats: d.xStats,
      yStats: d.yStats,
      sizeStats: d.sizeStats
    })
  );

  const pcp: RoomCommand = shim(
    {
      id: 'chart.pcp',
      name: 'Parallel coordinates',
      group: 'Chart',
      keywords: ['parallel coordinates', 'pcp', 'multivariate']
    },
    z.object({
      datasetName: z.string().describe('The name of the dataset'),
      variableNames: z.array(z.string()).describe('The names of the numeric variables to display')
    }),
    'chart.pcp',
    ({datasetName, variableNames}) => ({table: datasetName, variableNames}),
    d => ({
      datasetName: d.table,
      variables: d.variables,
      pcp: d.pcp
    })
  );

  return {
    'chart.histogram': histogram,
    'chart.boxplot': boxplot,
    'chart.scatterplot': scatterplot,
    'chart.bubble': bubble,
    'chart.pcp': pcp
  };
}
