import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  },
  // The @sqlrooms packages ship ESM dists with extensionless relative imports
  // (e.g. `from './BaseRoomConfig'`), which Node's external ESM resolver
  // rejects. Inline them so Vite's resolver (extension guessing) handles the
  // graph. Tests that import the full store (room-store → deck.gl → luma.gl)
  // still can't run in Node, so command-layer tests mock `../analysis` away —
  // the deck.gl graph is never reached here.
  ssr: {
    noExternal: [/@sqlrooms\//]
  }
});
