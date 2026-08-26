import {describe, expect, it, vi} from 'vitest';
import {getQueryCommands} from './query-commands';
import {setStoreConnectorProvider} from '../glue/utils';
import {createMockConnector} from '../mock-connector';

// Route `loadTableIntoDuckDB`/`saveToDuckdb` (which read getConnector directly,
// bypassing the mocked runAnalysis) to the mock connector.
setStoreConnectorProvider(async () => createMockConnector() as any);

// `query-commands` reaches the shared analysis engine through `runAnalysis`,
// whose module graph pulls the full store (room-store → deck.gl → luma.gl) —
// too heavy for the Node test env. Mock it and drive the engine's `data.query`
// handler directly with the mock connector.
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

type CommandResult = {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
};

async function executeQuery(
  input: Record<string, unknown>
): Promise<CommandResult> {
  const cmd = getQueryCommands({getVisState: () => undefined} as any)['data.query'];
  return (await cmd.execute({} as any, input)) as CommandResult;
}

describe('data.query command', () => {
  it('runs introspection queries (SHOW TABLES) without datasetName/resultDatasetName', async () => {
    const res = await executeQuery({sql: 'SHOW TABLES'});
    expect(res.success).toBe(true);
    expect((res.data as {totalRows?: number}).totalRows).toBeGreaterThan(0);
  });

  it('accepts an empty datasetName string (the shape the model sent)', async () => {
    const res = await executeQuery({sql: 'SHOW TABLES', datasetName: ''});
    expect(res.success).toBe(true);
  });

  it('errors when __TABLE__ is used without a datasetName', async () => {
    const res = await executeQuery({sql: 'SELECT * FROM __TABLE__'});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/__TABLE__/);
  });

  it('still saves a result dataset when resultDatasetName is provided', async () => {
    const res = await executeQuery({
      sql: 'SELECT 1 AS one',
      datasetName: 'sales',
      variableNames: [],
      resultDatasetName: 'probe_result'
    });
    expect(res.success).toBe(true);
    expect((res.data as {datasetName?: string}).datasetName).toBe('probe_result');
  });
});
