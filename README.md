# kepler-assistant

The **kepler.gl AI assistant** — the analysis engines (`data.*`, `geoda.*`,
`geo.*`, `chart.*`) + agent loop + the kepler-agnostic `ChatToolSurface`,
composing the kepler-mcp **map contract** so one assistant exposes both the map
surface and the compute engines.

Those are plain in-process tools, not MCP services. When the assistant runs
inside the kepler.gl demo-app there is no MCP server in the loop: the app
imports the browser-safe `engine` and `chat` subpaths and wires its kepler
command registry in as the `ChatToolSurface`. MCP is an optional transport —
`src/assistant-server.ts` wraps the same tools for serving over stdio/HTTP
(`dist/cli.js`).

```
   kepler.gl demo-app                  MCP server mode
   ┌─────────────────────────────┐    ┌─────────────────────────────┐
   │  chat UI + agent loop       │    │  any MCP client / agent     │
   │  (in-browser)               │    │  (IDE, server, CLI)         │
   └──────────────┬──────────────┘    └──────────────┬──────────────┘
                  │                                 │
                  │  in-process,                    │  stdio / HTTP
                  │  no MCP, no IPC                 │
                  ▼                                 ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                     kepler-assistant                          │
   │                                                                │
   │   ChatToolSurface ── listTools() / invoke()                    │
   │     ├── data.*   DuckDB tables, SQL                            │
   │     ├── geoda.*  @geoda WASM: weights, LISA, cluster, ...     │
   │     ├── geo.*    DuckDB spatial: buffer, join, centroid, ...  │
   │     └── chart.*  ECharts / chart renderings                    │
   │                                                                │
   │   agent loop · bundled skills (kepler, geoda-analysis, ...)   │
   └───────────────────────────────────────────────────────────────┘
```

Zooming into the kepler-assistant box, the components wire together like this:

```
   ┌──────────────────────────────────────────────────────────────┐
   │                 kepler-assistant (internal)                  │
   │                                                              │
   │   ┌──────────────────────┐   ┌────────────────────────────┐  │
   │   │ chat harness         │   │ agent loop                 │  │
   │   │ (src/chat/)          │   │ (src/agent.ts)             │  │
   │   │ skills runtime ·     │   │ Planner → ToolRunner       │  │
   │   │ seed skills · config │   │ plan → execute → render    │  │
   │   └──────────┬───────────┘   └─────────────┬──────────────┘  │
   │              │  listTools() / invoke()     │                 │
   │              ▼                             ▼                 │
   │   ┌───────────────────────────────────────────────────────┐  │
   │   │  ChatToolSurface  (src/tool-surface.ts)               │  │
   │   │  └─ createChatToolSurface (src/chat-surface.ts)       │  │
   │   └───────────────────┬───────────────────────────────────┘  │
   │                      │                                       │
   │              ┌───────┴───────────────────────┐               │
   │              ▼                             ▼                 │
   │   ┌──────────────────────┐   ┌────────────────────────────┐  │
   │   │ map.* tools          │   │ AnalysisEngine             │  │
   │   │ (src/mcp/ — vendored │   │ (src/analysis-commands.ts) │  │
   │   │ @kepler.gl/mcp)      │   │ data.* · chart.*           │  │
   │   │ └ skill/kepler       │   │ geoda.* · geo.*            │  │
   │   │                      │   │ └─ DuckDbEngine            │  │
   │   │                      │   │    (src/duckdb-engine.ts)  │  │
   │   │                      │   │    └ connector: duckdb-    │  │
   │   │                      │   │      wasm / native         │  │
   │   │                      │   │    └ @geoda WASM · turf ·  │  │
   │   │                      │   │      geo-providers         │  │
   │   └──────────┬───────────┘   └─────────────┬──────────────┘  │
   │              │  KeplerContext seam         │  KeplerBridge   │
   │              ▼                             ▼                 │
   │   ┌───────────────────────────────────────────────────────┐  │
   │   │ glue (src/glue/) — the only @kepler.gl/* importer;    │  │
   │   │ implements KeplerContext + analysis glue              │  │
   │   └───────────────────┬───────────────────────────────────┘  │
   │                      │                                       │
   │                      ▼                                       │
   │   ┌───────────────────────────────────────────────────────┐  │
   │   │ kepler.gl app (host) — datasets, layers, map state    │  │
   │   └───────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────────────────┘
```

