# Execution Plan: AI Assistant Extraction

**Status:** Draft
**Owner:** Xun Li
**Companion doc:** `AI_ASSISTANT_EXTRACTION_PLAN.md` (architecture & rationale)
**Source branch:** `xli-move-assistant-to-demo-app` (in `~/Downloads/kepler.gl`)

## Implementation status (Phase 1 / M0)

**P1.1–P1.6 are implemented on branch `xli-move-assistant-to-demo-app`** (commits
`168f9443` … `ce77a363`), confined to `examples/demo-app/`. Verified in the
browser harness: **34 passed, 0 failed** (SKIP_E2E=1; Ollama E2E skipped).

| Task | Status | Notes |
|---|---|---|
| P1.1 Unify Zod | ✅ | demo-app `zod` → `^4.4.0`; fixed `errorMap`→`error` in `geoda-analysis-command.ts`; `exportCommandInputSchema` verified to return valid JSON Schema. **Done:** `yarn.lock` regenerated (zod resolves to 4.4.3) — commit `428c952e`. |
| P1.2 Result shaping | ✅ | Chart renderer fields (`histogramData`, `barDataIndexes`, `source`, `meanPoint`) moved under `data.__ui` via chart-tool `toModelOutput`; histogram renderer reads `__ui`. |
| P1.3 Policy metadata | ✅ | `metadata` populated on all 30 commands (readOnly / riskLevel / idempotent / requiresConfirmation). |
| P1.4 Dedupe registry | ✅ | Three `registerCommandsForOwner` → one in `store.ts`. |
| P1.5 Parameterize state path | ✅ | Added `KeplerStateAccessors`; host app supplies visState/mapBoundary via `AiAssistantPanel` `stateAccessors`. |
| P1.6 Regression tests | ✅ | Added MCP contract checks (schema-export, policy-metadata, output-shape) to `validate-ai-assistant.mjs`. |

## Phase 2 (M1) scaffold — `~/github/kepler-mcp`

A standalone MCP server repo was scaffolded at `~/github/kepler-mcp` (commit
`e78ea44`) and advanced to a **working MCP server** (commits `24cc1f3`,
`8fb3aeb`): `buildMcpServer` exposes the map.* + analysis tool surface over
`@modelcontextprotocol/sdk`, `connectStdio` + `startHttpServer` (streamable
HTTP) are wired, and a mock in-memory registry exercises the contract. The
end-to-end check (`scripts/verify-mcp.mjs`) **passes** (list tools, call
`map.get-boundary`, confirm `chart.histogram` strips renderer `__ui`).

**Browser (WebSocket) path** is implemented and verified end-to-end: `src/hub.ts`
(`KeplerHub`) lets a browser page dial into `ws://127.0.0.1:PORT` with an Origin
allow-list + pairing-code guards; map.* MCP tools route through the hub to the
connected page (`mapHandler` option). `scripts/verify-hub.mjs` passes a mock
browser through the full MCP→hub→page→result loop. The demo-app side is an
opt-in in-page bridge (`examples/demo-app/src/ai-assistant-v2/mcp/bridge.ts`,
`?mcp=1`), which executes forwarded map.* calls against the room-store registry
(commit `04760444` in the kepler.gl repo).

**Analysis engine** (commits `4ce3b01`, `e619b72`): the data engine now runs
real SQL through the **`@sqlrooms/duckdb-core` `DuckDbConnector` interface**
(`src/duckdb-engine.ts` + `src/analysis-commands.ts`), serving
`data.create-table/query/filter/merge-tables/load-to-map` + `chart.histogram`
server-side while `map.*` stays on the browser hub. The connector is portable
across **duckdb-wasm (demo-app/browser), native DuckDB, or MotherDuck**; the
demo-app wires `createWasmDuckDbConnector`, so the same analysis component is
buildable for the demo-app. `scripts/verify-engine.mjs` (**VERIFY PASS**)
exercises the SQL→Arrow→JSON→MCP wiring (this Node build uses a mock connector
because duckdb-wasm/native were not runnable in this environment).

