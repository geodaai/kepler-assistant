import type {RoomCommand} from '@sqlrooms/room-store';
import {z} from 'zod';
import {runAnalysis} from '../analysis';

export const routingCommandId = 'geo.routing' as const;

/**
 * Routing directions — a thin shim over the shared analysis engine's
 * `geo.routing` (which calls Mapbox Directions v5 with the Mapbox token the
 * demo-app's KeplerBridge exposes via `getMapboxToken`). The registry keeps the
 * same zod schema + metadata; only the compute moved to kepler-assistant.
 */
export function getRoutingCommand(): RoomCommand {
  return {
    id: routingCommandId,
    name: 'Routing directions',
    group: 'Geo',
    description: 'Get routing directions between two coordinates using Mapbox Directions API.',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: z.object({
      origin: z.object({longitude: z.number(), latitude: z.number()}),
      destination: z.object({longitude: z.number(), latitude: z.number()}),
      mode: z.enum(['driving', 'walking', 'cycling']).optional(),
      datasetName: z.string().describe('Name for the output dataset')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.routing', input ?? {});
        if (!result.success) {
          return {success: false, commandId: routingCommandId, error: result.error};
        }
        return {success: true, commandId: routingCommandId, data: result.data};
      } catch (error) {
        return {
          success: false,
          commandId: routingCommandId,
          error: `Failed to get routing: ${error instanceof Error ? error.message : error}`
        };
      }
    }
  };
}
