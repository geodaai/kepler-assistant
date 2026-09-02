import interpolate from 'color-interpolate';
import {Feature} from 'geojson';
import {Layer} from '@kepler.gl/layers';
import {Datasets, KeplerTable} from '@kepler.gl/table';
import {ALL_FIELD_TYPES, LAYER_TYPES} from '@kepler.gl/constants';
import {ProtoDataset, ProtoDatasetField} from '@kepler.gl/types';
import {processFileData} from '@kepler.gl/processors';
import {createWasmDuckDbConnector, type DuckDbConnector} from '@sqlrooms/duckdb';
import {tableFromArrays} from 'apache-arrow';
// The shared map-surface helpers now live in @kepler.gl/mcp (moved out of this
// glue during the map-surface separation — see NEXT_PLAN.md). The glue keeps
// importing the ones its remaining code needs: object-column stringify/restore
// used to materialize kepler datasets into DuckDB, vector-tile field reads, and
// the deterministic table-name sanitizer.
import {
  getValuesFromDataset,
  getValuesFromVectorTileLayer,
  isVectorTileLayer,
  stringifyObjectColumn,
  datasetNameToTableName
} from '@kepler.gl/mcp';

// The kepler tools DuckDB connector. Prefer the store's DuckDB slice connector
// when wired via `setStoreConnectorProvider`, so skills (which materialize kepler
// datasets into DuckDB) and the main-agent `query` tool share ONE DuckDB
// instance. Without this, the two connectors diverge: skills write tables the
// query tool can't see, and vice versa. Falls back to a standalone
// WasmDuckDbConnector singleton when no store provider is wired (legacy path,
// e.g. unit tests that never construct the full store).
let connector: DuckDbConnector | null = null;
let storeConnectorProvider: (() => Promise<DuckDbConnector>) | null = null;

/**
 * Wire a resolver that returns the store's DuckDB connector. Called once at
 * store construction (see store.ts) so every `getConnector()` caller — tools,
 * skills, the wrapped query tool — reaches the same DuckDB instance.
 */
export function setStoreConnectorProvider(
  provider: (() => Promise<DuckDbConnector>) | null
): void {
  storeConnectorProvider = provider;
  // Invalidate the fallback singleton so a later re-wire picks up the store's
  // connector instead of a previously-created standalone instance.
  connector = null;
  // Invalidate the materialized-tables cache so datasets are re-materialized
  // against the new connector.
  resetMaterializedDatasets();
}

export async function getConnector(): Promise<DuckDbConnector> {
  if (storeConnectorProvider) {
    return storeConnectorProvider();
  }
  if (!connector) {
    connector = createWasmDuckDbConnector();
    await connector.initialize();
  }
  return connector;
}

let spatialExtensionLoaded = false;

export async function ensureSpatialExtension(): Promise<void> {
  if (spatialExtensionLoaded) return;
  const db = await getConnector();
  await db.execute(`INSTALL spatial; LOAD spatial;`);
  spatialExtensionLoaded = true;
}

export function interpolateColor(originalColors: string[], numberOfColors: number) {
  if (originalColors.length === numberOfColors) {
    return originalColors;
  }
  const interp = interpolate(originalColors);
  const colors = Array.from({length: numberOfColors}, (_, j) => interp(j / (numberOfColors - 1)));
  const hexColors = colors.map(color => {
    const rgb = color.match(/\d+/g);
    return `#${rgb?.map(c => parseInt(c).toString(16).padStart(2, '0')).join('')}`;
  });
  return hexColors;
}