**Demo-app integration** (commit `97ae4cd3`): the `AnalysisEngine` is ported
into `examples/demo-app/src/ai-assistant-v2/analysis/`, backed by the app's
shared duckdb-wasm connector (`getConnector`), and exposed as a `data.run-sql`
command. Verified in the browser harness: `data.run-sql` returns a real DuckDB
result (`SELECT 1+1 AS x → [{x:2}]`), 35/35 pass — proving the same analysis
component runs in both the service and the demo-app.

**Charts + GeoDa — complete** (commits `b61df2a`…`2e6edb1`): the `AnalysisEngine`
covers all five charts (`chart.histogram/boxplot/scatterplot/bubble/pcp`) and the
**full `geoda.analysis` surface** — `spatial-weights`, `classify`, `standardize`,
`rate`, `thiessen-polygons`, `mst`, `cartogram` (`@geoda/core`), `regression`
including `spatial-lag`/`spatial-error` (`@geoda/regression`), `lisa` +
`global-moran` (`@geoda/lisa`). All run the real `@geoda` WASM in Node.

**Geo-enrichment + agent loop** (commits `9da9107`…`66b0b15`): `geo.grid` via
`@turf/rectangle-grid` (pure); **`geo.us-boundary`** now fetches real US
state/county boundaries from public GitHub datasets (no token, verified live);
`geo.routing`/`isochrone`/`geocode`/`roads` expose the surface with a not-wired
error pending a Mapbox token / OSM. `src/agent.ts` adds a minimal agent loop
(plan → execute → render) with a pluggable `Planner` (LLM swap-in). All four
verify scripts pass. Remaining: wire the Mapbox/Overpass providers and swap in
a real LLM planner.

**Live demo-app integration proven** (commit `23e0c71`): `scripts/verify-live.mjs`
opens the demo-app (`?mcp=1`) in Chrome, connects to the kepler-mcp `KeplerHub`,
drives a real `map.set-basemap` call through hub → the page's in-page bridge →
command registry → Redux, and asserts the map style became `dark`. The browser
path works live against the real page (all five verify scripts pass).

**Analysis-engine duplication — RESOLVED** (commit `b0786416` in the kepler.gl
repo): the demo-app now imports the shared **kepler-assistant/engine** subpath
(backed by its duckdb-wasm `getConnector`) instead of a local copy. It required a
browser-safe subpath export (`kepler-assistant/engine`) so the browser bundle
doesn't pull kepler-assistant's Node MCP server/hub, plus `@turf/rectangle-grid`
in the demo-app. Verified: typecheck clean, bundle builds, harness 35/35
(`data.run-sql` runs through the shared engine). The local `ai-assistant-v2/analysis/`
copy is deleted. (A published package is still the cleaner long-term path, but the
`file:` dep works.)

**Chat decoupling** (commits `972e239`, `9f63393f`): kepler-assistant is now a
code package owning the **kepler-agnostic `ChatToolSurface`** (`listTools` +
`invoke`). kepler-mcp adapts its engine+hub to it (`src/chat-surface.ts`); the
demo-app exposes the same surface over its command registry
(`mcp/chat-surface.ts`). A chat harness can now drive either backend
interchangeably (`scripts/verify-surface.mjs` passes). kepler.gl stays the map
app, kepler-mcp stays the service, kepler-assistant owns the reusable chat
surface.

**Final split (map-only kepler-mcp; kepler-assistant = full assistant)** — commits
`4c60e52`/`76d3f51` (kepler-mcp) + `63c8f84` (kepler-assistant): the analysis
engine, agent loop, chat-surface, and their verify scripts moved from kepler-mcp
to kepler-assistant. kepler-mcp is now **map-only** (`map.*` + hub +
`registerMapTools`). kepler-assistant **imports kepler-mcp** and composes
`buildAssistantMcpServer` to expose map.* (4) + analysis (17) on one MCP server,
plus the agent loop + `ChatToolSurface`. All six verify scripts pass
(kepler-mcp: verify-mcp/hub/live; kepler-assistant: verify-engine/agent/surface).

