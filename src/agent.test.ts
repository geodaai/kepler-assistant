import {describe, expect, it} from 'vitest';
import {Agent, KeywordPlanner} from './agent';
import {AnalysisEngine} from './analysis-commands';
import {createMockConnector} from './mock-connector';

describe('Agent', () => {
  it('plans from a prompt and executes the tool call', async () => {
    const analysis = new AnalysisEngine(createMockConnector());
    const agent = new Agent({run: (tool, input) => analysis.invoke(tool, input)}, new KeywordPlanner());

    const result = await agent.run('make a 2x2 grid over the area');
    expect(result.steps[0].tool).toBe('geo.grid');
    expect(result.steps[0].result.success).toBe(true);
    expect((result.steps[0].result.data as {featureCount?: number}).featureCount).toBe(4);
  });

  it('stops after the first failing step', async () => {
    const runner = {
      async run(tool: string): Promise<{success: boolean; error?: string}> {
        return {success: false, error: `boom on ${tool}`};
      }
    };
    const agent = new Agent(runner, new KeywordPlanner());
    const result = await agent.run('classify the data');
    expect(result.steps).toHaveLength(1);
    expect(result.final?.success).toBe(false);
  });

  it('falls back to data.query for unknown prompts', async () => {
    const calls: string[] = [];
    const agent = new Agent(
      {
        async run(tool: string): Promise<{success: boolean}> {
          calls.push(tool);
          return {success: true};
        }
      },
      new KeywordPlanner()
    );
    const result = await agent.run('something unrelated');
    expect(calls).toEqual(['data.query']);
    expect(result.final?.success).toBe(true);
  });
});

describe('KeywordPlanner', () => {
  it('maps grid/cell prompts to geo.grid', async () => {
    const planner = new KeywordPlanner();
    const calls = await planner.plan('draw a rectangle grid');
    expect(calls[0].tool).toBe('geo.grid');
  });

  it('maps classify prompts to geoda.analysis', async () => {
    const planner = new KeywordPlanner();
    const calls = await planner.plan('run a quantile classify');
    expect(calls[0].tool).toBe('geoda.analysis');
  });
});
