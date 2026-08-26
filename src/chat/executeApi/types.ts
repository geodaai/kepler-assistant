/**
 * Handler types for the `executeApi` command dispatcher.
 *
 * Adapted from `spatial-agent/src/skills/executeApi/types.ts`. The harness is
 * kepler-agnostic: handlers dispatch through a `ChatToolSurface`, so no kepler
 * context type is involved here.
 */

import type {ZodType} from 'zod';

/** Everything a handler may read while servicing one `executeApi` call. */
export type ExecuteApiContext<TArgs = unknown> = {
  args: TArgs;
  abortSignal?: AbortSignal;
};

/**
 * Uniform shape for an `executeApi` handler. `argsSchema` validates the raw
 * args; `run` receives a context whose `args` is already typed. Dispatch
 * treats every handler as `ApiHandler` and feeds it an untyped context.
 */
export type ApiHandler = {
  argsSchema: ZodType;
  run: (ctx: ExecuteApiContext) => Promise<ExecuteApiOutput>;
};

/**
 * Builds an `ApiHandler` from a typed `run`. The returned `run` validates the
 * context's `args` with `argsSchema`, so the typed `run` only ever sees args
 * matching its schema while dispatch stays uniform.
 */
export function defineHandler<TArgs>(handler: {
  argsSchema: ZodType<TArgs>;
  run: (ctx: ExecuteApiContext<TArgs>) => Promise<ExecuteApiOutput>;
}): ApiHandler {
  return {
    argsSchema: handler.argsSchema,
    run: ctx => handler.run({...ctx, args: handler.argsSchema.parse(ctx.args)})
  };
}

/**
 * Union of all fields the existing demo-app tools may return. Kept permissive
 * (every field optional except `success`) so handlers that forward to a tool
 * can pass its raw output through without enumerating every tool's shape.
 *
 * Domain-specific fields are surfaced to the model via `toModelOutput` in
 * `index.ts` so multi-step flows (e.g. `geoda.analysis` classify breaks → `map.add-layer`
 * colorMap) can chain.
 */
export type ExecuteApiOutput = {
  success: boolean;
  /**
   * Identifies which handler produced this output. Stamped centrally by the
   * dispatcher so a renderer can pick the right view without sniffing payload
   * shape.
   */
  apiName?: string;
  details?: string;
  /** Optional explicit guidance for the calling agent on what to do next. */
  nextStep?: string;
  instruction?: string;
  error?: string;

  // query-tool.ts
  datasetName?: string;
  resultDatasetName?: string;
  truncatedQueryResult?: string;
  totalRows?: number;
  firstFiveRows?: string | unknown[];
  firstTwoRows?: unknown[];
  sql?: string;
  dbTableName?: string;

  // map.add-column command — the newly added column name(s)
  addedColumns?: string[];

  // kepler-tools (basemap, load-data, save-data, table)
  dataInfo?: unknown;
  savedDatasetNames?: string[];

  // boundary-tool
  boundary?: {nw: [number, number]; se: [number, number]};

  // spatial-analysis-tools (classify, lisa, moran, weights, regression)
  variableName?: string;
  method?: string;
  k?: number;
  hinge?: number;
  breaks?: number[];
  uniqueValues?: unknown[];
  weightsId?: string;
  weightsMeta?: unknown;
  globalMoranI?: number;
  clusterColorAndLabels?: unknown[];
  totalObservations?: number;
  significanceThreshold?: number;
  modelType?: string;
  dependentVariable?: string;
  independentVariables?: string[];
  result?: unknown;

  // geo-tools (routing, isochrone, geocoding, spatial-query, grid, etc.)
  outputDatasetName?: string;
  outputVariableName?: string;
  count?: number;
  distance?: number;
  duration?: number;
  /**
   * Real column names of each input table loaded by `geo.spatial-query`, so the
   * model can reference them in follow-up SQL without guessing (e.g. the
   * geometry column is `geometry`, never the map-side `_geojson`).
   */
  tableSchemas?: Array<{tableName: string; columns: string[]}>;

  // kepler-tools (add-layer) temporal follow-up hints
  dateTimeColumns?: string[];
  dateTimeHint?: string;
  integerTemporalColumns?: string[];
  integerTemporalHint?: string;

  // dataset-context-tool
  datasets?: unknown[];

  // chart-commands (histogram, boxplot, scatterplot, bubble, pcp)
  /**
   * The command id that produced this output. Stamped by `executeCommand` from
   * `result.commandId` so the UI renderer can dispatch on it (e.g. the
   * histogram ECharts renderer checks `commandId === 'chart.histogram'`).
   */
  commandId?: string;
  variableNames?: string[];
  xVariableName?: string;
  yVariableName?: string;
  sizeVariableName?: string;
  numberOfBins?: number;
  totalValues?: number;
  /**
   * Histogram bin data for the renderer. NOT surfaced to the LLM by
   * `toModelOutput` — the `details` string carries the bin summary instead.
   */
  histogramData?: unknown[];
  /**
   * Row indexes per bin, used by the histogram renderer for brush-selection →
   * map highlighting. NOT meant for the LLM to read and NOT surfaced by
   * `toModelOutput`.
   */
  barDataIndexes?: number[][];
  /** `'kepler'` rows line up with the map (brush highlights features);
   * `'duckdb'` rows don't (brush is inert). Renderer-only. */
  source?: 'kepler' | 'duckdb';
  /**
   * Per-variable quartile/mean/std/IQR stats. The model-facing summary for
   * `chart.boxplot`; the renderer additionally needs the `boxplotData`/
   * `rawData`/`rawDataIndices` payload under `__ui` to draw the chart.
   */
  boxplots?: unknown[];
  /**
   * Boxplot renderer payload (whisker-fence boxes + mean markers), carried
   * under `data.__ui` for `chart.boxplot`. NOT surfaced to the LLM by
   * `toModelOutput` — the `details` string carries the summary instead.
   */
  boxplotData?: {
    boxplots: Array<{
      name: string;
      low: number;
      q1: number;
      q2: number;
      q3: number;
      high: number;
      mean: number;
      std: number;
      iqr: number;
    }>;
    meanPoint: [string, number][];
  };
  /** Raw values per variable, drawn as scatter strips by the boxplot renderer.
   * Renderer-only. */
  rawData?: Record<string, number[]>;
  /**
   * Dataset row index per raw value (`rawDataIndices[var][i]` is the kepler row
   * for `rawData[var][i]`), used by the boxplot renderer for brush-selection →
   * map highlighting. Renderer-only.
   */
  rawDataIndices?: Record<string, number[]>;
  correlation?: number;
  xStats?: {min: number; max: number; mean: number};
  yStats?: {min: number; max: number; mean: number};
  sizeStats?: {min: number; max: number; mean: number};
  pcp?: Array<{name: string; min: number; max: number; mean: number; std: number}>;
  totalPoints?: number;
};
