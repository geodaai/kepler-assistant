import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  // The @sqlrooms / @kepler.gl / @loaders.gl / @flowmap.gl packages ship ESM
  // dists with extensionless relative imports (e.g. `from './BaseRoomConfig'`,
  // `import './types'` in @flowmap.gl/data, `import './buffer-polyfill.node'`
  // in @loaders.gl/parquet — only the `.js` variant exists on disk), which
  // Node's external ESM resolver rejects. Inline them so Vite's resolver
  // (extension guessing) handles the graph. @kepler.gl/mcp is a pnpm `file:`
  // dependency copied into the virtual store, so its @kepler.gl/* peers resolve
  // to the npm 3.3.0-alpha.8 installs (with real dists), which Vite resolves
  // fine. Tests that import the full store (room-store → deck.gl → luma.gl)
  // still can't run in Node, so command-layer tests mock `../analysis` away —
  // but mcp's command index pulls @kepler.gl/layers → deck.gl at runtime, so
  // deck.gl/luma.gl remain external (loaded by Node) and only the packages with
  // broken extensionless internals are inlined.
  ssr: {
    noExternal: [/@sqlrooms\//, /@kepler\.gl\//, /@loaders\.gl\//, /@flowmap\.gl\//]
  }
});
