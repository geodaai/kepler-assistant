import {describe, expect, it, afterEach, vi} from 'vitest';
import {tableFromArrays} from 'apache-arrow';
import {
  ensureKeplerDatasetsMaterialized,
  setStoreConnectorProvider,
  buildAddColumnPayload,
  arrowTableToObjects,
  isObjectColumn,
  stringifyObjectColumn,
  restoreObjectColumns
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

describe('buildAddColumnPayload', () => {
  const originalFields = [
    {name: 'NAME', type: 'string', analyzerType: 'STRING', format: ''},
    {name: 'KIDS2000', type: 'integer', analyzerType: 'INT', format: ''},
    {name: '_geojson', type: 'geojson', analyzerType: 'GEOMETRY', format: ''}
  ];

  // Mixed Polygon + MultiPolygon features — the case that broke: rebuilding the
  // whole table through `tableFromArrays` infers the shallower Arrow type and
  // nulls the MultiPolygon's deeper coordinate nesting.
  const features = [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74, 40.7],
            [-73.9, 40.7],
            [-73.9, 40.8],
            [-74, 40.7]
          ]
        ]
      },
      properties: {NAME: 'NBH0', KIDS2000: 39}
    },
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-73.9, 40.7],
              [-73.8, 40.7],
              [-73.8, 40.8],
              [-73.9, 40.7]
            ]
          ]
        ]
      },
      properties: {NAME: 'NBH1', KIDS2000: 20}
    }
  ];

  const datasets = {
    nyc: {
      label: 'nyc.geojson',
      type: 'geojson',
      length: 2,
      fields: originalFields,
      getValue: (name: string, i: number) => {
        if (name === '_geojson') return features[i];
        if (name === 'NAME') return features[i].properties.NAME;
        return features[i].properties.KIDS2000;
      }
    }
  };

  it('keeps mixed Polygon/MultiPolygon _geojson coordinates intact', () => {
    // the new column's single-column arrow result (what DuckDB / geoda returns)
    const newColumnArrow = tableFromArrays({kidscat: [2, 1]});

    const {rows, fields} = buildAddColumnPayload(
      datasets as any,
      [] as any,
      'nyc.geojson',
      'kidscat',
      newColumnArrow
    );

    // RowDataContainer format: one column-ordered array per row
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(4); // NAME, KIDS2000, _geojson, kidscat

    // the MultiPolygon's coordinates must be real arrays, NOT nulls
    const mp = rows[1][2] as {geometry: {type: string; coordinates: number[][][][]}};
    expect(mp.geometry.type).toBe('MultiPolygon');
    expect(Array.isArray(mp.geometry.coordinates)).toBe(true);
    expect(mp.geometry.coordinates[0][0][0]).toEqual([-73.9, 40.7]);
    // the Polygon's coordinates too
    const poly = rows[0][2] as {geometry: {coordinates: number[][][]}};
    expect(poly.geometry.coordinates[0][0]).toEqual([-74, 40.7]);

    // the new column's values are appended
    expect(rows[0][3]).toBe(2);
    expect(rows[1][3]).toBe(1);

    // existing fields keep their original descriptors; the new field is appended
    expect(fields.map(f => f.name)).toEqual(['NAME', 'KIDS2000', '_geojson', 'kidscat']);
    const geojsonField = fields.find(f => f.name === '_geojson');
    expect(geojsonField.type).toBe('geojson');
    expect(geojsonField.analyzerType).toBe('GEOMETRY');
    expect(fields[3].name).toBe('kidscat');
  });
});

describe('stringifyObjectColumn / restoreObjectColumns', () => {
  // Mixed Polygon + MultiPolygon features — the shape that broke `map.create-table`
  // (and the shared materialization helpers): handed to `tableFromArrays` raw, Arrow
  // infers the shallower (Polygon) type for the whole column and nulls the
  // MultiPolygon's deeper coordinate nesting.
  const features = [
    {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74, 40.7],
            [-73.9, 40.7],
            [-73.9, 40.8],
            [-74, 40.7]
          ]
        ]
      }
    },
    {
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-73.9, 40.7],
              [-73.8, 40.7],
              [-73.8, 40.8],
              [-73.9, 40.7]
            ]
          ]
        ]
      }
    }
  ];

  it('flags columns holding object values', () => {
    expect(isObjectColumn([null, features[0].geometry])).toBe(true);
    expect(isObjectColumn([undefined])).toBe(false);
    expect(isObjectColumn([null, 'plain string'])).toBe(false);
    expect(isObjectColumn([null, 42])).toBe(false);
  });

  it('keeps mixed Polygon/MultiPolygon coordinates intact through the DuckDB Arrow round-trip', () => {
    // The exact sequence `map.create-table` (and `ensureKeplerDatasetsMaterialized` /
    // `loadTableIntoDuckDB`) run: stringify object columns before `tableFromArrays`,
    // then restore the JSON strings back to objects after `arrowTableToObjects`.
    const geometry = features.map(f => f.geometry);
    const objectColumns = isObjectColumn(geometry) ? ['_geojson'] : [];

    const arrowTable = tableFromArrays({_geojson: stringifyObjectColumn(geometry)});
    const jsonResult = arrowTableToObjects(arrowTable);
    restoreObjectColumns(jsonResult, objectColumns);

    expect(jsonResult).toHaveLength(2);

    const poly = jsonResult[0]._geojson as {type: string; coordinates: number[][][]};
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates[0][0]).toEqual([-74, 40.7]);

    const mp = jsonResult[1]._geojson as {type: string; coordinates: number[][][][]};
    expect(mp.type).toBe('MultiPolygon');
    expect(Array.isArray(mp.coordinates)).toBe(true);
    expect(mp.coordinates[0][0][0]).toEqual([-73.9, 40.7]);
  });

  it('raw tableFromArrays nulls the MultiPolygon coordinates (why stringify is needed)', () => {
    // Canary: if Arrow ever stops nulling deeper nesting, this test fails loudly and
    // the stringify/restore dance may become unnecessary.
    const raw = tableFromArrays({_geojson: features.map(f => f.geometry)});
    const jsonResult = arrowTableToObjects(raw);
    const mp = jsonResult[1]._geojson as {coordinates: (number | null)[][][][]};
    expect(Array.isArray(mp.coordinates[0][0][0])).toBe(false);
  });

  it('passes plain columns through unchanged', () => {
    const values = ['a', 'b', null];
    expect(stringifyObjectColumn(values)).toBe(values);
  });

  it('leaves non-JSON strings alone during restore', () => {
    const rows = [{_geojson: 'not json'}];
    restoreObjectColumns(rows, ['_geojson']);
    expect(rows[0]._geojson).toBe('not json');
  });
});
