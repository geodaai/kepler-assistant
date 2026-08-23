/**
 * KeplerBridge — the optional kepler-bound seam the analysis engine calls for
 * operations that touch the host map app.
 *
 * The engine itself never imports kepler.gl. A host (the kepler.gl demo-app)
 * implements this interface and passes it to `AnalysisEngine` so the engine can
 * materialize kepler datasets into its connector, persist results back, and push
 * tables onto the map — while remaining kepler-agnostic (kepler-awareness is
 * injected, not imported).
 *
 * Every member is optional: with no bridge (the Node/MCP service path) the
 * engine behaves exactly as before — it reads whatever tables the connector
 * already holds, and geoda/geo ops that need host data return their current
 * errors.
 */

import type {ToolResult} from './types';

/**
 * Minimal GeoJSON feature shape the geoda spatial ops consume. Structural so
 * the bridge needs no `geojson` types dependency.
 */
export interface GeoJSONFeature {
  type: 'Feature';
  geometry: unknown;
  properties?: Record<string, unknown> | null;
  id?: string | number;
}

export interface KeplerBridge {
  /**
   * Ensure the named kepler dataset is queryable as a table under `name` in the
   * engine's connector. The engine issues `SELECT ... FROM <name>`, so the host
   * must expose the dataset under its **verbatim** name (e.g. a view over the
   * materialized `tbl_<sanitized>` table).
   */
  materializeDataset?(datasetName: string): Promise<void>;

  /**
   * GeoJSON features for a dataset, used by the geoda spatial ops
   * (spatial-weights, thiessen-polygons, mst, cartogram) when the caller does
   * not pass `geometries` explicitly.
   */
  getGeometries?(datasetName: string): Promise<GeoJSONFeature[] | undefined>;

  /**
   * Persist an analysis result so later SQL (`data.query` / `geo.spatial-query`)
   * can read it. `content` mirrors the host's DuckDB payloads:
   * `{type: 'columnData', content: {[col]: number[]}}` or
   * `{type: 'geojson', content: FeatureCollection}`.
   */
  saveResult?(name: string, result: {type: string; content: unknown}): Promise<void>;

  /**
   * Push a DuckDB table into kepler as a dataset (`data.load-to-map`, and
   * `data.filter` when it writes a filtered result). Returns the load result so
   * the engine can surface the dataset id.
   */
  loadToMap?(tableName: string): Promise<ToolResult>;

  /**
   * Append a computed column to a kepler dataset (a geoda output variable such
   * as a rate or standardized column), keeping it aligned with the dataset's
   * existing rows. Optional — called only when the caller requests the write.
   */
  addColumnToDataset?(datasetName: string, columnName: string, values: unknown[]): Promise<void>;

  /** Mapbox access token for `geo.routing` / `geo.isochrone` / `geo.geocode`. */
  getMapboxToken?(): Promise<string | undefined>;

  /** Current map boundary (`nw`/`se` corners) for `geo.roads` (Overpass bbox). */
  getMapBoundary?(): Promise<{nw: [number, number]; se: [number, number]} | undefined>;
}