export function highlightRows(
  datasets: Datasets,
  layers: Layer[],
  datasetName: string,
  selectedRowIndices: number[],
  layerSetIsValid: (layer: Layer, isValid: boolean) => void
) {
  const datasetId = Object.keys(datasets).find(dataId => datasets[dataId].label === datasetName);
  if (!datasetId) return;
  const dataset = datasets[datasetId];
  if (dataset) {
    dataset.filteredIndex =
      selectedRowIndices.length === 0 ? dataset.allIndexes : selectedRowIndices;
    const selectLayers = layers.filter(layer => layer.config.dataId === dataset.id);
    selectLayers.forEach(layer => {
      layer.formatLayerData(datasets);
      layerSetIsValid(layer, true);
    });
  }
}

export function getDatasetContext(datasets?: Datasets, layers?: Layer[]) {
  if (!datasets || !layers) return '';
  const context =
    'Please remember the following datasets and layers for answering the user question:';
  const dataMeta = Object.values(datasets).map((dataset: KeplerTable) => ({
    datasetName: dataset.label,
    datasetId: dataset.id,
    fields: dataset.fields.map(field => ({[field.name]: field.type})),
    layers: layers
      .filter(layer => layer.config.dataId === dataset.id)
      .map(layer => ({
        id: layer.id,
        label: layer.config.label,
        type: layer.type,
        geometryMode: layer.config.columnMode,
        geometryColumns: Object.fromEntries(
          Object.entries(layer.config.columns)
            .filter(([, value]) => value !== null)
            .map(([key, value]) => [
              key,
              typeof value === 'object' && value !== null
                ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null))
                : value
            ])
        )
      }))
  }));
  return `${context}\n${JSON.stringify(dataMeta)}`;
}

export type SpatialJoinGeometries = Feature[] | unknown[];

export function getGeometriesFromDataset(
  datasets: Datasets,
  layers: Layer[],
  layerData: any[],
  datasetName: string
): SpatialJoinGeometries {
  const datasetId = Object.keys(datasets).find(dataId => datasets[dataId].label === datasetName);
  if (!datasetId) {
    return [];
  }
  const dataset = datasets[datasetId];

  if (dataset.type === 'vector-tile') {
    const selected = layers.filter(layer => layer.config.dataId === dataset.id);
    const layer = selected.find(layer => layer.type === LAYER_TYPES.vectorTile);
    if (!layer) return [];
    const geometries: Feature[] = [];
    // @ts-expect-error TODO fix this later in the vector-tile layer
    for (const row of layer.tileDataset.tileSet) {
      geometries.push(row);
    }
    return geometries;
  }

  const selectedLayers = layers.filter(layer => layer.config.dataId === dataset.id);
  if (selectedLayers.length === 0) return [];

  const geojsonLayer = selectedLayers.find(layer => layer.type === LAYER_TYPES.geojson);
  const pointLayer = selectedLayers.find(layer => layer.type === LAYER_TYPES.point);
  const otherLayers = selectedLayers.filter(
    layer => layer.type !== LAYER_TYPES.geojson && layer.type !== LAYER_TYPES.point
  );

  const validLayer = geojsonLayer || pointLayer || otherLayers[0];
  if (validLayer) {
    const layerIndex = layers.findIndex(layer => layer.id === validLayer.id);
    const geometries = layerData[layerIndex];
    return geometries.data;
  }

  return [];
}