Because the steering-committee decisions (naming/packaging, result-shaping
location, hub lifecycle) are not yet made, the map contract is scaffolded as a
delineated module in the service (`src/map-contract.ts`, `src/mcp-adapter.ts`)
rather than a separate `@kepler.gl/mcp` package in the kepler monorepo — adding
it there would require new root deps (`@sqlrooms`, `@modelcontextprotocol`).
The module is structured so it can be split into its own package if the
committee so decides (open question 1). Remaining: the real engines
(DuckDB/GeoDa/charts) + the agent loop + the browser bridge.

> **Environment note:** the harness/dev server here used zod swapped to 4.4.3
> locally during development; that is now resolved by the committed `yarn.lock`
> regeneration (commit `428c952e`).

This is the step-by-step, executable version of the architecture plan. It is
ordered, dependency-aware, and each task has a verifiable exit criterion.

---

## How to read this plan

- **Task IDs** are `P<phase>.<n>` (e.g. `P1.3`). They are executed in order
  within a phase unless a dependency note says otherwise.
- **Blocks / Blocked by** lists the task IDs that gate a task.
- **Exit criterion** is the falsifiable "done" check — if you can't verify it,
  the task isn't done.
- **Effort** is a rough size in half-days (S = ≤0.5, M = 1, L = 2–3, XL = 4+).
- **Status** is one of: `todo`, `in-progress`, `done`, `blocked`.

---

## Milestone overview

| Milestone | Scope | Depends on | Outcome |
|---|---|---|---|
| **M0** | Phase 1 — registry repair | — | Command registry is contract-clean; MCP projection is correct |
| **M1** | Phase 2 — extract contract + engines | M0 | `@kepler.gl/mcp` + standalone MCP service repo exist |
| **M2** | Phase 3 — re-home demo-app | M1 | demo-app consumes the contract; map surface only |
| **M3** | Phase 4 — deprecate in-app chat | M2 + acceptance criteria | in-app chat retired only when MCP is proven |

> **Note:** M1–M3 depend on steering-committee decisions (open questions in the
> architecture doc §7). They are planned at coarse granularity. **M0 is fully
> unblocked and is the only milestone with detailed tasks below.**

---

## Scope decisions (dropped features)

Two features are **out of scope** and will be dropped:

| Feature | Current state | Action |
|---|---|---|
| **Screenshot** | Fully wired: `screenshot-actions.ts` (`SET_START_SCREEN_CAPTURE`, `SET_SCREEN_CAPTURED`), `screenshotToAsk` state in `reducer.ts`, `ScreenshotWrapper` (`html2canvas`), app.tsx wiring | Remove the two screen-capture actions, `screenshotToAsk` state, `ScreenshotWrapper`, and the `html2canvas` dep |
| **Voice input** | Not implemented in this branch — only a stale comment in `react19-shim.ts` referencing `react-audio-voice-recorder`; no voice code or dependency | Delete the stale comment; no other work |

