# NEXT_PLAN — Separate `@kepler.gl/mcp` back into the kepler.gl module

**Status:** Temporary integration (prototyping). This doc records how to return
to the permanent architecture.

## Why we're here

`kepler-assistant` composes two things:

- **The map surface** (`map.*` commands, `KeplerContext`/`KeplerStateAccessors`/
  `VisState` types, the `skill/kepler` map-management skill) — owned by the
  **kepler.gl repo** as the `@kepler.gl/mcp` module at `src/mcp/`.
- **The compute engines + chat harness** (`data.*`, `geoda.*`, `geo.*`,
  `chart.*`, agent loop, `ChatToolSurface`) — owned by this repo.

The *proper* way for this repo to consume the map surface is as a published
`@kepler.gl/mcp` package, but publishing is a heavyweight step (the module is at
`3.3.0-alpha.4` in an un-published monorepo). For faster prototyping, the map
surface is **temporarily vendored here** so this repo is self-contained — no
cross-repo `file:` dependency and no publish step.

## What the temporary state looks like

- Map surface source is vendored at **`src/mcp/`** (files copied verbatim from
  kepler.gl `src/mcp/src/` plus `src/mcp/skill/kepler/`).
  `src/mcp/chat-surface.ts` is *this repo's own* adapter (the registry →
  `ChatToolSurface`) and is unrelated to the vendored files.
- All `@kepler.gl/mcp` imports in `src/` were rewritten to relative imports
  (`../mcp` / `./mcp`). `src/commands/index.ts` still re-exports
  `getKeplerCommands` / `KEPLER_COMMAND_OWNER` from `../mcp`.
- `@kepler.gl/mcp` was removed from `package.json`; `@kepler.gl/reducers` and
  `redux` were added (both are imported by the vendored map-surface code).
- `scripts/generate-skills.mjs` reads the `kepler` skill from the vendored
  `src/mcp/skill/kepler/` instead of the installed package.
- **No sync script:** the vendored `src/mcp/` here is the single edit surface
  during the temporary period. kepler.gl's `src/mcp/` module was **removed**
  from the kepler.gl repo (its branch only carries demo-app changes) — only the
  demo-app in the kepler.gl repo changes in that repo.

The **demo-app** (`examples/demo-app/` in the kepler.gl repo) is unaffected: it
only depends on `kepler-assistant` (`file:` dep) and never imports
`@kepler.gl/mcp` directly. Its esbuild `@kepler.gl/mcp` alias and tsconfig path
mapping were **removed** along with the module — nothing references
`@kepler.gl/mcp` in that repo until the separation below.

## Rules during the temporary period

1. **Never import `@kepler.gl/mcp`** from this repo or from the demo-app — there
   is no `@kepler.gl/mcp` module to import during the temporary period; using it
   would fail to resolve (or, once published, bypass the vendored copy).
2. **The vendored copy here is the single edit surface.** Edit `src/mcp/`
   directly during the temporary period; kepler.gl's `src/mcp/` module is
   removed from that repo and not touched. When the map surface reaches its
   final state, copy it back into a re-created kepler.gl `src/mcp/` as part of
   the separation (step 4 below) — there is no periodic sync. After editing the
   vendored skill, run `pnpm build` (regenerates `src/chat/bundledSkills.ts`).
3. Keep `src/mcp/chat-surface.ts` — it is not part of the vendored map surface.

## Next plan: separate back into the kepler.gl module

When prototyping is done, return the map surface to a published `@kepler.gl/mcp`
module owned by the kepler.gl repo:

1. **kepler.gl repo — re-create the module from the final copy, then publish
   `@kepler.gl/mcp`** (from `src/mcp/`, version `3.3.0-alpha.4`): copy the
   vendored `src/mcp/` here (minus `chat-surface.ts`) into a re-created
   kepler.gl `src/mcp/`, re-add `./src/mcp` to the root `package.json`
   workspaces, and restore the module's own `package.json`/build files — it was
   removed from that repo during the temporary period. Then run its
   `prepublishOnly` (license header + `yarn build` + `yarn build:types`) and
   `npm publish`. Verify the published package ships `dist/` and `skill/kepler/`.
2. **kepler-assistant — consume the published package:**
   - `pnpm add @kepler.gl/mcp@^3.3.0` (or restore
     `"@kepler.gl/mcp": "file:/Users/xun/Downloads/kepler.gl/src/mcp"` until
     the publish lands).
   - Revert the relative imports back to `@kepler.gl/mcp` (the inverse of the
     table in this repo's history: `../mcp` → `@kepler.gl/mcp` in
     `src/commands/index.ts`, `src/commands/{query,geo,geoda-analysis}-commands.ts`,
     `src/glue/duckdb-cache.ts`, `src/analysis/bridge.ts`; `./mcp` →
     `@kepler.gl/mcp` in `src/store.ts`, `src/assistant-panel.tsx`).
   - Delete the vendored `src/mcp/` **except** `src/mcp/chat-surface.ts`.
   - Restore `scripts/generate-skills.mjs` to resolve the `kepler` skill from
     the installed `@kepler.gl/mcp` package (the old `resolveMcpSkillDir()`).
   - Re-check whether `@kepler.gl/reducers` / `redux` are still needed for this
     repo's own code; drop them if not.
3. **demo-app** — re-add the removed `@kepler.gl/mcp` esbuild alias
   (`esbuild.config.mjs` `KEPLER_SRC_ALIASES`) and tsconfig path mapping so the
   published package resolves through kepler-assistant's externalized import.
   Delete `examples/demo-app/docs/NEXT_PLAN.md` once separated.
4. Rebuild + rerun the verification in the README (typecheck, build, vitest,
   browser harness).

## Why a module *within* the kepler.gl repo (not a separate repo)

The map surface is inseparable from kepler.gl internals (`@kepler.gl/actions`,
`reducers`, `layers`, `table`, `processors`, `constants`) and must be built in
lock-step with kepler.gl releases — the same version (`3.3.0-alpha.4`). Keeping
it as `src/mcp/` in the kepler.gl monorepo (already a yarn workspace) lets it
publish with the core release cycle instead of drifting as an independent
package.
