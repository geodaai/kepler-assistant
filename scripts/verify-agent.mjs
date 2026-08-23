#!/usr/bin/env node
/**
 * Verify the agent loop (orchestrator): the Agent plans tool calls from a
 * prompt (KeywordPlanner mock), executes them against the analysis engine, and
 * renders results. A real LLM planner implements the same Planner interface.
 *
 * Usage: node scripts/verify-agent.mjs   (exit 0 = pass)
 */

import {Agent, KeywordPlanner} from '../dist/agent.js';
import {AnalysisEngine} from '../dist/analysis-commands.js';
import {createMockConnector} from '../dist/mock-connector.js';

const analysis = new AnalysisEngine(createMockConnector());
const runner = {run: (tool, input) => analysis.invoke(tool, input)};
const agent = new Agent(runner, new KeywordPlanner());

let passed = true;

// 1. "grid" prompt → geo.grid tool call → executed, result has cells.
const grid = await agent.run('make a 2x2 grid over the area');
console.log('agent(grid) steps:', grid.steps.map(s => s.tool).join(', '));
if (!grid.steps.length || grid.steps[0].tool !== 'geo.grid' || grid.steps[0].result.data?.featureCount !== 4) {
  passed = false;
  console.log('FAIL: agent did not run geo.grid');
}

// 2. "classify" prompt → geoda.analysis classify → executed, result has breaks.
const cls = await agent.run('classify the values');
console.log('agent(classify) steps:', cls.steps.map(s => s.tool).join(', '), '| breaks:', JSON.stringify(cls.final?.data?.breaks));
if (!cls.steps.length || cls.steps[0].tool !== 'geoda.analysis' || !Array.isArray(cls.final?.data?.breaks)) {
  passed = false;
  console.log('FAIL: agent did not run classify');
}

// 3. fallback prompt → data.query.
const q = await agent.run('run something');
console.log('agent(fallback) steps:', q.steps.map(s => s.tool).join(', '));
if (!q.steps.length || q.steps[0].tool !== 'data.query') {
  passed = false;
  console.log('FAIL: agent fallback did not run data.query');
}

console.log(passed ? 'VERIFY PASS' : 'VERIFY FAIL');
process.exit(passed ? 0 : 1);
