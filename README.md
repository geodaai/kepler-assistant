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
node scripts/verify-engine.mjs   # analysis engine over MCP
node scripts/verify-agent.mjs    # agent loop
node scripts/verify-surface.mjs  # ChatToolSurface conformance
node scripts/verify-live.mjs     # full server drives the real demo-app (map + analysis)
node dist/cli.js                 # serve map + analysis over stdio
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
