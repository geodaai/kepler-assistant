import {describe, expect, it, vi} from 'vitest';
import {getGeodaAnalysisCommand} from './geoda-analysis-command';
import {setStoreConnectorProvider} from '../glue/utils';
import {createMockConnector} from '../mock-connector';

// Route `loadTableIntoDuckDB`/`saveToDuckdb` (which read getConnector directly,
// bypassing the mocked runAnalysis) to the mock connector.
setStoreConnectorProvider(async () => createMockConnector() as any);

// `geoda-analysis-command` reaches the shared analysis engine through
// `runAnalysis`, whose module graph pulls the full store (room-store → deck.gl →
// luma.gl) — too heavy for the Node test env. Mock it and drive the engine's
// `geoda.analysis` handler directly with the mock connector.
vi.mock('../analysis', async () => {
  const {AnalysisEngine} = await import('../analysis-commands');
  const {createMockConnector: mock} = await import('../mock-connector');
  let engine: InstanceType<typeof AnalysisEngine> | undefined;
  return {
    runAnalysis: async (tool: string, input: unknown) => {
      if (!engine) engine = new AnalysisEngine(mock());
      return engine.invoke(tool, input);
    }
  };
});

// 2x2 queen contiguity: each square touches the other three.
const NEIGHBORS = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];

/** Mock KeplerContext whose `getValuesFromDataset` serves canned columns. */
function makeCtx(columnValues: Record<string, unknown[]>) {
  return {
    getValuesFromDataset: (datasetName: string, columnName: string) => {
      const values = columnValues[`${datasetName}.${columnName}`];
      if (!values) throw new Error(`Field ${columnName} not found in dataset ${datasetName}`);
      return values;
    }
  } as any;
}

async function executeGeoda(ctx: any, input: Record<string, unknown>) {
  const cmd = getGeodaAnalysisCommand(ctx);
  return (await cmd.execute({} as any, input)) as {
    success: boolean;
    error?: string;
    data?: Record<string, unknown>;
  };
}

describe('geoda.analysis command', () => {
  it('resolves a weightsId from the persisted <type>w column when the in-memory cache is cold', async () => {
    // Regression: weights were only cached in memory (session-scoped), so a
    // weightsId from a prior turn/session failed with "Weights not found" even
    // though the neighbor list was saved as a `<type>w` column in the map
    // dataset. The command must read the saved column back.
    const ctx = makeCtx({'sales.queenw': NEIGHBORS});
    const res = await executeGeoda(ctx, {
      analysis: 'lisa', datasetName: 'sales', variableName: 'amount',
      method: 'localMoran', weightsId: 'sales-queen', permutation: 99
    });
    expect(res.success).toBe(true);
    expect((res.data as {totalObservations?: number}).totalObservations).toBe(4);
  });

  it('reports "create weights first" when the weightsId cannot be resolved', async () => {
    const ctx = makeCtx({});
    const res = await executeGeoda(ctx, {
      analysis: 'lisa', datasetName: 'sales', variableName: 'amount',
      method: 'localMoran', weightsId: 'sales-queen', permutation: 99
    });
    expect(res.success).toBe(false);
    expect((res.error ?? '').toLowerCase()).toContain('weights not found');
  });
});
