/** Page-wide Kepler bridge shared by standalone and host-room integrations. */
import {layerSetIsValid} from '@kepler.gl/actions';
import {setChartSelectionHandler} from './tools/echarts-renderers';
import {highlightRows, getValuesFromDataset, getDatasetContext, getConnector} from './glue/utils';
import {loadTableToKepler} from './glue/duckdb-cache';
import {loadTableIntoDuckDB} from './commands/query-commands';
import type {KeplerContext, KeplerStateAccessors, VisState} from './mcp';

let reduxStore: any = null;

// App-provided accessors for the kepler.gl application state the assistant
// needs. The host app supplies these via `setKeplerStateAccessors` so this
// module does not hard-code a redux state shape; any host app can provide
// accessors matching its own store. The reduxStore remains the generic Redux
// dispatch bridge (dispatch is not app-specific).
let keplerStateAccessors: KeplerStateAccessors | null = null;

export function setReduxStore(store: any) {
  reduxStore = store;
  // Dev-only hook: expose the redux store so browser validation harnesses can
  // inspect kepler.gl's visState (datasets, layers) directly.
  if (typeof window !== 'undefined') {
    (window as any).__keplerReduxStore = store;
  }
  // Wire the chart brush-selection callback now that redux is available, so the
  // standalone chart renderers (histogram + boxplot) can highlight the brushed
  // rows on the map. The chart renderers surface tool output produced by skill
  // sub-agents.
  setChartSelectionHandler((datasetName, selectedIndices) => {
    const visState = keplerStateAccessors?.getVisState();
    if (!visState) return;
    highlightRows(
      visState.datasets,
      visState.layers,
      datasetName,
      selectedIndices,
      (layer: any, isValid: boolean) => reduxStore?.dispatch(layerSetIsValid(layer, isValid))
    );
  });
}

/**
 * Provide accessors to the kepler.gl visState and map boundary. The host app
 * calls this (or passes `stateAccessors` to `AiAssistantPanel`) so the module
 * never hard-codes a redux state path. `reduxStore` is set separately via
 * `setReduxStore` and remains the dispatch bridge.
 */
export function setKeplerStateAccessors(accessors: KeplerStateAccessors) {
  keplerStateAccessors = accessors;
}

export function getReduxStore() {
  return reduxStore;
}

export function getReduxDispatch() {
  return reduxStore?.dispatch;
}

export function getKeplerVisState() {
  return keplerStateAccessors?.getVisState();
}

export function getKeplerContext(): KeplerContext {
  const ctx: KeplerContext = {
    getVisState: () => keplerStateAccessors?.getVisState() as VisState,
    getMapBoundary: () => keplerStateAccessors?.getMapBoundary(),
    getMapboxToken: () => {
      const apiKey = typeof window !== 'undefined' ? localStorage.getItem('mapbox-token') : null;
      return apiKey || undefined;
    },
    dispatch: (action: any) => reduxStore?.dispatch(action),
    // The kepler-app-bound glue methods. Implemented here (in the host-facing
    // bridge) so the map.* commands in the vendored map surface (./mcp) stay
    // free of the DuckDB / kepler-app wiring.
    getValuesFromDataset: (datasetName, variableName) => {
      const visState = keplerStateAccessors?.getVisState();
      if (!visState) return [];
      return getValuesFromDataset(visState.datasets, visState.layers, datasetName, variableName);
    },
    getDatasetContext: () => {
      const visState = keplerStateAccessors?.getVisState();
      return getDatasetContext(visState?.datasets, visState?.layers);
    },
    loadTableToKepler: (tableName, options) => loadTableToKepler(ctx, tableName, options),
    loadTableIntoDuckDB: (datasetName, variableNames, dbTableName) =>
      loadTableIntoDuckDB(
        async (ds, v) => {
          const visState = keplerStateAccessors?.getVisState();
          if (!visState) return [];
          return getValuesFromDataset(visState.datasets, visState.layers, ds, v);
        },
        datasetName,
        variableNames,
        dbTableName
      ),
    getConnector: () => getConnector()
  };
  return ctx;
}

