import {
  AiSettingsSliceConfig,
  AiSettingsSliceState,
  AiSliceConfig,
  AiSliceState,
  createAiSettingsSlice,
  createAiSlice,
  createDefaultAiTools,
  createDefaultAiToolRenderers,
  createDefaultAiSettingsConfig,
  createDefaultAiConfig
} from '@sqlrooms/ai';
import {
  createRoomStore,
  persistSliceConfigs,
  BaseRoomStoreState,
  createBaseRoomSlice,
  createCommandSlice,
  CommandSliceState,
  registerCommandsForOwner
} from '@sqlrooms/room-store';
import {createDuckDbSlice, DuckDbSliceState} from '@sqlrooms/duckdb';
import type {ToolRendererRegistry} from '@sqlrooms/ai';
import {AI_SETTINGS} from './chat';
import {getEchartsToolRenderers} from './tools/echarts-renderers';
import {setStoreConnectorProvider} from './glue/utils';
import {createWrappedQueryTool} from './tools/query-tool-wrapper';
import {getAllCommands, KEPLER_COMMAND_OWNER} from './commands';
import {getKeplerContext} from './kepler-context';
import {createKeplerAssistantInstructions, createKeplerAssistantTools} from './assistant-tools';

// Preserve the standalone entry's existing public exports.
export * from './kepler-context';
export {skillStorage} from './assistant-tools';

export type RoomState = BaseRoomStoreState &
  DuckDbSliceState &
  AiSliceState &
  AiSettingsSliceState &
  CommandSliceState;

export const {roomStore, useRoomStore} = createRoomStore<RoomState>(
  persistSliceConfigs<RoomState>(
    {
      name: 'kepler-ai-assistant-state',
      version: 1,
      migrate: (persistedState: unknown, version: number): RoomState => {
        if (version >= 1) return persistedState as RoomState;
        if (
          typeof persistedState !== 'object' ||
          persistedState === null ||
          !('aiSettings' in persistedState)
        ) {
          return persistedState as RoomState;
        }
        const defaults = createDefaultAiSettingsConfig(AI_SETTINGS);
        const state = persistedState as Record<string, unknown>;
        return {
          ...state,
          aiSettings: AiSettingsSliceConfig.parse({
            defaults,
            persisted: state.aiSettings
          })
        } as unknown as RoomState;
      },
      sliceConfigSchemas: {
        ai: AiSliceConfig,
        aiSettings: AiSettingsSliceConfig
      }
    },
    (set, get, store) => ({
      ...createBaseRoomSlice()(set, get, store),

      ...createDuckDbSlice()(set, get, store),

      ...createCommandSlice()(set, get, store),

      ...createAiSettingsSlice({config: AI_SETTINGS})(set, get, store),

      ...createAiSlice({
        config: createDefaultAiConfig(),

        getInstructions: createKeplerAssistantInstructions,

        toolRenderers: {
          ...createDefaultAiToolRenderers(),
          ...getEchartsToolRenderers()
        } as ToolRendererRegistry,

        tools: {
          ...createDefaultAiTools(store, {query: {}, commands: {}, tables: false}),
          // Override the stock `query` tool (which hides all rows from the LLM
          // because numberOfRowsToShareWithLLM defaults to 0) with a wrapper
          // that runs against the kepler tools' DuckDB connector and surfaces
          // the first N rows as a ~1000-char preview. See query-tool-wrapper.ts.
          query: createWrappedQueryTool(),
          ...createKeplerAssistantTools(store)
        } as any
      })(set, get, store)
    })
  )
);

// Dev-only hook: expose the room store on `window` so browser-based validation
// harnesses (e.g. puppeteer scripts) can drive commands directly without an LLM
// API key. No-op in non-browser environments.
if (typeof window !== 'undefined') {
  (window as any).__keplerRoomStore = roomStore;
}

// Wire the room store's DuckDB connector into the kepler tools layer so that
// skills (which materialize kepler datasets into DuckDB via tools/utils.ts
// `getConnector`) and the main-agent wrapped `query` tool share ONE DuckDB
// instance. Without this, the two connectors diverge: skills write tables the
// query tool can't see, and the query tool reads an empty DB. This is the root
// cause of the "DESCRIBE county_unemployment does not exist" error — the
// dataset lived in kepler's in-memory visState and was never materialized into
// the query tool's DuckDB. `getConnector()` in tools/utils.ts now resolves to
// this connector. Must run after `roomStore` exists.
setStoreConnectorProvider(async () => roomStore.getState().db.getConnector());

// Register the kepler-ai command catalog (map.*, data.*, geoda.*, geo.*,
// chart.*) into the room-store command registry. The same `RoomCommand`
// definitions then serve every surface that reads the registry: the AI skill
// `executeApi` tool (which delegates to `store.commands.invokeCommand`), the
// stock `search_commands` / `get_command` / `list_commands` / `execute_command`
// AI tools, the command palette UI, the CLI adapter, and the MCP adapter.
//
// `KeplerContext` is a singleton built from `reduxStore`, so a one-time
// registration is sufficient. If `KeplerContext` ever becomes per-session,
// re-register on swap with `unregisterCommandsForOwner` + `registerCommandsForOwner`.
registerCommandsForOwner(
  roomStore,
  KEPLER_COMMAND_OWNER,
  Object.values(getAllCommands(getKeplerContext()))
);