Both entry points talk to the *same* in-process assistant — the demo-app over a
direct `ChatToolSurface`, server mode over the MCP transport wrapping it.

> **Temporary integration:** the map surface (`@kepler.gl/mcp`'s `map.*` commands
> + `skill/kepler`) is **vendored at `src/mcp/`** so this repo is self-contained
> for prototyping (no publish step, no cross-repo `file:` dep). This vendored
> copy is the **single edit surface** during the temporary period; the kepler.gl
> repo's `src/mcp/` module is removed for now (only the demo-app changes there).
> See **`NEXT_PLAN.md`** for the permanent separation. Do not import
> `@kepler.gl/mcp` from this repo or the demo-app during the temporary period.

## Roles

- **kepler.gl** = the map app.
- **kepler-mcp** = the reusable map surface (`map.*` + hub).
- **kepler-assistant** = the full assistant that **imports kepler-mcp**
  (`registerMapTools`) and adds the analysis engines, agent loop, and chat
  surface.

## What's here

- `AI_ASSISTANT_EXTRACTION_PLAN.md`, `EXECUTION_PLAN.md` — architecture + plan.
- `src/tool-surface.ts` — the kepler-agnostic `ChatToolSurface` (`listTools` +
  `invoke`).
- `src/chat-surface.ts` — `createChatToolSurface` over the analysis engine +
  optional map handler.
- `src/chat/` — the **kepler-agnostic chat harness** that consumes
  `ChatToolSurface`: the skills runtime (`executeApi`, `runSkill`,
  `discoverSkill`, skill storage, model resolution, prompt building) and the
  shared AI-settings config. Exposed as the browser-safe
  `@openassistant/kepler-assistant/chat` subpath. The kepler.gl demo-app imports it and provides its kepler command
  registry as the `ChatToolSurface` adapter (plus its seed skills).
- `src/analysis-commands.ts`, `src/duckdb-engine.ts` — the analysis engine
  (`data.*`, all charts, the full `geoda.analysis` surface, `geo.*`), running
  real SQL through a `@sqlrooms/duckdb-core` connector and real `@geoda` WASM.
- `src/mock-connector.ts` — a Node-runnable connector for dev/verify.
- `src/agent.ts` — a minimal agent loop (plan → execute → render) with a
  pluggable `Planner` (LLM swap-in).
- `src/assistant-server.ts` — `buildAssistantMcpServer` composes kepler-mcp's
  `map.*` with the analysis tools on one MCP server; `cli.ts` runs it over
  stdio/HTTP.

## Directory layout

The same layout, by directory:

