// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * The demo-app's implementation of the kepler-assistant `KeplerBridge`.
 *
 * The kepler-assistant `AnalysisEngine` stays kepler-agnostic: it never imports
 * @kepler.gl. For kepler-bound steps (materializing a kepler dataset into the
 * connector, pushing a result table onto the map, writing a computed column back
 * to a kepler dataset, resolving geometries / mapbox token / map boundary) the
 * engine calls this host-provided bridge. This module is the adapter that wires
 * the engine to the app's existing kepler glue (`tools/utils.ts`,
 * `tools/duckdb-cache.ts`, the redux store) — reusing those helpers, not
 * duplicating them.
 */

import type {KeplerBridge} from '../kepler-bridge';
import {tableFromArrays} from 'apache-arrow';
import {updateDataset} from '@kepler.gl/actions';
import {arrowSchemaToFields} from '@kepler.gl/processors';
import type {KeplerContext} from '@kepler.gl/mcp';
import {
  getValuesFromDataset,
  getGeometriesFromDataset,
  datasetNameToTableName,
  getConnector,
  ensureSpatialExtension
} from '../glue/utils';
import {
  saveToDuckdb,
  loadTableToKepler,
  getTableAsGeoJSON,
  saveGeojsonToDuckdb,
  tableExists
} from '../glue/duckdb-cache';