**Keep, do not drop:** `SET_MAP_BOUNDARY` lives in `screenshot-actions.ts` but is
**not** screenshot — it is the viewport boundary that feeds `map.get-boundary`
(the LLM's "eyes"). It stays; only the two screen-capture actions go.

**Consequence:** dropping screenshot removes one of the three demo-app coupling
points (see "Demo-app impact assessment" below) and the `html2canvas` dep. The
`map.screenshot` spike in the MCP proposal (§4.6) is moot.

---

## Phase 1 (M0) — Repair the command registry

**Goal:** make the command registry a correct, exportable contract. No MCP work
yet — this is repairing the surface every harness and engine will project from.

**Order matters:** P1.1 → P1.2 → P1.3 → P1.4 → P1.5 → P1.6. P1.1 and P1.2 are
the two decisions that determine the shape of everything versioned, so they
must land first.

### P1.1 — Unify Zod so `listCommands()` can export JSON Schema

- **Problem:** demo-app writes schemas with `zod@^3.22.0`; `@sqlrooms/room-store`
  bundles `zod@^4.1.8` and converts via `z.toJSONSchema()`, which reads v4
  internals. Result: `listCommands({includeInputSchema: true})` throws
  (`TypeError: Cannot read properties of undefined (reading 'def')`). Hidden by
  `as any` casts on ~30 `inputSchema` fields.
- **Files:** `examples/demo-app/package.json`; every `commands/**/*.ts` schema.
- **Steps:**
  1. Bump `zod` to `^4` in `examples/demo-app/package.json` (and any transitive
     pin in `yarn.lock`).
  2. Migrate the ~30 command input schemas to zod 4 syntax (`.default()`,
     `.optional()`, error-map changes, etc.).
  3. Remove the `as any` casts on `inputSchema` so the real type is checked.
  4. Verify `store.commands.listCommands({includeInputSchema: true})` returns a
     valid JSON Schema for every command without throwing.
- **Exit criterion:** P1.6's schema-export regression test passes (valid JSON
  Schema for all ~30 commands, no throw).
- **Effort:** L. **Blocks:** P1.2, P1.6.

### P1.2 — Move result shaping into the `RoomCommand` contract

- **Problem:** `RoomCommandResult.data` is `unknown`; the model-facing allowlist
  is a hand-maintained ~45-field list in `executeApi`'s `toModelOutput`
  (`skills/executeApi/index.ts:155`), which withholds renderer-only fields
  (`barDataIndexes`, `histogramData`, `source`, `meanPoint`). An MCP adapter
  reading the registry returns raw `data` — duplicating the allowlist guarantees
  drift.
- **Decision (must be made here, before v1):** either
  - (a) add `toAgentOutput?: (data) => unknown` to the `RoomCommand` contract, or
  - (b) make `data` the already-trimmed payload and put renderer extras under a
    `data.__ui` key that adapters strip.
- **Files:** `skills/executeApi/index.ts`; the `RoomCommand` type usage across
  `commands/**`; `store.ts` tool wiring.
- **Steps:**
  1. Choose (a) or (b) and record the decision in the architecture doc §7.2.
  2. Implement the chosen mechanism on the command contract.
  3. Move the `toModelOutput` allowlist logic into the contract (per-command).
  4. Delete the hand-maintained allowlist from `executeApi`.
- **Exit criterion:** P1.6's output-shape regression test passes (no
  renderer-only field appears in any tool result).
- **Effort:** L. **Blocks:** P1.6.

### P1.3 — Populate policy metadata on all commands

- **Problem:** no command sets `riskLevel`, `requiresConfirmation`, `readOnly`,
  `idempotent`, or `metadata`. `resolveCommandPolicyMetadata` returns defaults,
  so every MCP `annotations` block is uniformly wrong and the confirmation gate
  is a no-op.
- **Files:** all `commands/**/*.ts` (20 command files, ~30 commands).
- **Steps:**
  1. Define a small policy rubric (read-only vs. mutating vs. destructive).
  2. Annotate each command: `readOnly` for `map.get-*`; `requiresConfirmation`
     for `map.load-data` (remote fetch) and destructive ops; `idempotent` where
     true.
  3. Add `metadata` (human-readable description) where missing.
- **Exit criterion:** every registered command returns non-default policy
  metadata; `map.load-data` is flagged `requiresConfirmation`.
- **Effort:** M. **Blocks:** P1.6.

### P1.4 — Dedupe `registerCommandsForOwner` in `store.ts`

