import {describe, expect, it, afterEach, vi} from 'vitest';
import {tableFromArrays} from 'apache-arrow';
import {
  ensureKeplerDatasetsMaterialized,
  setStoreConnectorProvider,
  buildDatasetUpdatePayload
} from './utils';
import {createMockConnector} from '../mock-connector';

// `utils.ts` imports `createWasmDuckDbConnector` from `@sqlrooms/duckdb` at
// runtime, which pulls in `@sqlrooms/room-config` — a package whose ESM build
// uses extensionless imports that Node's resolver rejects. The tests wire the
// connector via `setStoreConnectorProvider`, so the real factory is never
// called; mock the module to keep the broken chain out of the test graph.
vi.mock('@sqlrooms/duckdb', () => ({
  createWasmDuckDbConnector: () => {
    throw new Error('createWasmDuckDbConnector should not be called in tests');
  }
}));

/** Minimal kepler dataset shape `ensureKeplerDatasetsMaterialized` reads. */
function makeDataset(label: string) {
  return {
    label,
    type: 'geojson',
    length: 2,
    fields: [{name: 'RENT2008'}, {name: '_geojson'}],
    getValue: (name: string, i: number) =>
      name === 'RENT2008' ? [100, 200][i] : '{"type":"Point"}'
  };
}

afterEach(() => {
  setStoreConnectorProvider(null);
});

describe('ensureKeplerDatasetsMaterialized', () => {
  it('does not clobber a table the bridge already materialized (view stays valid)', async () => {
    const connector = createMockConnector();
    setStoreConnectorProvider(async () => connector);

    // Simulate the bridge's materializeDataset: a GeoJSON-flavored table
    // (geometry + properties) plus the verbatim-name view bound to it.
    await connector.execute('DROP TABLE IF EXISTS "tbl_nyc_geojson"');
    await connector.loadArrow(
      tableFromArrays({geometry: ['{}', '{}'], RENT2008: [100, 200]}),
      'tbl_nyc_geojson'
    );
    await connector.execute('CREATE VIEW "nyc.geojson" AS SELECT * FROM "tbl_nyc_geojson"');

    const datasets = {nyc: makeDataset('nyc.geojson')};
    await ensureKeplerDatasetsMaterialized(datasets as any, []);

    // The table must not have been dropped + recreated from kepler's fields —
    // that would change the schema and leave the view's stored column aliases
    // stale ("Binder Error: table "unnamed_subquery" has N columns available
    // but M columns specified").
    expect(connector.getLoadArrowCount('tbl_nyc_geojson')).toBe(1);
    expect(connector.hasTable('tbl_nyc_geojson')).toBe(true);
  });

  it('creates the table from kepler fields when it does not exist', async () => {
    const connector = createMockConnector();
    setStoreConnectorProvider(async () => connector);

    const datasets = {nyc: makeDataset('nyc.geojson')};
    await ensureKeplerDatasetsMaterialized(datasets as any, []);

    expect(connector.getLoadArrowCount('tbl_nyc_geojson')).toBe(1);
    expect(connector.hasTable('tbl_nyc_geojson')).toBe(true);
  });
});

describe('buildDatasetUpdatePayload', () => {
  const originalFields = [
    {name: 'NAME', type: 'string', analyzerType: 'STRING', format: ''},
    {name: 'KIDS2000', type: 'integer', analyzerType: 'INT', format: ''},
    {name: '_geojson', type: 'geojson', analyzerType: 'GEOMETRY', format: ''}
  ];

  it('materializes a DuckDB round-trip to plain rows with real geometry arrays', () => {
    const feature = (name: string) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74, 40.7],
            [-73.95, 40.7],
            [-73.95, 40.75],
            [-74, 40.7]
          ]
        ]
      },
      properties: {NAME: name, KIDS2000: name === 'NBH0' ? 39 : 20}
    });
    // This is exactly the shape DuckDB returns: `_geojson` is a Struct whose
    // nested coordinates come back as Arrow Vectors.
    const arrowTable = tableFromArrays({
      NAME: ['NBH0', 'NBH1'],
      KIDS2000: [39, 20],
      _geojson: [feature('NBH0'), feature('NBH1')],
      kidscat: [2, 1] // the newly added column
    });

    const {rows, fields} = buildDatasetUpdatePayload(arrowTable as any, originalFields as any);

    // RowDataContainer format: one column-ordered array per row
    expect(rows).toHaveLength(2);
    expect(rows[0].map(() => true)).toHaveLength(4);
    const geojsonValue = rows[0][2] as {geometry: {coordinates: number[][][]}};
    // the geometry must be a plain array, NOT an Arrow Vector wrapper
    expect(Array.isArray(geojsonValue.geometry.coordinates)).toBe(true);
    expect(geojsonValue.geometry.coordinates[0][0]).toEqual([-74, 40.7]);

    // existing columns keep their original descriptors (strict superset)
    const geojsonField = fields.find(f => f.name === '_geojson');
    expect(geojsonField.type).toBe('geojson');
    expect(geojsonField.analyzerType).toBe('GEOMETRY');
    // the new column is typed from the arrow schema
    const kidscatField = fields.find(f => f.name === 'kidscat');
    expect(kidscatField).toBeDefined();
    // field order matches the column order the rows are indexed by
    expect(fields.map(f => f.name)).toEqual(['NAME', 'KIDS2000', '_geojson', 'kidscat']);
  });
});
