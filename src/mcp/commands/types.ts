import {Datasets} from '@kepler.gl/table';
import type {DuckDbConnector} from '@sqlrooms/duckdb';
import {Dispatch} from 'redux';

export type VisState = {
  datasets: Datasets;
  layers: any[];
  layerData: any[];
  loaders: any[];
  loadOptions: Record<string, any>;
  [key: string]: any;
};

/**
 * Accessors to the kepler.gl application state the assistant needs. The host
 * app supplies these (via `setKeplerStateAccessors`) so this module never
 * hard-codes a redux state shape (e.g. `demo.keplerGl.map.visState`). Any
 * app can provide accessors matching its own store.
 */
export type KeplerStateAccessors = {
  getVisState: () => VisState;
  getMapBoundary: () =>
    | {
        nw: [number, number];
        se: [number, number];
      }
    | undefined;
};

/**
 * KeplerContext provides access to kepler.gl state and dispatch.
 * This is passed into tool factories instead of using Redux directly.
 *
 * The four glue methods (`getValuesFromDataset`, `getDatasetContext`,
 * `loadTableToKepler`, `loadTableIntoDuckDB`, `getConnector`) are the
 * kepler-app-bound seam the map.* commands call. They are implemented by the
 * host's glue (kepler-assistant) so this package stays free of the DuckDB /
 * kepler-app wiring.
 */
export type KeplerContext = {
  getVisState: () => VisState;
  getMapBoundary: () =>
    | {
        nw: [number, number];
        se: [number, number];
      }
    | undefined;
  getMapboxToken: () => string | undefined;
  dispatch: Dispatch;
  /** Read a column's values from a kepler dataset (by label). */
  getValuesFromDataset: (datasetName: string, variableName: string) => unknown[];
  /** Build the dataset+layer context string for the LLM. */
  getDatasetContext: () => string;
  /** Load a DuckDB table into kepler.gl as a dataset. */
  loadTableToKepler: (
    tableName: string,
    options?: {autoCreateLayers?: boolean; centerMap?: boolean}
  ) => Promise<{success: boolean; error?: string}>;
  /** Materialize a kepler dataset's columns into a DuckDB table and return the connector. */
  loadTableIntoDuckDB: (
    datasetName: string,
    variableNames: string[],
    dbTableName: string
  ) => Promise<DuckDbConnector>;
  /** The shared DuckDB connector (the store's, when wired). */
  getConnector: () => Promise<DuckDbConnector>;
};
