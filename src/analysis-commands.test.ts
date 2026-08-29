import {describe, expect, it} from 'vitest';
import {tableFromJSON} from 'apache-arrow';
import {AnalysisEngine} from './analysis-commands';
import {createMockConnector} from './mock-connector';

/** Fresh engine per test, backed by the mock connector (real @geoda WASM). */
function makeEngine() {
  return new AnalysisEngine(createMockConnector());
}

const SALES_ROWS = [
  {region: 'east', amount: 10},
  {region: 'east', amount: 20},
  {region: 'west', amount: 5}
];

const NEIGHBORS = [[1, 2], [0, 3], [0, 3], [1, 2]];

const square = (x: number, y: number) => ({
  type: 'Feature' as const,
  properties: {id: `${x}-${y}`},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]
  }
});

const point = (x: number, y: number) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {type: 'Point' as const, coordinates: [x, y]}
});

describe('AnalysisEngine', () => {
  it('data.create-table issues SQL and returns the table name', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('data.create-table', {name: 'sales', rows: SALES_ROWS});
    expect(res.success).toBe(true);
    expect((res.data as {tableName?: string}).tableName).toBe('sales');
  });

  it('data.query returns columns and rows', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('data.query', {sql: 'SELECT region, amount FROM sales'});
    const data = res.data as {columns?: string[]; totalRows?: number};
    expect(res.success).toBe(true);
    expect(data.columns).toBeDefined();
    expect(data.totalRows).toBeGreaterThan(0);
  });

  it('data.query converts Arrow STRUCT rows to plain JSON (no StructRow proxies)', async () => {
    // DuckDB returns STRUCT columns (e.g. `_geojson`) as Arrow StructRow
    // proxies whose isExtensible trap violates the proxy invariant — immer
    // produce on such a value throws `'isExtensible' on proxy: ...`. The
    // engine must return plain objects so the harness store can persist them.
    const feature = {
      type: 'Feature',
      geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 1]]]},
      properties: {NAME: 'NBH0'}
    };
    const connector = createMockConnector();
    connector.query = (async (sql: string) => {
      if (/information_schema\.tables/.test(sql)) {
        return tableFromJSON([{table_name: 'tbl_nyc_geojson'}]);
      }
      return tableFromJSON([{_geojson: feature, NAME: 'NBH0'}]);
    }) as any;
    const analysis = new AnalysisEngine(connector as any);
    const res = await analysis.invoke('data.query', {sql: 'SELECT * FROM tbl_nyc_geojson'});
    expect(res.success).toBe(true);
    const row = (res.data as {firstFiveRows?: Array<Record<string, any>>}).firstFiveRows?.[0];
    expect(row?._geojson?.constructor?.name).not.toBe('StructRow');
    expect(() => Object.isExtensible(row?._geojson)).not.toThrow();
    expect(JSON.parse(JSON.stringify(row))).toEqual({_geojson: feature, NAME: 'NBH0'});
  });

  it('chart.histogram computes real bins from connector values', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('chart.histogram', {table: 'sales', column: 'amount', bins: 2});
    expect((res.data as {totalValues?: number}).totalValues).toBe(4);
  });

  it('chart.histogram lists available tables when the requested one is missing', async () => {
    // A connector that throws DuckDB's binder error for missing tables and
    // answers `information_schema.tables` (used by listTables) with the real
    // catalog — so the engine can tell the model what DOES exist.
    const connector = createMockConnector();
    const throwingQuery = async (sql: string) => {
      if (/information_schema\.tables/.test(sql)) {
        return tableFromJSON([
          {table_name: 'sales'},
          {table_name: 'tbl_nyc_geojson'},
          {table_name: 'nyc.geojson'}
        ]);
      }
      throw new Error('Catalog Error: Table with name NYC does not exist!');
    };
    connector.query = throwingQuery as any;
    const analysis = new AnalysisEngine(connector as any);
    const res = await analysis.invoke('chart.histogram', {table: 'NYC', column: 'RENT2008', bins: 4});
    expect(res.success).toBe(false);
    expect(res.error).toContain('does not exist');
    expect(res.error).toContain('"nyc.geojson"');
    expect(res.error).toContain('"sales"');
  });

  it('chart.boxplot computes median and IQR', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('chart.boxplot', {table: 'sales', variableNames: ['amount']});
    const data = res.data as {
      boxplots?: Array<{median?: number; iqr?: number}>;
      __ui?: {
        boxplotData?: {
          boxplots?: Array<{
            name?: string;
            low?: number;
            q1?: number;
            q2?: number;
            q3?: number;
            high?: number;
            mean?: number;
          }>;
          meanPoint?: [string, number][];
        };
        rawData?: Record<string, number[]>;
        rawDataIndices?: Record<string, number[]>;
      };
    };
    const box = data.boxplots?.[0];
    expect(box?.median).toBe(15);
    expect(box?.iqr).toBe(10);

    // Renderer-only payload under `__ui`: whisker-fence box, mean marker, and
    // raw values with their dataset row indexes for brush-selection.
    const chartBox = data.__ui?.boxplotData?.boxplots?.[0];
    expect(chartBox).toMatchObject({name: 'amount', low: -5, q1: 10, q2: 15, q3: 20, high: 35, mean: 15});
    expect(data.__ui?.boxplotData?.meanPoint).toEqual([['amount', 15]]);
    expect(data.__ui?.rawData).toEqual({amount: [10, 10, 20, 20]});
    expect(data.__ui?.rawDataIndices).toEqual({amount: [0, 1, 2, 3]});
  });

  it('chart.pcp computes per-column stats', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('chart.pcp', {table: 'sales', variableNames: ['amount']});
    const row = (res.data as {pcp?: Array<{mean?: number}>}).pcp?.[0];
    expect(row?.mean).toBe(15);
  });

  it('geoda.analysis classify returns real breaks (@geoda/core WASM)', async () => {
    const analysis = makeEngine();
    const quantile = await analysis.invoke('geoda.analysis', {
      analysis: 'classify', datasetName: 'sales', variableName: 'amount', method: 'quantile', k: 3
    });
    // Mock data is [10, 10, 20, 20] — only 2 distinct values, so @geoda returns
    // fewer breaks than k. Non-empty is the meaningful assertion.
    expect((quantile.data as {breaks?: unknown[]}).breaks?.length).toBeGreaterThan(0);

    const natural = await analysis.invoke('geoda.analysis', {
      analysis: 'classify', datasetName: 'sales', variableName: 'amount', method: 'natural breaks', k: 2
    });
    expect((natural.data as {breaks?: unknown[]}).breaks?.length).toBeGreaterThan(0);
  });

  it('geoda.analysis regression returns R² and observations', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'regression', datasetName: 'sales', dependentVariable: 'amount',
      independentVariables: ['amount'], modelType: 'classic'
    });
    const data = res.data as {rSquared?: number; observations?: number; coefficients?: unknown};
    expect(typeof data.rSquared).toBe('number');
    expect(data.observations).toBe(4);
    expect(data.coefficients).toBeDefined();
  });

  it('geoda.analysis regression spatial-lag with weights', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'regression', datasetName: 'sales', dependentVariable: 'amount',
      independentVariables: ['amount'], modelType: 'spatial-lag', weights: NEIGHBORS
    });
    const data = res.data as {rSquared?: number; modelType?: string};
    expect(typeof data.rSquared).toBe('number');
    expect(data.modelType).toBe('spatial-lag');
  });

  it('geoda.analysis lisa via @geoda/lisa localMoran', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'lisa', datasetName: 'sales', variableName: 'amount',
      method: 'localMoran', weights: NEIGHBORS, permutation: 99, significanceThreshold: 0.05
    });
    const data = res.data as {clusters?: unknown[]; totalObservations?: number};
    expect(Array.isArray(data.clusters)).toBe(true);
    expect(data.totalObservations).toBe(4);
  });

  it('geoda.analysis lisa writes the cluster column back to the map dataset', async () => {
    // Regression: the LISA op computed clusters but never persisted them, so the
    // kepler skill could not find a cluster column to color a local Moran map
    // by. With a bridge present it must append the cluster column in place.
    const connector = createMockConnector();
    const added: Array<{datasetName: string; columnName: string; values: unknown[]}> = [];
    const bridge = {
      addColumnToDataset: async (datasetName: string, columnName: string, values: unknown[]) => {
        added.push({datasetName, columnName, values});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'lisa', datasetName: 'sales', variableName: 'amount',
      method: 'localMoran', weights: NEIGHBORS, permutation: 99, significanceThreshold: 0.05
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].datasetName).toBe('sales');
    expect(added[0].columnName).toBe('lisa_cluster');
    // One cluster value per observation, aligned with the dataset rows.
    expect(added[0].values).toHaveLength(4);
    const data = res.data as {clusterColumnName?: string; clusters?: unknown[]};
    expect(data.clusterColumnName).toBe('lisa_cluster');
    expect(Array.isArray(data.clusters)).toBe(true);
  });

  it('geoda.analysis lisa honors a custom clusterColumnName', async () => {
    const connector = createMockConnector();
    const added: Array<{columnName: string}> = [];
    const bridge = {
      addColumnToDataset: async (_datasetName: string, columnName: string) => {
        added.push({columnName});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'lisa', datasetName: 'sales', variableName: 'amount',
      method: 'localMoran', weights: NEIGHBORS, permutation: 99,
      clusterColumnName: 'lisa_cluster_donatns'
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].columnName).toBe('lisa_cluster_donatns');
  });

  it('geoda.analysis colocation writes the cluster column back to the map dataset', async () => {
    // Regression: like LISA, colocation computed clusters but never persisted
    // them, so the kepler skill could not find a cluster column to color a
    // colocation map by. With a bridge present it must append the cluster
    // column in place.
    const connector = createMockConnector();
    const added: Array<{datasetName: string; columnName: string; values: unknown[]}> = [];
    const bridge = {
      addColumnToDataset: async (datasetName: string, columnName: string, values: unknown[]) => {
        added.push({datasetName, columnName, values});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'colocation', datasetName: 'bins', variableName: 'binFlag',
      weights: NEIGHBORS, permutation: 99
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].datasetName).toBe('bins');
    expect(added[0].columnName).toBe('lisa_cluster');
    // One cluster value per observation, aligned with the dataset rows.
    expect(added[0].values).toHaveLength(4);
    const data = res.data as {clusterColumnName?: string; type?: string};
    expect(data.clusterColumnName).toBe('lisa_cluster');
    expect(data.type).toBe('univariate-local-joincount');
  });

  it('geoda.analysis colocation honors a custom clusterColumnName', async () => {
    const connector = createMockConnector();
    const added: Array<{columnName: string}> = [];
    const bridge = {
      addColumnToDataset: async (_datasetName: string, columnName: string) => {
        added.push({columnName});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'colocation', datasetName: 'bins', variableName: 'binFlag',
      weights: NEIGHBORS, permutation: 99, clusterColumnName: 'coloc_cluster'
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].columnName).toBe('coloc_cluster');
  });

  it('geoda.analysis global-moran', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'global-moran', datasetName: 'sales', variableName: 'amount', weights: NEIGHBORS
    });
    const data = res.data as {globalMoranI?: number; totalObservations?: number};
    expect(typeof data.globalMoranI).toBe('number');
    expect(data.totalObservations).toBe(4);
  });

  it('geoda.analysis colocation (univariate local join count)', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'colocation', datasetName: 'bins', variableName: 'binFlag',
      weights: NEIGHBORS, permutation: 99
    });
    const data = res.data as {type?: string; variables?: string[]; clusterColorAndLabels?: unknown[]; totalObservations?: number};
    expect(res.success).toBe(true);
    expect(data.type).toBe('univariate-local-joincount');
    expect(data.variables).toEqual(['binFlag']);
    expect(Array.isArray(data.clusterColorAndLabels)).toBe(true);
    expect(data.totalObservations).toBe(4);
  });

  it('geoda.analysis colocation bivariate (no-colocation) local join count', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'colocation', datasetName: 'bins', variableName: 'binFlag',
      variableB: 'binFlagB', weights: NEIGHBORS, permutation: 99
    });
    const data = res.data as {type?: string; variables?: string[]};
    expect(res.success).toBe(true);
    expect(data.type).toBe('bivariate-local-joincount');
    expect(data.variables).toEqual(['binFlag', 'binFlagB']);
  });

  it('geoda.analysis colocation rejects non-binary input', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'colocation', datasetName: 'sales', variableName: 'amount',
      weights: NEIGHBORS, permutation: 99
    });
    expect(res.success).toBe(false);
    expect((res.error ?? '').toLowerCase()).toContain('binary');
  });

  it('geoda.analysis spatial-weights (queen)', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'spatial-weights', datasetName: 'sales', type: 'queen',
      geometries: [square(0, 0), square(1, 0), square(0, 1), square(1, 1)]
    });
    const data = res.data as {weightsId?: string; weights?: number[][]};
    expect(data.weightsId).toBeDefined();
    expect(Array.isArray(data.weights)).toBe(true);
    expect(data.weights?.[0]).toHaveLength(3);
  });

  it('geoda.analysis spatial-weights writes the neighbor list column back to the map dataset', async () => {
    // Regression: spatial weights were only cached in memory (session-scoped), so
    // the neighbor list never showed up in the map dataset. With a bridge present
    // it must append a `<type>w` column holding, per row, the neighbor indices of
    // that row (e.g. row 0 → [1, 2, 3]).
    const connector = createMockConnector();
    const added: Array<{datasetName: string; columnName: string; values: unknown[]}> = [];
    const bridge = {
      getGeometries: async () => [square(0, 0), square(1, 0), square(0, 1), square(1, 1)],
      addColumnToDataset: async (datasetName: string, columnName: string, values: unknown[]) => {
        added.push({datasetName, columnName, values});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'spatial-weights', datasetName: 'sales', type: 'queen'
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].datasetName).toBe('sales');
    expect(added[0].columnName).toBe('queenw');
    // One neighbor list per observation, aligned with the dataset rows.
    expect(added[0].values).toHaveLength(4);
    expect(added[0].values[0]).toEqual([1, 2, 3]);
    const data = res.data as {weightsId?: string; weightsColumnName?: string};
    expect(data.weightsColumnName).toBe('queenw');
  });

  it('geoda.analysis spatial-weights honors a custom weightsColumnName', async () => {
    const connector = createMockConnector();
    const added: Array<{columnName: string}> = [];
    const bridge = {
      getGeometries: async () => [square(0, 0), square(1, 0), square(0, 1), square(1, 1)],
      addColumnToDataset: async (_datasetName: string, columnName: string) => {
        added.push({columnName});
      }
    };
    const analysis = new AnalysisEngine(connector, bridge as any);
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'spatial-weights', datasetName: 'sales', type: 'queen',
      weightsColumnName: 'w_neighbors'
    });
    expect(res.success).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].columnName).toBe('w_neighbors');
  });

  it('geoda.analysis standardize', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'standardize', datasetName: 'sales', variableName: 'amount', method: 'standardize'
    });
    const result = (res.data as {result?: number[]}).result;
    expect(result).toHaveLength(4);
    expect(Math.abs((result ?? []).reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
  });

  it('geoda.analysis rate (rawRates)', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'rate', datasetName: 'sales', eventVariable: 'amount',
      baseVariable: 'amount', method: 'rawRates'
    });
    expect((res.data as {result?: unknown[]}).result).toHaveLength(4);
  });

  it('geoda.analysis thiessen-polygons / mst / cartogram', async () => {
    const analysis = makeEngine();
    const geoms = [point(0, 0), point(2, 0), point(0, 2), point(2, 2)];

    const thiessen = await analysis.invoke('geoda.analysis', {
      analysis: 'thiessen-polygons', datasetName: 'sales', geometries: geoms
    });
    expect((thiessen.data as {featureCount?: number; geojson?: {features?: unknown[]}}).featureCount).toBeGreaterThanOrEqual(4);

    const mst = await analysis.invoke('geoda.analysis', {
      analysis: 'mst', datasetName: 'sales', geometries: geoms
    });
    const mstData = mst.data as {edgeCount?: number; geojson?: {features?: unknown[]}};
    expect(mstData.edgeCount).toBeGreaterThanOrEqual(3);
    expect(mstData.geojson?.features).toBeDefined();

    const carto = await analysis.invoke('geoda.analysis', {
      analysis: 'cartogram', datasetName: 'sales', weightVariable: 'amount', iterations: 10, geometries: geoms
    });
    expect((carto.data as {featureCount?: number}).featureCount).toBe(4);
  });

  it('geoda.analysis cartogram reports WGS84 x/y/radius from the circle ring (not UTM garbage)', async () => {
    // @geoda/core's UTM cartogram path back-projects properties.x/y/radius
    // wrongly (it re-reads the degree values as UTM meters), so every feature
    // comes back with a nonsense center (e.g. NYC → y≈8). The engine must
    // derive the point center + radius from the (correct) circle ring.
    const analysis = makeEngine();
    // Small extent → triggers the UTM cartogram path inside @geoda/core.
    const geoms = [square(0, 0), square(1, 0), square(0, 1), square(1, 1)];
    const res = await analysis.invoke('geoda.analysis', {
      analysis: 'cartogram', datasetName: 'sales', weightVariable: 'amount', iterations: 10, geometries: geoms
    });
    expect(res.success).toBe(true);
    const feats = (res.data as {geojson?: {features?: Array<Record<string, any>>}}).geojson?.features;
    expect(feats?.length).toBe(4);
    for (const f of feats ?? []) {
      const {x, y, radius} = f.properties as {x?: number; y?: number; radius?: number};
      // The reported point must be the centroid of the returned circle ring —
      // upstream garbage placed it ~80° away (e.g. NYC y≈8 instead of ≈40.6).
      const ring = f.geometry.coordinates[0] as number[][];
      let cl = 0;
      let ct = 0;
      for (const p of ring) {
        cl += p[0];
        ct += p[1];
      }
      cl /= ring.length;
      ct /= ring.length;
      expect(x).toBeCloseTo(cl, 3);
      expect(y).toBeCloseTo(ct, 3);
      // radius must match the ring (mean vertex distance), not the tiny value
      // the buggy back-projection produced.
      const dists = ring.map((p) => Math.hypot(p[0] - (x ?? 0), p[1] - (y ?? 0)));
      const meanDist = dists.reduce((a, b) => a + b, 0) / dists.length;
      expect(radius).toBeCloseTo(meanDist, 3);
      expect(radius ?? 0).toBeGreaterThan(0);
      // sanity: the ring is a circle around the point (vertex distances ~equal)
      expect(Math.max(...dists) / Math.min(...dists)).toBeLessThan(1.2);
    }
  });

  it('geo.grid builds a rectangle grid', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geo.grid', {bbox: [[0, 0], [4, 4]], rows: 2, columns: 2});
    const data = res.data as {featureCount?: number; geojson?: {features?: unknown[]}};
    expect(data.featureCount).toBe(4);
    expect(data.geojson?.features).toBeDefined();
  });

  it('geo.routing without a Mapbox token returns a clear not-wired error', async () => {
    const analysis = makeEngine();
    const res = await analysis.invoke('geo.routing', {
      origin: {longitude: 0, latitude: 0}, destination: {longitude: 1, latitude: 1}
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Mapbox/);
  });
});
