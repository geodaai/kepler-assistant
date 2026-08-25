import type {RoomCommand} from '@sqlrooms/room-store';
import {z} from 'zod';
import {runAnalysis} from '../analysis';
import type {KeplerContext} from '../mcp';
import {getGeometriesFromDataset, datasetNameToTableName} from '../glue/utils';
import {getTableAsGeoJSON, saveGeojsonToDuckdb} from '../glue/duckdb-cache';
import {getRoutingCommand} from './routing-command';

/**
 * Geo commands — routing, isochrone, geocode, spatial-query, grid, roads and
 * US boundaries, exposed as `RoomCommand`s routed through `executeApi`.
 *
 * The geo compute lives in the shared kepler-assistant `AnalysisEngine` (the
 * same engine the MCP service exposes). The engine fetches Mapbox / Overpass /
 * Nominatim / GitHub data through the host `KeplerBridge` (`getMapboxToken`,
 * `getMapBoundary`, `getGeometries`, `saveResult`) — this module is a thin shim
 * that keeps the registry schemas + metadata stable while delegating execution.
 *
 * Two commands keep a small amount of app-side glue (not compute):
 *
 *  - `geo.spatial-query` re-maps the engine's `tableSchemas` names from the
 *    verbatim dataset names it queries to the `tbl_<sanitized>` table names the
 *    app's DuckDB connector uses (the harness + follow-up SQL resolve those).
 *  - `geo.grid` computes the extent bbox from a kepler dataset's geometries
 *    (app-side kepler glue), then enriches the engine's cells with the
 *    `{row, col, gridId}` properties and persists the grid — the engine builds
 *    the cells but stays data-property-agnostic.
 */