export function saveAsDataset(
  datasets: Datasets,
  layers: Layer[],
  datasetName: string,
  newDatasetName: string,
  data: Record<string, unknown[]>
) {
  const datasetId = Object.keys(datasets).find(dataId => datasets[dataId].label === datasetName);
  if (!datasetId) return;
  if (Object.keys(datasets).includes(newDatasetName)) return;

  const leftDataset = datasets[datasetId];
  let numRows = leftDataset.length;
  let geometries: Feature[];

  if (leftDataset.type === 'vector-tile') {
    geometries = getFeaturesFromVectorTile(leftDataset, layers) || [];
    numRows = geometries.length;
  }

  const fields: ProtoDatasetField[] = [
    ...Object.keys(data).map((fieldName, index) => ({
      name: fieldName,
      id: `${fieldName}_${index}`,
      displayName: fieldName,
      type: determineFieldType(data[fieldName][0])
    })),
    ...leftDataset.fields.map((field, index) => ({
      name: field.name,
      id: field.id || `${field.name}_${index}`,
      displayName: field.displayName,
      type: field.type
    })),
    ...(leftDataset.type === 'vector-tile'
      ? [{name: '_geojson', id: '_geojson', displayName: '_geojson', type: 'geojson'}]
      : [])
  ];

  const dataValues = Object.values(data);

  const rows = Array(numRows)
    .fill(null)
    .map((_, rowIdx) => [
      ...dataValues.map(col => col[rowIdx]),
      ...leftDataset.fields.map(field =>
        leftDataset.type === 'vector-tile'
          ? geometries[rowIdx].properties?.[field.name]
          : leftDataset.getValue(field.name, rowIdx)
      ),
      ...(leftDataset.type === 'vector-tile' ? [geometries[rowIdx]] : [])
    ]);

  const newDataset: ProtoDataset = {
    info: {id: newDatasetName, label: newDatasetName},
    data: {fields, rows}
  };

  return newDataset;
}

function determineFieldType(value: unknown): keyof typeof ALL_FIELD_TYPES {
  return typeof value === 'number'
    ? Number.isInteger(value)
      ? ALL_FIELD_TYPES.integer
      : ALL_FIELD_TYPES.real
    : ALL_FIELD_TYPES.string;
}

function getFeaturesFromVectorTile(leftDataset: KeplerTable, layers: Layer[]) {
  const layerIndex = layers.findIndex(layer => layer.config.dataId === leftDataset.id);
  if (layerIndex === -1) return;
  const layer = layers[layerIndex];
  if (!isVectorTileLayer(layer)) return;
  const features: Feature[] = [];
  // @ts-expect-error TODO fix this later in the vector-tile layer
  for (const row of layer.tileDataset.tileSet) {
    features.push(row);
  }
  return features;
}

export async function appendColumnsToDataset(
  datasets: Datasets,
  layers: Layer[],
  datasetName: string,
  result: Record<string, number>[],
  newDatasetName: string
) {
  const datasetId = Object.keys(datasets).find(dataId => datasets[dataId].label === datasetName);
  if (!datasetId) {
    throw new Error(`Dataset ${datasetName} not found`);
  }

  const originalDataset = datasets[datasetId];
  const fields = originalDataset.fields;
  const numRows = originalDataset.length || result.length;
  const rowObjects: Record<string, unknown>[] = [];

  if (originalDataset.type === 'vector-tile') {
    const columnData: Record<string, unknown[]> = {};
    for (const field of fields) {
      columnData[field.name] = getValuesFromVectorTileLayer(datasetId, layers, field);
    }
    for (let i = 0; i < numRows; i++) {
      const rowObject: Record<string, unknown> = {};
      for (const field of fields) {
        rowObject[field.name] = columnData[field.name][i];
      }
      rowObjects.push(rowObject);
    }
  } else {
    for (let i = 0; i < numRows; i++) {
      const rowObject: Record<string, unknown> = {};
      for (const field of fields) {
        const value = originalDataset.getValue(field.name, i);
        rowObject[field.name] = value;
      }
      rowObjects.push(rowObject);
    }
  }

  for (let i = 0; i < numRows; i++) {
    const queryRow = result[i];
    const rowObject = rowObjects[i];
    Object.keys(queryRow).forEach(key => {
      const value = queryRow[key];
      rowObject[key] = value;
    });
  }

  const processedData = await processFileData({
    content: {fileName: newDatasetName, data: rowObjects},
    fileCache: []
  });

  return processedData;
}

/**
 * Set of kepler dataset labels already materialized into DuckDB in this
 * session, so `ensureKeplerDatasetsMaterialized` is idempotent and cheap on
 * repeat calls. Cleared when the connector is rewired via
 * `setStoreConnectorProvider` (the new connector has no tables yet).
 */