| Directory | What it does |
| --- | --- |
| `src/chat/` | The **kepler-agnostic chat harness** that consumes `ChatToolSurface`: the skills runtime (`executeApi`, `runSkill`, `discoverSkill`, skill storage, model resolution, prompt building), the shared AI-settings config, and the default kepler-flavored seed-skill bundle. Browser-safe `chat` subpath. |
| `src/commands/` | The full command catalog (`getAllCommands`): kepler `map.*` (from `../mcp`), query `data.*`, geo `geo.*`, `geoda.analysis`, chart `chart.*`, and `data.run-sql`. The analysis shims delegate compute to the shared `AnalysisEngine`. |
| `src/analysis/` | Demo-app integration: lazily builds the `AnalysisEngine` against the shared duckdb-wasm connector and wires it to the app through `createKeplerBridge` (`getAnalysisEngine`, `runAnalysis`, `runSql`). |
| `src/glue/` | The kepler-bound glue. Implements the `KeplerContext` glue methods (`getValuesFromDataset`, `loadTableToKepler`, `getConnector`, …) and the analysis glue (`saveToDuckdb`, `getGeometriesFromDataset`, `highlightRows`, …). The only layer that imports `@kepler.gl/*` runtime packages. |
| `src/mcp/` | The **vendored** `@kepler.gl/mcp` map surface: the map contract, `map.*` commands, `skill/kepler`, and `createRegistryChatSurface` (wraps the room-store command registry as a `ChatToolSurface`). |
| `src/tools/` | AI SDK tool factories agents call directly (e.g. `query`) plus the ECharts renderers that draw `chart.*` results. |
| `src/charts/` | Chart components: the ECharts histogram component, its option builder, and the shared theme. |
| `src/components/` | `MainView` — the React view that hosts the chat harness with the hoisted ECharts renderers. |
| `src/map/` | kepler map controls: the `ai-assistant` control button (opens the assistant panel) and its `AiStar` icon. |
| `skills/built-in/` | The repo-owned seed skills (`charts`, `colocation`, `spatial-filter`, `us-boundaries`); `kepler` and `geoda-analysis` come from elsewhere (see Skills). |
| `scripts/` | Build + verification: `generate-skills.mjs` (bundles the seed skills) and the `verify-*.mjs` scripts (engine, agent, surface, bridge, live demo-app). |
| `dist/` | `pnpm build` output — the browser-safe `engine` / `chat` subpaths (one ESM bundle per src module). |

## The glue layer

`src/glue/` is the bridge between the kepler-agnostic engine and the kepler.gl
app — the one place that knows how to move data between kepler's world
(`Datasets`, `KeplerTable`, `Layer`) and DuckDB's world (Arrow tables, SQL).
It exists because the three layers around it have *opposite* coupling
requirements:

| Layer | Must be | Because |
| --- | --- | --- |
| Analysis engine (`data.*`, `geoda.*`, `geo.*`, `chart.*`) | **kepler-agnostic** — never imports `@kepler.gl/*` | testable in Node, reusable without a map |
| Vendored map surface (`src/mcp/` — the `map.*` commands) | **free of DuckDB / kepler-app wiring** | it is meant to be published as `@kepler.gl/mcp` and driven by any host |
| kepler.gl app (host) | owns datasets, layers, map state, redux | that is just what kepler is |

Two files, two responsibilities:

- **`src/glue/utils.ts`** — the kepler↔DuckDB data movement: the `KeplerContext`
  glue methods (`getValuesFromDataset`, `getDatasetContext`, `getConnector`) and
  the analysis glue the `KeplerBridge` and analysis shims use
  (`getGeometriesFromDataset`, `datasetNameToTableName`, `ensureSpatialExtension`,
  `highlightRows`, `interpolateColor`, `formatResultsForLLM`, …).
- **`src/glue/duckdb-cache.ts`** — Arrow-based table loading + the
  materialized-tables cache: `loadTableToKepler`, `saveToDuckdb`,
  `getTableAsGeoJSON`, `saveGeojsonToDuckdb`, `tableExists`. `loadRowsToArrow`
  inserts natively via `db.loadArrow` — the old `db.loadObjects` path inlined
  every row as `SELECT <literal> UNION ALL …` and blew past DuckDB's
  `max_expression_depth` (1000) past a few hundred rows.

It is wired in through two seams:

- **`KeplerContext`** (map.* commands → glue). The vendored `map.*` commands
  never touch DuckDB or kepler internals; they only call the five methods on
  `KeplerContext` (`src/mcp/commands/types.ts`). The host implements that
  context in `src/store.ts` (`getKeplerContext()`), wiring the glue methods to
  the app's kepler state accessors (`setKeplerStateAccessors`) and redux store
  (`setReduxStore`).
- **`KeplerBridge`** (analysis engine → glue). The kepler-agnostic
  `AnalysisEngine` calls a `KeplerBridge` for kepler-bound steps — materializing
  a dataset into DuckDB, pushing a result table onto the map, writing a computed
  column back, resolving geometries / mapbox token / boundary.
  `src/analysis/bridge.ts` (`createKeplerBridge`) implements that bridge *in
  terms of the glue*, reusing its helpers rather than duplicating them.

