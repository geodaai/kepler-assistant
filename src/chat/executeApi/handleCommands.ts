/**
 * The routing core for the `executeApi` command dispatcher.
 *
 * The demo-app's kepler/data/geoda/geo commands are `RoomCommand`s registered
 * in the room-store command registry (see `store.ts`'s `registerCommandsForOwner`
 * call), which is exposed as the kepler-agnostic `ChatToolSurface` (see
 * `mcp/chat-surface.ts`'s `createRegistryChatSurface`). This file builds the
 * two `executeApi` apiName handlers (`listCommands`, `executeCommand`) that
 * dispatch through that surface rather than the raw registry:
 *
 *  - `executeCommand` → `surface.invoke(commandId, input)`, then surfaces the
 *    rich fields from `result.data` into `ExecuteApiOutput` so the existing
 *    `toModelOutput` in `index.ts` (multi-step chaining — e.g. `geoda.analysis`
 *    classify `breaks` → `map.add-layer` `colorMap`) keeps working.
 *  - `listCommands` → `surface.listTools()`, mapped to the `uniqueValues`
 *    carrier field.
 *
 * No command logic is duplicated here — the surface (kepler registry) is the
 * single source of truth.
 */

import {z} from 'zod';
import type {ChatToolSurface} from '../../tool-surface';
import {
  defineHandler,
  type ApiHandler,
  type ExecuteApiContext,
  type ExecuteApiOutput
} from './types';

export const ListCommandsArgs = z
  .object({
    includeInvisible: z
      .boolean()
      .optional()
      .describe('Include commands hidden from user-facing UIs. Defaults to false.'),
    includeDisabled: z
      .boolean()
      .optional()
      .describe('Include currently disabled commands. Defaults to true.'),
    includeInputSchema: z
      .boolean()
      .optional()
      .describe('Include each command’s input schema in the listing. Defaults to true.')
  })
  .strict();
export type ListCommandsArgs = z.infer<typeof ListCommandsArgs>;

/**
 * Build the `listCommands` handler. Delegates to `surface.listTools()` and maps
 * the returned tool ids to the `uniqueValues` carrier field the `toModelOutput`
 * in `index.ts` surfaces to the model.
 */
function buildListCommandsHandler(surface: ChatToolSurface): ApiHandler {
  return defineHandler({
    argsSchema: ListCommandsArgs,
    run: async (_ctx: ExecuteApiContext<ListCommandsArgs>): Promise<ExecuteApiOutput> => {
      const tools = surface.listTools();
      const commands = tools.map(commandId => ({commandId}));
      return {
        success: true,
        details: `${commands.length} commands available.`,
        // Surfaced via `toModelOutput` so the model can see the full id list.
        // Reuse `uniqueValues` as the generic "list" carrier field.
        uniqueValues: commands
      };
    }
  });
}

export const ExecuteCommandArgs = z
  .object({
    commandId: z
      .string()
      .describe('The exact command ID (e.g. "map.get-boundary", "data.query", "geoda.analysis").'),
    input: z
      .unknown()
      .optional()
      .describe('Optional command input. Must satisfy the command’s input schema.')
  })
  .strict();
export type ExecuteCommandArgs = z.infer<typeof ExecuteCommandArgs>;

/**
 * Build the `executeCommand` handler. Looks up `commandId` via
 * `surface.invoke` and surfaces the rich fields from `result.data` into
 * `ExecuteApiOutput` so multi-step chaining keeps working.
 */
function buildExecuteCommandHandler(surface: ChatToolSurface): ApiHandler {
  return defineHandler({
    argsSchema: ExecuteCommandArgs,
    run: async (ctx: ExecuteApiContext<ExecuteCommandArgs>): Promise<ExecuteApiOutput> => {
      const {commandId, input} = ctx.args;
      try {
        const result = await surface.invoke(commandId, input ?? {});
        // `result.data` carries the command's rich output (details, boundary,
        // breaks, weightsId, globalMoranI, histogramData, ...). Spread it onto
        // the AI-facing output so `toModelOutput` in `index.ts` can surface each
        // typed field. Stamp `commandId` so the UI renderer can dispatch on it
        // (e.g. the histogram ECharts renderer checks `commandId === 'chart.histogram'`).
        const data = (result.data ?? {}) as Record<string, unknown>;
        const output: ExecuteApiOutput = {
          success: result.success,
          commandId,
          ...(result.error ? {error: result.error} : {}),
          ...(typeof data === 'object' && data !== null ? (data as ExecuteApiOutput) : {})
        };
        return output;
      } catch (error) {
        return {
          success: false,
          error: `Command "${commandId}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          instruction:
            'Please explain the error and give a plan to fix it. Then try again with different arguments.'
        };
      }
    }
  });
}

/**
 * Build the pair of command handlers (`listCommands`, `executeCommand`) backed by
 * a `ChatToolSurface`. Returned to `index.ts` which registers them in the
 * `ExecuteApiCall` discriminated union.
 */
export function buildCommandHandlers(surface: ChatToolSurface): {
  listCommandsHandler: ApiHandler;
  executeCommandHandler: ApiHandler;
} {
  return {
    listCommandsHandler: buildListCommandsHandler(surface),
    executeCommandHandler: buildExecuteCommandHandler(surface)
  };
}
