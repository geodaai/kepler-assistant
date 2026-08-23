# Plan: Extract the AI Assistant into a Reusable Contract + MCP Service

**Status:** Draft for review
**Branch:** `xli-move-assistant-to-demo-app`
**Related:** `~/Downloads/kepler-mcp/PROPOSAL.md` (MCP proposal v2)

---

## 1. Goal

kepler.gl stays focused on **geovisualization only**. The AI assistant is
extracted out of the kepler.gl app and re-homed as a **reusable, versioned
contract** plus a **standalone MCP service**, so that any AI harness (Claude
Code, Cursor, VS Code, Goose, ChatGPT, or a browser chat) can drive a live
kepler.gl map and run spatial analysis against it.

The key insight that shapes this plan:

> **The reusable core is the tool surface (command registry + MCP contract),
> not the orchestration.** The sqlrooms chat/skills/sub-agents/tools is one
> *harness* — a browser-friendly one — not the center. Claude Code, Cursor,
> etc. are other harnesses. They all consume the same tool surface; they do
> not share orchestration.

---

## 2. Target architecture: one contract, many harnesses, many engines

Three tiers, not two:

| Tier | What it is | Examples |
|---|---|---|
| **Contract** (the reusable core) | command registry + Zod schemas + result shaping + policy metadata + MCP adapter | `map.*` defs, `@kepler.gl/mcp`, `createCommandMcpAdapter` |
| **Harnesses** (many, pluggable) | orchestration: agent loop, skills, sub-agents, tools | sqlrooms chat (browser), Claude Code, Cursor, VS Code, Goose, ChatGPT |
| **Engines** (many, pluggable) | compute that implements the non-map commands | DuckDB (`data.*`), GeoDa (`geoda.*`), charts (`chart.*`) |

- The **contract** is the only thing that deserves a stable, published,
  reusable package.
- The **sqlrooms chat** is the *reference browser harness* and the *example*
  that proves the contract works in-browser. Keep it, but do not treat its
  orchestration layer as the thing to extract.
- The **engines** become MCP services — standalone, installable server
  processes with their own lifecycle and release cadence.

### 2.1 Repo topology

- **kepler.gl repo** — core stays geoviz; add `@kepler.gl/mcp` (the contract:
  `map.*` + registry + adapter). The demo-app keeps the sqlrooms chat as the
  example harness plus the in-page bridge.
- **separate repo** — the MCP service: engines (DuckDB/GeoDa/charts) + the
  analysis command definitions + an agent loop, exposed over MCP. This is the
  "extract + re-home" target.

### 2.2 Deviation record — Phase 2 scaffold placement

**Planned (this doc §2.1):** create `@kepler.gl/mcp` as a package inside the
**kepler.gl monorepo** (`src/mcp`).

**Implemented (Phase 2 scaffold, `~/github/kepler-mcp`):** the map contract was
scaffolded as a **delineated module inside the standalone MCP service repo**
(`src/map-contract.ts`, `src/mcp-adapter.ts`, `src/transport.ts`), not as a
separate package in the kepler monorepo.

**Why:** adding `@kepler.gl/mcp` to the kepler monorepo requires new root
dependencies (`@sqlrooms/room-store` for `createCommandMcpAdapter`,
`@modelcontextprotocol/sdk`) — a real cost against the goal of keeping kepler.gl
geoviz-only. Whether it should be a separate package at all is explicitly
**steering-committee open question 1** (PROPOSAL §10), so splitting it into a
kepler-monorepo package now would be premature.

**Mitigation:** the map contract lives in clearly-named, dependency-light
modules (`map-contract.ts`, `mcp-adapter.ts`) that import nothing external —
they can be lifted into their own `@kepler.gl/mcp` package with a mechanical
move once the committee rules on packaging (open question 1).