const materializedDatasetLabels = new Set<string>();

/**
 * Eagerly materialize all currently-loaded kepler.gl datasets into DuckDB as
 * `tbl_<sanitized-label>` tables (via `datasetNameToTableName`), so the
 * main-agent `query` tool can `SHOW TABLES` / `DESCRIBE` / `SELECT` against
 * them even before any skill has run.
 *
 * Kepler datasets live in-memory in `visState.datasets`; without this step a
 * raw `DESCRIBE tbl_new_dataset` fails with "Table does not exist" because no
 * skill has lazily materialized it yet. This mirrors the lazy
 * `loadTableIntoDuckDB` in query-tool.ts but runs eagerly for every loaded
 * dataset, closing the kepler ↔ DuckDB gap.
 *
 * Idempotent: skips datasets already materialized in this session. Only
 * materializes non-vector-tile datasets (those whose fields can be read via
 * `getValuesFromDataset`). Errors per-dataset are swallowed and logged so one
 * bad dataset doesn't block the rest.
 *
 * @param datasets kepler `visState.datasets`
 * @param layers kepler `visState.layers` (needed by getValuesFromDataset for
 *               vector-tile field lookups)
 */
export async function ensureKeplerDatasetsMaterialized(
  datasets: Datasets,
  layers: Layer[]
): Promise<void> {
  if (!datasets) return;
  const db = await getConnector();

  for (const dataset of Object.values(datasets) as KeplerTable[]) {
    const label = dataset.label;
    if (!label || materializedDatasetLabels.has(label)) continue;
    // Skip vector-tile datasets — their fields can't be materialized as columns.
    if (dataset.type === 'vector-tile') continue;

    try {
      const dbTableName = datasetNameToTableName(label);
      // If the table already exists, leave it alone. The bridge's
      // `materializeDataset` may have materialized this dataset in the GeoJSON
      // flavor (a `geometry` column + one column per raw feature property) and
      // created a view under the dataset's verbatim name bound to that schema.
      // Recreating the table from kepler's field columns changes the schema
      // (geometry → `_geojson`, and kepler's field list can differ from the raw
      // properties), which leaves the view's stored column aliases stale and
      // every `SELECT ... FROM "<dataset name>"` fails with
      // "Binder Error: table "unnamed_subquery" has N columns available but M
      // columns specified". The bridge re-materializes on demand, so a table
      // that already exists is fresh enough for the query tool.
      const exists = await db.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_name = '${dbTableName.replace(/'/g, "''")}'
           AND table_type = 'BASE TABLE'
         LIMIT 1`
      );
      if (exists.toArray().length > 0) {
        materializedDatasetLabels.add(label);
        continue;
      }

      const variableNames = dataset.fields.map(f => f.name);
      if (variableNames.length === 0) continue;

      const columnData: Record<string, unknown[]> = {};
      for (const varName of variableNames) {
        // Stringify object-valued columns (`_geojson` Features) so mixed
        // Polygon/MultiPolygon coordinate nesting survives `tableFromArrays`.
        columnData[varName] = stringifyObjectColumn(
          getValuesFromDataset(datasets, layers, label, varName)
        );
      }
      const arrowTable = tableFromArrays(columnData);
      await db.loadArrow(arrowTable, dbTableName);
      materializedDatasetLabels.add(label);
    } catch (err) {
      // Don't let one bad dataset block the rest; the skill path can still
      // materialize it lazily later.
      console.warn(`[ensureKeplerDatasetsMaterialized] Failed for "${label}":`, err);
    }
  }
}

/**
 * Reset the materialization cache. Called when the connector is rewired (so
 * datasets are re-materialized against the new connector) or when kepler
 * datasets change (e.g. a new dataset is loaded).
 */
export function resetMaterializedDatasets(): void {
  materializedDatasetLabels.clear();
}
