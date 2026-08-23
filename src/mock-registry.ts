/**
 * In-memory command registry used to exercise the MCP server without the real
 * engines (DuckDB / GeoDa / charts) or a live kepler.gl page. It implements the
 * same `CommandRegistryLike` surface the real sqlrooms registry exposes
 * (`listCommands` / `invokeCommand`), so the map contract + analysis adapters
 * can be proven end-to-end over MCP.
 */

/**
 * The registry surface the mock implements. Mirrors the sqlrooms room-store
 * command registry (`listCommands` / `invokeCommand`) so the map contract +
 * analysis adapters can be proven end-to-end without a live kepler.gl page.
 */
export type CommandRegistryLike = {
  listCommands: (options?: {includeInputSchema?: boolean}) => unknown[];
  invokeCommand: (commandId: string, input?: unknown) => Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }>;
};

type Handler = (input: Record<string, unknown>) => Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
}>;

const handlers: Record<string, Handler> = {
  'map.get-boundary': async () => ({
    success: true,
    data: {boundary: {nw: [0, 0], se: [1, 1]}}
  }),
  'map.get-dataset-context': async () => ({
    success: true,
    data: {
      details: '1 dataset(s) loaded.',
      datasets: [{datasetName: 'demo', datasetId: 'demo', fields: [{density: 'real'}]}]
    }
  }),
  'map.set-basemap': async input => ({
    success: true,
    data: {details: `basemap changed to ${input.styleType ?? 'unknown'}`}
  }),
  'map.add-layer': async input => ({
    success: true,
    data: {layerId: 'layer_1', layerType: input.layerType ?? 'point'}
  }),
  'data.query': async () => ({
    success: true,
    data: {truncatedQueryResult: '[[1,2],[3,4]]', totalRows: 2}
  }),
  'chart.histogram': async input => ({
    success: true,
    data: {
      datasetName: input.datasetName ?? 'demo',
      variableName: input.variableName ?? 'density',
      totalValues: 100,
      details: 'Histogram for density: 7 bins.',
      // renderer-only payload — must live under __ui, never leak to MCP
      __ui: {
        histogramData: [{binStart: 0, binEnd: 10, count: 14}],
        barDataIndexes: [[0, 1, 2]],
        source: 'kepler'
      }
    }
  }),
  'geoda.analysis': async input => ({
    success: true,
    data: {analysis: input.analysis ?? 'classify', breaks: [1, 2, 3]}
  })
};

export function createMockRegistry(): CommandRegistryLike {
  return {
    listCommands: () =>
      Object.keys(handlers).map(id => ({id, inputSchema: {type: 'object', properties: {}}})),
    invokeCommand: async (id, input) => {
      const handler = handlers[id];
      if (!handler) return {success: false, error: `Unknown command "${id}"`};
      try {
        return await handler((input ?? {}) as Record<string, unknown>);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
