#!/usr/bin/env node
/**
 * Verify the kepler-agnostic ChatToolSurface (owned by kepler-assistant).
 *
 * Adapts kepler-mcp's analysis engine to ChatToolSurface and checks it is
 * structurally identical to the shared interface, plus that it can list tools
 * and invoke analysis + geoda tools. The demo-app exposes the same surface over
 * its command registry (chat-surface.ts); its tsc passing proves structural
 * conformance there.
 *
 * Usage: node scripts/verify-surface.mjs   (exit 0 = pass)
 */

import {createChatToolSurface} from '../dist/chat-surface.js';
import {AnalysisEngine} from '../dist/analysis-commands.js';
import {createMockConnector} from '../dist/mock-connector.js';

let passed = true;

const surface = createChatToolSurface({analysis: new AnalysisEngine(createMockConnector())});

// Structural conformance with ChatToolSurface (listTools + invoke).
if (typeof surface.listTools !== 'function' || typeof surface.invoke !== 'function') {
  passed = false;
  console.log('FAIL: surface does not conform to ChatToolSurface');
}

const tools = surface.listTools();
console.log('listTools:', tools.length, '| has map.*:', tools.some(t => t.startsWith('map.')), '| has data.*:', tools.some(t => t.startsWith('data.')));

// Invoke a data.query + a geoda.analysis tool through the surface.
const q = await surface.invoke('data.query', {sql: 'SELECT 1 AS one'});
console.log('invoke(data.query) -> success:', q.success, '| columns:', q.data?.columns);

const cls = await surface.invoke('geoda.analysis', {
  analysis: 'classify', datasetName: 'demo', variableName: 'x', method: 'quantile', k: 3
});
console.log('invoke(geoda.analysis) -> success:', cls.success);

if (!q.success || !cls.success) {
  passed = false;
  console.log('FAIL: invoke through ChatToolSurface failed');
}

console.log(passed ? 'VERIFY PASS' : 'VERIFY FAIL');
process.exit(passed ? 0 : 1);