- **Problem:** `store.ts` calls `registerCommandsForOwner` three times with
  identical arguments (lines 225–229, 238–242, 250–254), each preceded by a
  near-identical comment. Harmless at runtime but rebuilds `getAllCommands`
  three times.
- **Files:** `examples/demo-app/src/ai-assistant-v2/store.ts`.
- **Steps:** keep one call; delete the other two blocks and their comments.
- **Exit criterion:** exactly one `registerCommandsForOwner` call remains;
  `grep -c registerCommandsForOwner store.ts` == 1.
- **Effort:** S. **Blocks:** none (can run in parallel with P1.3).

### P1.5 — Parameterize the kepler state path through `KeplerContext`

- **Problem:** `store.ts` hard-codes `reduxStore.getState().demo.keplerGl.map.visState`
  (lines 58, 79, 85) and `demo.aiAssistant.keplerGl.mapBoundary`. This is the
  demo-app's own mount shape and blocks reuse in any other app.
- **Files:** `store.ts`, `types.ts`.
- **Steps:**
  1. Extend `KeplerContext` (or a new `KeplerStateAccessor`) with the visState
     and mapBoundary accessors.
  2. Replace the literal `demo.keplerGl.map.visState` / `demo.aiAssistant...`
     paths with the injected accessors.
  3. Have the demo-app pass its accessors at `setReduxStore()` time.
- **Exit criterion:** no `demo.keplerGl` / `demo.aiAssistant` string literal
  remains in `ai-assistant-v2`; the module mounts against any redux shape that
  supplies the accessors.
- **Effort:** M. **Blocks:** none (can run in parallel with P1.3/P1.4).

### P1.6 — Regression tests (the acceptance criteria)

- **Files:** `examples/demo-app/scripts/validate-ai-assistant.mjs` (extend) or a
  new `scripts/validate-mcp-contract.mjs`.
- **Steps:**
  1. **Schema-export test** — assert `listCommands({includeInputSchema: true})`
     returns valid JSON Schema for every command (pins P1.1).
  2. **Output-shape test** — assert no renderer-only field (`barDataIndexes`,
     `histogramData`, `source`, `meanPoint`) appears in any tool result (pins
     P1.2).
  3. **Policy-metadata test** — assert every command returns non-default policy
     metadata (pins P1.3).
  4. **Contract test** — call each v1 `map.*` tool through the command registry
     and assert the resulting Redux state.
- **Exit criterion:** all four tests pass in CI/local; `tsc` clean in root and
  demo-app.
- **Effort:** L. **Blocks:** M1.

---

## Phase 2 (M1) — Extract the contract + engines

**Blocked on:** M0 + steering-committee decisions (naming, result-shaping
location, hub lifecycle).

- **P2.1** — Create `@kepler.gl/mcp` in the kepler repo: `map.*` command defs +
  WebSocket client + adapter over `createCommandMcpAdapter`. Add only the
  `map.*` namespace filter and the WebSocket transport.
- **P2.2** — Create the standalone MCP service repo: engines (DuckDB/GeoDa/
  charts) + analysis command defs (`data.*`, `geoda.*`, `geo.*`, `chart.*`) +
  agent loop, exposed over MCP (stdio default, streamable HTTP on same process).
- **P2.3** — Decompose `EXECUTE_API_GUIDANCE` (do not copy): per-tool sequencing
  hints → each tool's `description`; cross-namespace choreography → service
  `instructions`.
- **P2.4** — Resolve hub lifecycle (one hub per machine + port discovery, or
  per-client negotiation).

**Exit criterion:** a local MCP client (e.g. Claude Desktop) can list and call
the `map.*` tools against a live kepler.gl page.

---

## Phase 3 (M2) — Re-home the demo-app

**Blocked on:** M1.

- **P3.1** — Keep the sqlrooms chat as the example harness + in-page bridge
  (WebSocket → command registry → Redux dispatch).
- **P3.2** — Replace the in-app `ai-assistant-v2` chat with either an import of
  the engine package (example/integration) or MCP-over-bridge (long-term path).