One more piece of wiring: `setStoreConnectorProvider` (`src/glue/utils.ts`) makes
tools, skills, and the wrapped `query` tool all share **one** DuckDB instance
(the store's). Without it, skills would write tables the query tool cannot see
and vice versa. It falls back to a standalone `WasmDuckDbConnector` singleton for
unit tests that never build the full store.

The payoff: the engine stays kepler-agnostic (runs in Node with a mock connector,
no map), the map surface stays host-agnostic (any host implements the
`KeplerContext` seam — which is what makes the permanent separation in
`NEXT_PLAN.md` possible), and the gnarly conversions — kepler datasets → Arrow →
DuckDB, DuckDB tables → kepler datasets, and the GeoJSON flavor for spatial SQL
(a `geometry` column, not kepler's map-side `_geojson`) — live in one place.

## Request flows

Two end-to-end walkthroughs through the kepler.gl demo-app — how a prompt
travels from the chat UI through the same `ChatToolSurface` contract, then
diverges: a **map** request actuates kepler.gl directly, while a **chart**
request round-trips through the analysis engine for compute and is rendered
back into the chat.

### Map prompt — "add a point layer of taxi pickups"

```
   ┌────────────────────────────────────────────────────────────────┐
   │ ① demo-app chat UI (MainView) — user prompt                    │
   │    "Add a point layer of taxi pickups"                         │
   └────────────────────────────────────────────────────────────────┘
   │                                │  user prompt
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ② chat harness (src/chat/) — orchestrator agent                │
   │    decides → runSkill("kepler")                                │
   └────────────────────────────────────────────────────────────────┘
   │                                │  runSkill("kepler") — sub-agent seeded with SKILL.md
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ③ skill sub-agent (runSkillTool.ts) — toolset: executeApi      │
   │    executeApi({commandId: "map.add-layer",                     │
   │                input: {datasetName, layerType: "point", ...}}) │
   └────────────────────────────────────────────────────────────────┘
   │                                │  surface.invoke(commandId, input)
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ④ ChatToolSurface — createRegistryChatSurface(roomStore)       │
   │    (src/mcp/chat-surface.ts) → registry invokeCommand          │
   └────────────────────────────────────────────────────────────────┘
   │                                │  map.add-layer command
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑤ map.add-layer RoomCommand (src/mcp/commands/)                │
   │    builds the layer; ctx.dispatch(addLayerAction, fitBounds)   │
   └────────────────────────────────────────────────────────────────┘
   │                                │  kepler Redux actions
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑥ KeplerContext (src/store.ts getKeplerContext)                │
   │    dispatch → reduxStore.dispatch(action) · glue (src/glue/)   │
   └────────────────────────────────────────────────────────────────┘
   │                                │  addLayer + fitBounds
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑦ kepler.gl app — visState updates                             │
   │    map re-renders with the new layer                           │
   └────────────────────────────────────────────────────────────────┘
```

### Histogram prompt — "show a histogram of fare amounts"

```
   ┌────────────────────────────────────────────────────────────────┐
   │ ① demo-app chat UI (MainView) — user prompt                    │
   │    "Show a histogram of fare amounts"                          │
   └────────────────────────────────────────────────────────────────┘
   │                                │  user prompt
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ② chat harness (src/chat/) — orchestrator agent                │
   │    calls executeApi directly                                   │
   └────────────────────────────────────────────────────────────────┘
   │                                │  executeApi({commandId: "chart.histogram", ...})
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ③ executeApi tool (src/chat/executeApi/)                       │
   │    commandId: "chart.histogram"                                │
   │    input: {datasetName, variableName, numberOfBins}            │
   └────────────────────────────────────────────────────────────────┘
   │                                │  surface.invoke(commandId, input)
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ④ ChatToolSurface — createRegistryChatSurface(roomStore)       │
   │    (src/mcp/chat-surface.ts) → registry invokeCommand          │
   └────────────────────────────────────────────────────────────────┘
   │                                │  chart.histogram command
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑤ chart.histogram shim (src/commands/chart-commands.ts)        │
   │    → runAnalysis("chart.histogram", {table, column, bins})     │
   └────────────────────────────────────────────────────────────────┘
   │                                │  runAnalysis
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑥ AnalysisEngine (src/analysis/index.ts) — lazily built        │
   │    new AnalysisEngine(getConnector(), createKeplerBridge(ctx)) │
   │    materializes the kepler dataset into DuckDB                 │
   └────────────────────────────────────────────────────────────────┘
   │                                │  SQL over the materialized table
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑦ DuckDbEngine (src/duckdb-engine.ts) — bin SQL                │
   │    returns histogramData + barDataIndexes + details            │
   └────────────────────────────────────────────────────────────────┘
   │                                │  result (data.__ui)
   │                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ ⑧ ECharts renderer (src/tools/echarts-renderers.tsx)           │
   │    dispatches on commandId === "chart.histogram"               │
   │    → HistogramComponent drawn inline in the chat UI            │
   │    brush-selection → highlightRows → map highlighting          │
   └────────────────────────────────────────────────────────────────┘
```

## Skills

The assistant's seed skills are bundled into `src/chat/bundledSkills.ts` by
`scripts/generate-skills.mjs` (run automatically on `pnpm build`). Each skill is
a `skill.yaml` manifest + `SKILL.md` prompt body, and comes from one of three
sources:

- **`kepler`** — the map-surface skill, **vendored** at `src/mcp/skill/kepler/`
  (temporarily integrated from the kepler.gl `@kepler.gl/mcp` module, which
  permanently owns the map commands). This host's notes in
  `scripts/kepler-skill.harness.md` are appended to its `SKILL.md`.
- **`geoda-analysis`** — **sourced** from the `@geoda/*` library repo
  (`geoda-lib/skills/geoda-analysis`) so the harness-agnostic spatial-analysis
  skill lives in one place; this host's command surface
  (`scripts/geoda-skill.harness.md`) is appended on top. Only `skill.yaml` +
  `SKILL.md` are bundled — the plugin packaging there (`package.json`,
  `.claude-plugin/`, `scripts/analyze.mjs`) belongs to the standalone skill
  (also usable as a Claude Code plugin). Point at another checkout with the
  `GEODA_SKILL_DIR` env var.
- **everything else** (`charts`, `colocation`, `spatial-filter`,
  `us-boundaries`) — from `skills/built-in/<id>/` in this repo.

Regenerate the bundle with `node scripts/generate-skills.mjs`.

## Run

```sh
pnpm install
pnpm build        # runs scripts/generate-skills.mjs first; needs the
                  # geoda-analysis skill dir to exist (default: the geoda-lib
                  # checkout at ~/github/geoda-lib/skills/geoda-analysis, or
                  # set GEODA_SKILL_DIR to point at it)
node scripts/verify-engine.mjs   # analysis engine
node scripts/verify-agent.mjs    # agent loop
node scripts/verify-surface.mjs  # ChatToolSurface conformance
node scripts/verify-bridge.mjs   # KeplerBridge glue conformance
node scripts/verify-live.mjs     # drives the real demo-app (map + analysis)
```

## Demo-app

The kepler.gl demo-app imports `AnalysisEngine` from the browser-safe
`@openassistant/kepler-assistant/engine` subpath (backed by its duckdb-wasm
connector), so the app and the MCP service run the identical analysis component.
It also imports the chat harness from the browser-safe
`@openassistant/kepler-assistant/chat` subpath, providing
its kepler command registry as a `ChatToolSurface` (via
`createRegistryChatSurface`) and its bundled skills as the storage seeds.

## Remaining

- Geo providers (`geo.routing`/`isochrone`/`geocode`/`roads` need a Mapbox token
  / OSM; `geo.us-boundary` zipcode needs a zip map), and a real LLM planner.
- The kepler-specific glue (the demo-app's `store.ts`, `instructions.ts`,
  `tools/utils.ts`, echarts renderers, `MainView`, and kepler commands) still
  lives in the demo-app as the `ChatToolSurface` adapter. A further step could
  move more of that glue behind injected accessors.
