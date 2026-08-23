/**
 * Bundler build for kepler-assistant.
 *
 * Replaces the plain `tsc` emit so the source can use extensionless relative
 * imports (esbuild resolves them) while still producing a `dist/` layout the
 * package `exports` map and the repo's Node scripts expect. Every src module
 * is a separate entry — this preserves today's per-file `dist/<name>.js`
 * layout, so `node dist/cli.js`, the `verify-*.mjs` scripts (which import
 * `dist/{agent,analysis-commands,chat-surface,mock-connector}.js` directly),
 * and the subpath exports all keep working.
 *
 * - `format: ['esm']` — the package is `"type": "module"`; consumers bundle
 *   with esbuild (demo-app) or run Node ESM directly (CLI, verify scripts).
 * - `dts: true` — one bundled `.d.ts` per entry, so each declaration file is
 *   self-contained (no relative-import extension concerns for any consumer).
 * - dependencies are left external by default (tsup externalizes
 *   `package.json` deps), so `apache-arrow`/`@sqlrooms/*`/`@geoda/*`/`@kepler.gl/*`
 *   are not inlined — the demo-app resolves a single copy and Arrow
 *   `instanceof` checks keep working.
 * - `splitting: false` — each entry is self-contained; entries are the only
 *   boundary consumers touch.
 */
import {defineConfig} from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent.ts',
    'analysis-commands': 'src/analysis-commands.ts',
    'chat-surface': 'src/chat-surface.ts',
    'duckdb-engine': 'src/duckdb-engine.ts',
    'geo-providers': 'src/geo-providers.ts',
    'kepler-bridge': 'src/kepler-bridge.ts',
    'mock-connector': 'src/mock-connector.ts',
    'mock-registry': 'src/mock-registry.ts',
    'tool-surface': 'src/tool-surface.ts',
    types: 'src/types.ts',
    'chat/index': 'src/chat/index.ts',
    'assistant-panel': 'src/assistant-panel.tsx',
    'commands/index': 'src/commands/index.ts',
    'analysis/index': 'src/analysis/index.ts',
    'glue/index': 'src/glue/index.ts',
    store: 'src/store.ts'
  },
  format: ['esm'],
  target: 'es2022',
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  treeshake: false,
  outExtension: () => ({js: '.js'})
});