/** Resolve the bbox of a dataset's features (kepler or materialized-DuckDB). */
function bboxOfFeatures(features: any[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (node: any): void => {
    if (Array.isArray(node)) {
      // A coordinate pair [x, y] (optionally [x, y, z]) — all numbers.
      if (
        node.length >= 2 &&
        typeof node[0] === 'number' &&
        typeof node[1] === 'number'
      ) {
        const [x, y] = node;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        return;
      }
      for (const child of node) visit(child);
    }
  };
  for (const f of features) {
    const geometry = f?.geometry ?? f;
    if (geometry?.coordinates) visit(geometry.coordinates);
  }
  return [minX, minY, maxX, maxY];
}

/** Get a dataset's GeoJSON features (kepler layer, falling back to DuckDB). */
async function getDatasetFeatures(
  ctx: KeplerContext,
  datasetName: string
): Promise<any[] | undefined> {
  const visState = ctx.getVisState();
  let geoms = getGeometriesFromDataset(
    visState.datasets,
    visState.layers,
    visState.layerData,
    datasetName
  );
  if (geoms.length === 0) {
    // Tables are saved under `datasetNameToTableName(name)` → `tbl_<sanitized>`.
    const geojson = await getTableAsGeoJSON(datasetNameToTableName(datasetName));
    if (geojson) geoms = geojson.features;
  }
  return geoms.length > 0 ? geoms : undefined;
}

export function getGeoCommands(ctx: KeplerContext): Record<string, RoomCommand> {
  const routing: RoomCommand = {
    ...getRoutingCommand(),
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false}
  };

  const isochrone: RoomCommand = {
    id: 'geo.isochrone',
    name: 'Isochrone polygons',
    group: 'Geo',
    description:
      'Get isochrone polygons showing reachable areas within a time/distance from a point.',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: z.object({
      origin: z.object({longitude: z.number(), latitude: z.number()}),
      timeLimit: z.number().optional().describe('Time limit in minutes'),
      distanceLimit: z.number().optional().describe('Distance limit in meters'),
      profile: z.enum(['driving', 'walking', 'cycling']).optional(),
      datasetName: z.string().describe('Name for the output dataset')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.isochrone', input ?? {});
        if (!result.success) {
          return {success: false, commandId: 'geo.isochrone', error: result.error};
        }
        return {success: true, commandId: 'geo.isochrone', data: result.data};
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.isochrone',
          error: `Failed to generate isochrone: ${error instanceof Error ? error.message : error}`
        };
      }
    }
  };

  const geocoding: RoomCommand = {
    id: 'geo.geocode',
    name: 'Geocode address',
    group: 'Geo',
    description: 'Geocode an address to get latitude and longitude.',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: z.object({
      address: z.string().describe('The address to geocode'),
      datasetName: z.string().describe('Name for the output dataset')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.geocode', input ?? {});
        if (!result.success) {
          return {success: false, commandId: 'geo.geocode', error: result.error};
        }
        return {success: true, commandId: 'geo.geocode', data: result.data};
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.geocode',
          error: `Failed to geocode: ${error instanceof Error ? error.message : error}`
        };
      }
    }
  };

  const spatialQuery: RoomCommand = {
    id: 'geo.spatial-query',
    name: 'Spatial SQL query',
    group: 'Geo',
    description:
      'Run a DuckDB spatial SQL query on one or more datasets. Use ST_* functions for spatial operations (ST_Intersects, ST_Within, ST_Buffer, ST_Centroid, ST_Union_Agg, ST_Length, ST_Area, ST_Perimeter, ST_AsGeoJSON, ST_GeomFromGeoJSON, etc). The geometry column stores GeoJSON strings — wrap with ST_GeomFromGeoJSON(geometry) for spatial ops. IMPORTANT: in DuckDB the geometry column is ALWAYS named `geometry` (never `_geojson` — that is the kepler.gl map-side name). The result includes each input table\'s real column names in `tableSchemas` — read them before writing your SQL. Reference tables using __tbl0__, __tbl1__, ... placeholders (mapped to datasetNames in order).',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: z.object({
      datasetNames: z
        .array(z.string())
        .describe(
          'Dataset names to load into DuckDB before querying (order matches __tbl0__, __tbl1__, ...)'
        ),
      outputDatasetName: z.string().describe('Name for the output GeoJSON dataset'),
      sqlQuery: z
        .string()
        .describe('DuckDB spatial SQL query using __tbl0__, __tbl1__, ... as table placeholders'),
      reasoning: z.string().describe('Explanation of what this spatial query does')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.spatial-query', input ?? {});
        if (!result.success) {
          return {success: false, commandId: 'geo.spatial-query', error: result.error};
        }
        const data = (result.data ?? {}) as Record<string, any>;
        // The engine queries the datasets under their verbatim names (it reads
        // the bridge-materialized view); surface the canonical `tbl_<sanitized>`
        // names the app's DuckDB connector uses so follow-up SQL resolves.
        const tableSchemas = Array.isArray(data.tableSchemas)
          ? data.tableSchemas.map((s: {tableName: string; columns: string[]}) => ({
              tableName: datasetNameToTableName(s.tableName),
              columns: s.columns
            }))
          : undefined;
        return {
          success: true,
          commandId: 'geo.spatial-query',
          data: {
            details: data.details,
            outputDatasetName: data.outputDatasetName,
            tableSchemas,
            firstFiveRows: data.firstFiveRows
          }
        };
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.spatial-query',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  };

  const gridCommand: RoomCommand = {
    id: 'geo.grid',
    name: 'Rectangular grid',
    group: 'Geo',
    description:
      'Create a rectangular grid of polygons that divides a given area into rows and columns.',
    metadata: {readOnly: false, riskLevel: 'medium', idempotent: false},
    inputSchema: z.object({
      datasetName: z.string().describe('Dataset whose bounding box defines the grid extent'),
      rows: z.number().positive().describe('Number of rows in the grid'),
      columns: z.number().positive().describe('Number of columns in the grid'),
      outputDatasetName: z.string()
    }) as any,
    execute: async (_execCtx, input) => {
      const {datasetName, rows, columns, outputDatasetName} = (input ?? {}) as {
        datasetName: string;
        rows: number;
        columns: number;
        outputDatasetName: string;
      };
      try {
        const features = await getDatasetFeatures(ctx, datasetName);
        if (!features || features.length === 0)
          throw new Error(`Dataset ${datasetName} is empty or not found`);
        const [minX, minY, maxX, maxY] = bboxOfFeatures(features);

        const result = await runAnalysis('geo.grid', {
          bbox: [
            [minX, minY],
            [maxX, maxY]
          ],
          rows,
          columns,
          outputDatasetName
        });
        if (!result.success) {
          return {success: false, commandId: 'geo.grid', error: result.error};
        }

        // The engine builds the cells without data properties; add the
        // `{row, col, gridId}` props the app's grid contract carries (`col`,
        // not the DuckDB-reserved `column`) and persist the grid to DuckDB.
        const grid = (result.data as Record<string, any> | undefined)?.geojson as
          | {type: string; features: any[]}
          | undefined;
        if (grid && Array.isArray(grid.features)) {
          grid.features.forEach((f, i) => {
            const row = Math.floor(i / columns);
            const col = i % columns;
            f.properties = {...(f.properties ?? {}), row, col, gridId: `${row}_${col}`};
          });
          await saveGeojsonToDuckdb(datasetNameToTableName(outputDatasetName), grid as any);
        }

        return {
          success: true,
          commandId: 'geo.grid',
          data: {
            details: `Grid of ${rows}x${columns} (${grid?.features?.length ?? 0} cells) from ${datasetName} -> ${outputDatasetName}.`,
            outputDatasetName
          }
        };
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.grid',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  };

  const roads: RoomCommand = {
    id: 'geo.roads',
    name: 'Road networks',
    group: 'Geo',
    description:
      'Fetch road networks from OpenStreetMap (Overpass API) within a bounding box. The box can come from a dataset boundary, explicit mapBounds, or the current map viewport.',
    metadata: {readOnly: false, riskLevel: 'medium', requiresConfirmation: true, idempotent: false},
    inputSchema: z.object({
      datasetName: z
        .string()
        .optional()
        .describe('Dataset whose boundary defines the fetch area (takes precedence over mapBounds)'),
      mapBounds: z
        .object({
          northwest: z.object({longitude: z.number(), latitude: z.number()}),
          southeast: z.object({longitude: z.number(), latitude: z.number()})
        })
        .optional()
        .describe('Bounding box to fetch roads within'),
      outputDatasetName: z
        .string()
        .optional()
        .describe('Name for the output dataset (default: roads_<timestamp>)')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.roads', input ?? {});
        if (!result.success) {
          return {success: false, commandId: 'geo.roads', error: result.error};
        }
        return {success: true, commandId: 'geo.roads', data: result.data};
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.roads',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  };

  const usBoundary: RoomCommand = {
    id: 'geo.us-boundary',
    name: 'US boundaries',
    group: 'Geo',
    description:
      'Fetch US state, county, or zipcode boundary GeoJSON from public GitHub datasets.',
    metadata: {readOnly: false, riskLevel: 'medium', requiresConfirmation: true, idempotent: false},
    inputSchema: z.object({
      type: z.enum(['state', 'county', 'zipcode']).describe('Boundary type to fetch'),
      ids: z
        .array(z.string())
        .describe(
          'State names (lowercase, e.g. "california"), 5-digit county FIPS codes, or 5-digit zipcodes'
        ),
      outputDatasetName: z
        .string()
        .optional()
        .describe('Name for the output dataset (default: states_/counties_/zipcodes_<timestamp>)')
    }) as any,
    execute: async (_execCtx, input) => {
      try {
        const result = await runAnalysis('geo.us-boundary', input ?? {});
        if (!result.success) {
          return {success: false, commandId: 'geo.us-boundary', error: result.error};
        }
        return {success: true, commandId: 'geo.us-boundary', data: result.data};
      } catch (error) {
        return {
          success: false,
          commandId: 'geo.us-boundary',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  };

  return {
    'geo.routing': routing,
    'geo.isochrone': isochrone,
    'geo.geocode': geocoding,
    'geo.spatial-query': spatialQuery,
    'geo.grid': gridCommand,
    'geo.roads': roads,
    'geo.us-boundary': usBoundary
  };
}
