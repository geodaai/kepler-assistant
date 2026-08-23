/**
 * The kepler-agnostic chat tool surface.
 *
 * This is the contract between a browser chat harness (the sqlrooms chat) and
 * ANY tool/command backend:
 *   - kepler.gl's command registry (map.*, data.*, geoda.*, ...)
 *   - the kepler-mcp analysis engine + map contract
 *   - or any other backend
 *
 * By depending only on `ChatToolSurface`, the chat harness never needs to know
 * which backend it drives. kepler.gl stays the map app; kepler-mcp stays the
 * service; this package owns the reusable surface.
 */

import type {ToolResult} from './types';
export type {ToolResult} from './types';

/** The surface a chat harness uses to drive any tool/command backend. */
export interface ChatToolSurface {
  /** List the tool ids this backend exposes. */
  listTools(): string[];
  /** Invoke a tool with JSON input and get a result back. */
  invoke(tool: string, input: unknown): Promise<ToolResult>;
}

/**
 * Wrap a plain executor object into a `ChatToolSurface`. Accepts anything with
 * `invoke(tool, input)` so a backend only needs to provide that one method.
 */
export function toChatToolSurface(executor: {
  listTools?: () => string[];
  invoke: (tool: string, input: unknown) => Promise<ToolResult> | ToolResult;
  knownTools?: string[];
}): ChatToolSurface {
  const known = executor.knownTools ?? executor.listTools?.() ?? [];
  return {
    listTools: () => known,
    invoke: async (tool, input) => {
      const result = await executor.invoke(tool, input);
      if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
        return {success: false, error: `Invalid result from tool "${tool}"`};
      }
      return result;
    }
  };
}
