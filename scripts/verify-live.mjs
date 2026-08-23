#!/usr/bin/env node
/**
 * LIVE end-to-end check of kepler-assistant's FULL composed MCP server against
 * the real demo-app page.
 *
 *   MCP client → buildAssistantMcpServer
 *       ├─ map.set-basemap → mapHandler → KeplerHub → WebSocket → demo-app
 *       │     ?mcp=1 bridge → command registry → Redux → map (style becomes dark)
 *       └─ data.query → analysis engine (server-side, mock connector)
 *
 * Prereqs: demo-app dev server on :8080; system Chrome.
 * Usage: node scripts/verify-live.mjs   (exit 0 = pass)
 */

import {createRequire} from 'node:module';
import {buildAssistantMcpServer} from '../dist/assistant-server.js';
import {createMockRegistry, KeplerHub} from 'kepler-mcp';
import {AnalysisEngine} from '../dist/analysis-commands.js';
import {createMockConnector} from '../dist/mock-connector.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const require = createRequire(import.meta.url);
const puppeteer = require('/Users/xun/Downloads/kepler.gl/node_modules/puppeteer');

const HUB_PORT = 9125;
const CODE = 'assistant-live';
const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const hub = new KeplerHub({port: HUB_PORT, pairingCode: CODE});
await hub.start();

const analysis = new AnalysisEngine(createMockConnector());
const server = buildAssistantMcpServer({
  mapRegistry: createMockRegistry(),
  mapHandler: (id, input) => hub.forward(id, input),
  analysis
});

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({name: 'verify-live', version: '0.0.0'});
await client.connect(clientTransport);

let passed = true;
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
    executablePath: SYSTEM_CHROME
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:8080/?mcp=1&mcpCode=${CODE}&mcpPort=${HUB_PORT}`, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  await page.evaluate(() => document.querySelector('.toggle-ai-assistant')?.click());
  await new Promise(r => setTimeout(r, 3000));

  let connected = false;
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => !!window.__keplerReduxStore);
    if (hub.hasConnectedBrowser() && ready) {
      connected = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('hub connected + redux wired:', connected);

  // map.set-basemap through the FULL server → hub → page bridge → Redux.
  const mapRes = await client.callTool({name: 'map.set-basemap', arguments: {styleType: 'dark'}});
  await new Promise(r => setTimeout(r, 1500));
  const styleType = await page.evaluate(() => {
    const s = window.__keplerReduxStore?.getState();
    return s?.demo?.keplerGl?.map?.mapStyle?.styleType;
  });
  console.log('map.set-basemap success:', JSON.parse(mapRes.content.map(c => c.text || '').join('')).success, '| page styleType:', styleType);

  // data.query through the same server's analysis handler (server-side).
  const q = await client.callTool({name: 'data.query', arguments: {sql: 'SELECT 1 AS one'}});
  const qParsed = JSON.parse(q.content.map(c => c.text || '').join(''));
  console.log('data.query success:', qParsed.success, '| columns:', qParsed.data?.columns);

  const mapParsed = JSON.parse(mapRes.content.map(c => c.text || '').join(''));
  if (!connected || !mapParsed.success || styleType !== 'dark' || !qParsed.success) {
    passed = false;
    console.log('VERIFY FAIL');
  } else {
    console.log('VERIFY PASS');
  }
} catch (error) {
  passed = false;
  console.error('verify-live error:', error.message);
} finally {
  if (browser) await browser.close();
  await client.close().catch(() => {});
  hub.stop();
  process.exit(passed ? 0 : 1);
}