- **P3.3** — Remove the analysis commands (`data.*`, `geoda.*`, `geo.*`,
  `chart.*`) from the demo-app; the app keeps only the map surface.

**Exit criterion:** demo-app bundle contains no DuckDB/GeoDa/chart compute; the
map surface is driven through the contract.

---

## Phase 4 (M3) — Deprecate the in-app chat

**Blocked on:** M2 + acceptance criteria met.

- **P4.1** — Keep the in-app chat working while the MCP path matures (no cliff).
- **P4.2** — Deprecate the in-app chat only when the MCP experience is proven
  against the acceptance criteria (architecture doc §6).

**Exit criterion:** in-app chat removed; MCP is the supported path.

---

## Demo-app impact assessment

**Claim:** re-homing the AI assistant has minimal impact on the demo-app — only
the AI feature is provided by the library; geoviz is untouched.

**Verified:** true, with conditions. Only **3 files** couple the demo-app to
`ai-assistant-v2`:

| File | Coupling | After re-home |
|---|---|---|
| `app.tsx` | imports `AiAssistantPanel` + screenshot actions; renders panel; reads `state.demo.keplerGl.map.uiState.mapControls.aiAssistant.active` | import from library; drop screenshot wiring (see scope decisions) |
| `reducers/index.ts` | imports `aiAssistantReducer`, combines as `aiAssistant` slice | use library's `createAiAssistantReducer()` factory |
| `factories/map-control.tsx` | imports `AiAssistantControlFactory`, adds to map controls | import from library |

**Conditions for "minimal" to hold:**

1. **The library must expose a clean integration API** — `createAiAssistantReducer()`
   factory, `AiAssistantControlFactory`, `AiAssistantPanel`. This is what P1.5
   enables: today the library hard-codes `demo.keplerGl.map.visState` and
   `demo.aiAssistant.keplerGl.mapBoundary`, and the demo-app *writes* `mapBoundary`
   into the library's slice on every view change (app.tsx:263) — a two-way
   coupling. Until parameterized, the demo-app must know the library's internals.
2. **`UPDATE_DATASET` stays in core, not the library.** The `map.add-column` /
   `map.replace-dataset` feature added `UPDATE_DATASET` + `updateDataset` to
   `src/actions` and `src/reducers`. Per the proposal §4.5 this is genuine
   map-side logic (in-place schema edits with layer/filter/tooltip
   reconciliation) and belongs in core. The library *uses* it; it does not own it.
3. **`package.json` sheds the AI dependency tree** — `@sqlrooms/*`, `@geoda/*`,
   `@ai-sdk/*`, `ai`, `ollama-ai-provider-v2`, `zod`, `zustand`, `echarts`,
   `lexical`, `monaco-editor`, `html2canvas`, etc. move to the library. Mechanical
   cleanup; side benefit is a smaller demo-app install/build surface.

**Net:** after dropping screenshot, the demo-app coupling shrinks to a reducer
factory + a map-control button + a panel — a thin, clean integration.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Zod 3→4 migration breaks unrelated demo-app code | High | Scope the bump to the command schemas; run full demo-app `tsc` + tests |
| Result-shaping decision (P1.2) made wrong | High (versioned contract) | Decide before v1; record in architecture doc §7.2 |
| Steering committee defers M1–M3 | Medium | M0 is independent; ship it regardless |
| `map.load-data` fetch policy unaddressed | High (security) | Flag `requiresConfirmation` in P1.3; full policy in M1 |

---

## Definition of done (whole plan)

1. kepler.gl core and app contain **no** AI compute (DuckDB/GeoDa/charts).
2. `@kepler.gl/mcp` is a published, versioned contract with passing contract
   tests.
3. A standalone MCP service exposes the analysis commands and drives a live map.
4. The demo-app's sqlrooms chat is an example harness consuming the contract.
5. All acceptance criteria (architecture doc §6) pass.
