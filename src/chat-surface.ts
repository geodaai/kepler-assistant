/**
 * Adapt kepler-assistant to its own `ChatToolSurface` — the kepler-agnostic
 * surface a browser chat harness uses. Analysis tools run via the engine;
 * map.* tools route through a mapHandler (e.g. a kepler-mcp hub) when wired.
 */

import type {ChatToolSurface} from './tool-surface';
import {AnalysisEngine, ANALYSIS_TOOL_IDS} from './analysis-commands';
import type {ToolResult} from './types';

const MAP_TOOLS = ['map.set-basemap', 'map.get-boundary', 'map.get-dataset-context', 'map.add-layer'];

export interface ChatSurfaceOptions {
  analysis?: AnalysisEngine;
  mapHandler?: (id: string, input: unknown) => Promise<ToolResult>;
}

export function createChatToolSurface(opts: ChatSurfaceOptions = {}): ChatToolSurface {
  const knownTools = [...MAP_TOOLS, ...ANALYSIS_TOOL_IDS];
  return {
    listTools: () => knownTools,
    async invoke(tool, input) {
      if (tool.startsWith('map.')) {
        if (!opts.mapHandler) return {success: false, error: `map tool "${tool}" requires a mapHandler`};
        return opts.mapHandler(tool, input);
      }
      if (opts.analysis) return opts.analysis.invoke(tool, input);
      return {success: false, error: `No backend wired for "${tool}"`};
    }
  };
}
