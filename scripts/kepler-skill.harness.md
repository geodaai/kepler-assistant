## Host integration (kepler-assistant)

This section is appended by kepler-assistant's `scripts/generate-skills.mjs` on
top of the map-surface skill vendored at `src/mcp/skill/kepler` (temporarily
integrated from the kepler.gl `@kepler.gl/mcp` module). It carries the
harness-specific details that belong to this assistant, not to the map surface.

- All map commands are issued through the `executeApi` tool:
  `{ call: { apiName: "executeCommand", args: { commandId: "map.*", input: {...} } }, reasoning: "<why>" }`.
  Pass `call` as an object, NOT a stringified JSON. Do NOT call `queryDuckDB` or
  `geoda` directly — they are not available; everything goes through
  `executeApi`.
- Do NOT use this skill for analysis beyond map mutation — route those to the
  sibling skills:
  - GeoDa spatial analysis (LISA, weights, regression, classify, rate, ...) → `geoda-analysis`.
  - Spatial filtering → `spatial-filter`.
  - Colocation analysis → `colocation`.
  - US boundaries → `us-boundaries`.
  - Charts / summary statistics → `charts`.
- The classification tool the color rules refer to is `geoda.analysis` with
  `analysis: "classify"`: `method: "quantile" | "natural breaks" | ...` returns
  `breaks`; `method: "unique values"` returns `uniqueValues`. Pass the returned
  values verbatim to `map.add-layer`'s `colorMap` — never invent category labels.
- `data.filter` and `data.load-to-map` also produce datasets without a layer —
  call `map.add-layer` after them, exactly like after `map.load-data` /
  `map.save-data` / `map.create-table`.
