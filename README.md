# kepler-assistant

The **kepler.gl AI assistant** — the analysis MCP services (`data.*`, `geoda.*`,
`geo.*`, `chart.*`) + agent loop + the kepler-agnostic `ChatToolSurface`,
composing the kepler-mcp **map contract** so one assistant exposes both the map
surface and the compute engines.

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
  shared AI-settings config. Exposed as the browser-safe `kepler-assistant/chat`
  subpath. The kepler.gl demo-app imports it and provides its kepler command
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

## Run

```sh
pnpm install
pnpm build
node scripts/verify-engine.mjs   # analysis engine over MCP
node scripts/verify-agent.mjs    # agent loop
node scripts/verify-surface.mjs  # ChatToolSurface conformance
node scripts/verify-live.mjs     # full server drives the real demo-app (map + analysis)
node dist/cli.js                 # serve map + analysis over stdio
```

## Demo-app

The kepler.gl demo-app imports `AnalysisEngine` from the browser-safe
`kepler-assistant/engine` subpath (backed by its duckdb-wasm connector), so the
app and the MCP service run the identical analysis component. It also imports
the chat harness from the browser-safe `kepler-assistant/chat` subpath, providing
its kepler command registry as a `ChatToolSurface` (via
`createRegistryChatSurface`) and its bundled skills as the storage seeds.

## Remaining

- Geo providers (`geo.routing`/`isochrone`/`geocode`/`roads` need a Mapbox token
  / OSM; `geo.us-boundary` zipcode needs a zip map), and a real LLM planner.
- The kepler-specific glue (the demo-app's `store.ts`, `instructions.ts`,
  `tools/utils.ts`, echarts renderers, `MainView`, and kepler commands) still
  lives in the demo-app as the `ChatToolSurface` adapter. A further step could
  move more of that glue behind injected accessors.
