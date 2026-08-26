import {describe, expect, it, afterEach, vi} from 'vitest';
import {tableFromArrays} from 'apache-arrow';
import {ensureKeplerDatasetsMaterialized, setStoreConnectorProvider} from './utils';
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
