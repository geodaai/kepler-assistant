import type {RoomCommand} from '@sqlrooms/room-store';
import {getKeplerCommands, KEPLER_COMMAND_OWNER} from '@kepler.gl/mcp';
import type {KeplerContext} from '@kepler.gl/mcp';
import {getGeoCommands} from './geo-commands';
import {getGeodaAnalysisCommand} from './geoda-analysis-command';
import {getQueryCommands} from './query-commands';
import {getChartCommands} from './chart-commands';
import {getRunSqlCommand} from './run-sql-command';

/**
 * Build the full kepler-ai command catalog for a given `KeplerContext`. Merges
 * the kepler / query / geo / spatial-analysis / chart command sets into one map
 * keyed by command id. Intended for registry registration via
 * `registerCommandsForOwner(store, KEPLER_COMMAND_OWNER, Object.values(...))`.
 *
 * The `map.*` commands come from `@kepler.gl/mcp` (the kepler.gl map surface);
 * the analysis shims (`data.*`, `geo.*`, `geoda.*`, `chart.*`) live here and
 * delegate compute to the shared `AnalysisEngine`.
 *
 * Chart commands (`chart.*`) are routed through `executeApi` like every other
 * command. The histogram renderer dispatches on `commandId` rather than tool
 * name (see `tools/echarts-renderers.tsx`), so no direct AI SDK tools need to
 * be injected into skill sub-agents — `runSkillTool.ts` seeds them with just
 * `executeApi`.
 */
export function getAllCommands(ctx: KeplerContext): Record<string, RoomCommand> {
  return {
    ...getKeplerCommands(ctx),
    ...getQueryCommands(ctx),
    ...getGeoCommands(ctx),
    'geoda.analysis': getGeodaAnalysisCommand(ctx),
    ...getChartCommands(),
    'data.run-sql': getRunSqlCommand()
  };
}

export {getKeplerCommands, KEPLER_COMMAND_OWNER} from '@kepler.gl/mcp';
export {getGeoCommands} from './geo-commands';
export {getGeodaAnalysisCommand} from './geoda-analysis-command';
export {getQueryCommands} from './query-commands';
export {getChartCommands} from './chart-commands';
