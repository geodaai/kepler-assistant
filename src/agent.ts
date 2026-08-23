/**
 * Minimal agent loop (orchestrator).
 *
 * Turns a user prompt into tool calls and renders results. The `Planner` decides
 * which tools to call (a real LLM planner is a swap-in; a `KeywordPlanner` mock
 * is provided for verification and no-key dev), and the `ToolRunner` executes
 * them (the analysis engine for server-side tools, the hub for map.* tools).
 *
 * This is intentionally thin — the "one contract, many harnesses" design means
 * each harness (Claude Code, Cursor, the sqlrooms chat, this service) supplies
 * its own agent loop; this is the reference loop for the service.
 */

import type {ToolResult} from './types';

/** Executes a single tool call. */
export interface ToolRunner {
  run(tool: string, input: Record<string, unknown>): Promise<ToolResult>;
}

/** Decides which tool calls to make for a prompt. */
export interface Planner {
  plan(prompt: string): Promise<Array<{tool: string; input: Record<string, unknown>}>>;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  result: ToolResult;
}

export interface AgentResult {
  prompt: string;
  steps: AgentStep[];
  final?: ToolResult;
}

/** Reference orchestrator: plan → execute → render. */
export class Agent {
  constructor(
    private readonly runner: ToolRunner,
    private readonly planner: Planner
  ) {}

  async run(prompt: string): Promise<AgentResult> {
    const calls = await this.planner.plan(prompt);
    const steps: AgentStep[] = [];
    for (const call of calls) {
      const result = await this.runner.run(call.tool, call.input);
      steps.push({tool: call.tool, input: call.input, result});
      if (!result.success) break; // stop on first failure
    }
    return {prompt, steps, final: steps[steps.length - 1]?.result};
  }
}

/**
 * Keyword-based planner (mock) — picks a tool from a few trigger phrases. Used
 * for verification and no-key dev; a real LLM planner implements the same
 * `Planner` interface and calls a model.
 */
export class KeywordPlanner implements Planner {
  async plan(prompt: string): Promise<Array<{tool: string; input: Record<string, unknown>}>> {
    const p = prompt.toLowerCase();
    if (/grid|cell|rectangle/.test(p)) {
      return [{tool: 'geo.grid', input: {bbox: [[0, 0], [4, 4]], rows: 2, columns: 2}}];
    }
    if (/classif|quantile|natural break/.test(p)) {
      return [{tool: 'geoda.analysis', input: {analysis: 'classify', method: 'quantile', k: 3}}];
    }
    return [{tool: 'data.query', input: {sql: 'SELECT 1 AS one'}}];
  }
}