/** Build the bridge for the given kepler context (state + dispatch). */
export function createKeplerBridge(ctx: KeplerContext): KeplerBridge {
  const getVisState = () => ctx.getVisState();

  return {
    /**
     * Make a kepler dataset queryable in the connector under its verbatim name:
     * materialize into `tbl_<sanitized>` (dropping + reloading so a dataset that
     * changed on the map is always fresh), then expose a view under the verbatim
     * name so the engine's `SELECT ... FROM <datasetName>` works.
     *
     * Datasets with geometry are materialized in the GeoJSON flavor the engine's
     * spatial SQL expects — a `geometry` column (JSON string) + one column per
     * feature property — NOT kepler's map-side field list (which names the
     * geometry `_geojson`). This mirrors the old demo-app `ensureDatasetInDuckdb`
     * path, so `ST_GeomFromGeoJSON(geometry)` and the property reads
     * (`columnValues`) both resolve. Tabular datasets (no layer geometry) fall
     * back to their field columns.
     */
    materializeDataset: async datasetName => {
      const db = await getConnector();
      const visState = getVisState();
      const datasets = visState.datasets;
      const dataId = datasets
        ? Object.keys(datasets).find(id => datasets[id].label === datasetName)
        : undefined;

      const tblName = datasetNameToTableName(datasetName);
      if (dataId) {
        const dataset = datasets[dataId];
        // Vector-tile datasets can't be materialized as columns.
        if (dataset.type !== 'vector-tile') {
          const features = getGeometriesFromDataset(
            datasets,
            visState.layers,
            visState.layerData,
            datasetName
          );
          if (features && features.length > 0) {
            await saveGeojsonToDuckdb(tblName, {
              type: 'FeatureCollection',
              features: (features as any[]).map((feat: any) => ({
                type: 'Feature',
                geometry: feat.geometry || feat,
                properties: feat.properties || {}
              }))
            });
          } else {
            const fields = dataset.fields.map((f: any) => f.name).filter((n: unknown) => n);
            if (fields.length > 0) {
              const columnData: Record<string, unknown[]> = {};
              for (const field of fields) {
                columnData[field] = getValuesFromDataset(
                  datasets,
                  visState.layers,
                  datasetName,
                  field
                );
              }
              const arrowTable = tableFromArrays(columnData);
              await db.execute(`DROP TABLE IF EXISTS "${tblName}"`);
              await db.loadArrow(arrowTable, tblName);
            }
          }
        }
      }

      await ensureSpatialExtension();
      // A BASE TABLE already registered under the verbatim name (e.g. a table
      // the user created via SQL and loaded to map — `test_numeric`) IS the real
      // queryable source the engine should read; don't shadow it with a view and
      // don't try to DROP it (`DROP VIEW` fails on a TABLE). Only manage stale
      // VIEWs from a prior materialization.
      const verbatim = await db.query(
        `SELECT table_type FROM information_schema.tables WHERE table_name = '${datasetName.replace(
          /'/g,
          "''"
        )}'`
      );
      const isBaseTable = verbatim
        .toArray()
        .some(
          (r: any) =>
            String(r.table_type ?? r.toJSON?.()?.table_type ?? '') === 'BASE TABLE'
        );
      if (!isBaseTable) {
        // `CREATE OR REPLACE VIEW` errors if a TABLE with the same name exists;
        // drop a stale view first so the engine can re-materialize after a
        // dataset reload. Only create when the backing table exists (a chart op
        // on a not-yet-saved result table shouldn't fail the view creation).
        await db.execute(`DROP VIEW IF EXISTS "${datasetName.replace(/"/g, '""')}"`);
        if (await tableExists(tblName)) {
          await db.execute(
            `CREATE VIEW "${datasetName.replace(/"/g, '""')}" AS SELECT * FROM "${tblName}"`
          );
        }
      }
    },

    /**
     * GeoJSON features for a kepler dataset, falling back to the materialized
     * DuckDB table (spatial results saved via `saveToDuckdb`).
     */
    getGeometries: async datasetName => {
      const visState = getVisState();
      let geoms = getGeometriesFromDataset(
        visState.datasets,
        visState.layers,
        visState.layerData,
        datasetName
      );
      if (!geoms || geoms.length === 0) {
        const geojson = await getTableAsGeoJSON(datasetNameToTableName(datasetName));
        if (geojson && geojson.features.length > 0) {
          geoms = geojson.features;
        }
      }
      return Array.isArray(geoms) && geoms.length > 0 ? (geoms as any[]) : undefined;
    },

    /**
     * Persist an engine result (geojson / columnData / rowObjects) into the
     * connector under `tbl_<sanitized>`, the canonical name downstream SQL and
     * `data.load-to-map` resolve.
     */
    saveResult: async (name, result) => {
      await saveToDuckdb(datasetNameToTableName(name), result);
    },

    /**
     * Push a connector table into kepler as a dataset (data.load-to-map /
     * data.filter result). Returns a ToolResult so the engine can surface the
     * loaded dataset id.
     */
    loadToMap: async tableName => {
      const result = await loadTableToKepler(ctx, tableName);
      if (!result.success) {
        return {success: false, error: result.error ?? `Failed to load "${tableName}" to map`};
      }
      return {success: true, data: {table: tableName, datasetId: tableName}};
    },

    /**
     * Append a computed column to a kepler dataset in place (geoda write-back).
     * Mirrors `map.add-column`'s UPDATE_DATASET flow: rebuild the arrow table
     * with existing columns plus the new one so layers/filters keep working.
     */
    addColumnToDataset: async (datasetName, columnName, values) => {
      const visState = getVisState();
      const datasets = visState.datasets;
      const dataId = Object.keys(datasets).find(id => datasets[id].label === datasetName);
      if (!dataId) throw new Error(`Dataset "${datasetName}" not found.`);
      const fieldNames = datasets[dataId].fields.map((f: any) => f.name);
      if (fieldNames.includes(columnName)) {
        throw new Error(
          `Column "${columnName}" already exists in dataset "${datasetName}". Choose a different name.`
        );
      }
      const columnData: Record<string, unknown[]> = {};
      for (const field of fieldNames) {
        columnData[field] = getValuesFromDataset(
          datasets,
          visState.layers,
          datasetName,
          field
        );
      }
      columnData[columnName] = values;
      const arrowTable = tableFromArrays(columnData);
      ctx.dispatch(
        updateDataset(dataId, {
          cols: Array.from({length: arrowTable.numCols}, (_, i) => arrowTable.getChildAt(i)),
          fields: arrowSchemaToFields(arrowTable as any),
          arrowTable
        } as any)
      );
    },

    getMapboxToken: async () => ctx.getMapboxToken(),

    getMapBoundary: async () => ctx.getMapBoundary()
  };
}