**Trigger to revisit:** if the committee decides `@kepler.gl/mcp` should be a
published package in the kepler repo (open question 1), move these modules out
and register the `src/mcp` workspace (add to `package.json` `workspaces` and a
`src/mcp` package mirroring `src/duckdb`'s build config).

---

## 3. Current state (branch `xli-move-assistant-to-demo-app`)

- `src/ai-assistant` is already removed from core. Core is pure geoviz.
- `examples/demo-app/src/ai-assistant-v2/` (~8,056 LOC, 65 files) holds the
  AI module, built on `@sqlrooms/*`, `ai-sdk`, `@geoda/{core,lisa,regression}`,
  DuckDB, echarts, zustand, redux.
- It talks to kepler only through published `@kepler.gl/*` packages and a
  `KeplerContext` bridge (`getVisState` / `getMapBoundary` / `getMapboxToken` /
  `dispatch`) injected via `setReduxStore()`.
- A command-registry architecture (~30 typed `RoomCommand`s) is already in
  place; `store.commands.listCommands()` / `invokeCommand()` is the tool
  surface that the MCP adapter projects from.

### 3.1 Residual coupling to fix

- `store.ts` hard-codes the redux state path `demo.keplerGl.map.visState` —
  must become a parameter (the `KeplerContext` should own the accessor).
- `store.ts` calls `registerCommandsForOwner` **three times** with identical
  arguments (lines 225–229, 238–242, 250–254) — accumulated cruft to dedupe.

---

## 4. Pre-flight defects (blocking, do first)

These break the MCP projection and are correct under *every* repo-layout
decision. Fix them before any extraction.

| # | Defect | Effect | Where |
|---|---|---|---|
| 1 | **Zod v3/v4 mismatch.** demo-app writes schemas with zod 3.25.76; `@sqlrooms/room-store` bundles zod 4.4.3 and converts via `z.toJSONSchema()`. | `listCommands()` throws; tool/schema discovery is dead. | hidden by `as any` on ~30 `inputSchema` casts |
| 2 | **Result shaping lives outside the registry.** `RoomCommandResult.data` is `unknown`; the model-facing allowlist is a hand-maintained ~45-field list in `executeApi`'s `toModelOutput`. | MCP adapter returns raw `data` incl. renderer payloads; duplicating the allowlist guarantees drift. | `skills/executeApi/index.ts` |
| 3 | **Policy metadata never set.** No command sets `riskLevel` / `requiresConfirmation` / `readOnly` / `idempotent` / `metadata`. | every MCP `annotations` block is uniformly wrong; confirmation gate is a no-op. | `commands/**` |

**Fix 2 before versioning anything.** Move result shaping into the
`RoomCommand` contract — either a `toAgentOutput?: (data) => unknown` field, or
make `data` the already-trimmed payload and put renderer extras under a
`data.__ui` key that adapters strip.

---

## 5. Phased migration

### Phase 1 — Repair the registry (contract-clean, no MCP work yet)

- Unify Zod so `listCommands({includeInputSchema: true})` exports valid JSON
  Schema for every command.
- Move result shaping into the `RoomCommand` contract.
- Populate `riskLevel` / `requiresConfirmation` / `readOnly` / `idempotent` on
  all ~30 commands.
- Dedupe the three `registerCommandsForOwner` blocks in `store.ts`.
- Parameterize the `demo.keplerGl.map.visState` path through `KeplerContext`.

**Exit criteria:** `listCommands` returns valid schemas; no renderer-only field
leaks into any tool result; every command carries policy metadata.

### Phase 2 — Extract the contract + engines

- Create `@kepler.gl/mcp` in the kepler repo: `map.*` command defs + WebSocket
  client + the adapter over `createCommandMcpAdapter`. Add only what it owns:
  the `map.*` namespace filter and the WebSocket transport.
- Create the separate MCP service repo: engines (DuckDB/GeoDa/charts) + the
  analysis command definitions (`data.*`, `geoda.*`, `geo.*`, `chart.*`) + an
  agent loop, exposed over MCP (stdio by default, streamable HTTP on the same
  process).
- Decompose `EXECUTE_API_GUIDANCE` — do not copy it: per-tool sequencing hints
  move into each tool's `description`; cross-namespace choreography moves into
  the service's server-level `instructions`.

### Phase 3 — Re-home the demo-app

- Demo-app keeps the sqlrooms chat as the example harness + the in-page bridge
  (WebSocket → command registry → Redux dispatch).
- Replace the in-app `ai-assistant-v2` chat with either an import of the engine
  package (example/integration) or — the long-term path — connect via MCP
  through the bridge, keeping only the map surface in the app.

### Phase 4 — Deprecate the in-app chat (only when proven)

- Keep the in-app chat working while the MCP path matures — no cliff.
- Deprecate it only when the MCP experience is proven against the acceptance
  criteria below.

---

## 6. Acceptance criteria ("proven" means)

The branch already ships a Puppeteer harness
(`examples/demo-app/scripts/validate-ai-assistant.mjs`) that drives commands
through `window.__keplerRoomStore` with no LLM key — the substrate for MCP
contract tests.

- **Every v1 `map.*` tool gets a contract test**: call through the MCP adapter,
  assert the resulting Redux state.
- **Schema-export regression test**: `listCommands({includeInputSchema: true})`
  returns valid JSON Schema for every command (pins defect 1).
- **Output-shape regression test**: no renderer-only field (`barDataIndexes`,
  `histogramData`, `source`, `meanPoint`) appears in any MCP tool result (pins
  defect 2).
- **Protocol-version handshake test**: a version mismatch between page and hub
  fails closed with a readable error.

---

## 7. Open questions (from the MCP proposal, §10)

1. **Naming/packaging** — does `@kepler.gl/mcp` warrant a published package, or
   is it a module inside the service?
2. **Where result shaping lives** — must be decided before v1 (defect 2).
3. **Charts v2** — revisit `chart.*` (brush-and-link) as a first-class kepler
   capability if there is demand.
4. **Wire-protocol versioning** — hub and site can drift; version and reject
   mismatches.
5. **Hub lifecycle** — one hub per machine with port discovery, or one per
   client with negotiation (forced by stdio + tunnel daemons).
6. **ChatGPT scope** — document the OpenAI Secure MCP Tunnel path only, or
   treat ChatGPT as a v2 concern via MCP Apps.
7. **Experimental vs supported** — recommend an experimental label for v1.

---

## 8. Key files

- `examples/demo-app/src/ai-assistant-v2/commands/` — command definitions
  (kepler / data / geoda / geo / chart)
- `examples/demo-app/src/ai-assistant-v2/commands/kepler-commands/` — `map.*`
- `examples/demo-app/src/ai-assistant-v2/skills/executeApi/` — dispatcher +
  `EXECUTE_API_GUIDANCE`
- `examples/demo-app/src/ai-assistant-v2/store.ts` — registry registration
- `examples/demo-app/src/ai-assistant-v2/types.ts` — `KeplerContext` bridge
- `examples/demo-app/scripts/validate-ai-assistant.mjs` — Puppeteer harness
- `src/actions/src/vis-state-actions.ts` — `updateDataset` (`UPDATE_DATASET`)
- `src/reducers/src/vis-state-updaters.ts` — `UPDATE_DATASET` updater
