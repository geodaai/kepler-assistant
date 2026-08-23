#!/usr/bin/env node
/**
 * Verify the analysis engine directly, backed by the mock DuckDbConnector
 * (the real duckdb-wasm connector runs in the demo-app/browser, not this Node
 * build). Exercises the SQL→Arrow→JSON wiring: the engine issues SQL to the
 * connector, converts the returned Arrow table to JSON, and computes chart /
 * geoda / geo results.
 *
 * The MCP server composition (`buildAssistantMcpServer`) is deferred with
 * kepler-mcp, so this harness drives `AnalysisEngine.invoke` directly instead
 * of over MCP.
 *
 * Usage: node scripts/verify-engine.mjs   (exit 0 = pass)
 */

import {AnalysisEngine} from '../dist/analysis-commands.js';
import {createMockConnector} from '../dist/mock-connector.js';

const connector = createMockConnector();
const analysis = new AnalysisEngine(connector);

let passed = true;
const call = async (name, args) => {
  const res = await analysis.invoke(name, args);
  if (!res.success) {
    console.log(`  (${name} returned error: ${res.error})`);
  }
  return res;
};

try {
  // 1. create-table issues SQL to the connector.
  const created = await call('data.create-table', {
    name: 'sales',
    rows: [
      {region: 'east', amount: 10},
      {region: 'east', amount: 20},
      {region: 'west', amount: 5}
    ]
  });
  console.log('create-table:', JSON.stringify(created.data));
  if (created.data?.tableName !== 'sales') {
    passed = false;
    console.log('FAIL: create-table');
  }

  // 2. query issues SQL to the connector and returns rows.
  const q = await call('data.query', {sql: 'SELECT region, amount FROM sales'});
  console.log('query columns:', q.data?.columns, '| totalRows:', q.data?.totalRows);
  if (!q.data?.columns || !q.data?.totalRows) {
    passed = false;
    console.log('FAIL: query returned no columns/rows');
  }

  // 3. chart.histogram computes real bins from the connector's returned values.
  const hist = await call('chart.histogram', {table: 'sales', column: 'amount', bins: 2});
  console.log('histogram total:', hist.data?.totalValues);
  if (hist.data?.totalValues !== 4) {
    passed = false;
    console.log('FAIL: histogram wrong');
  }

  // 4. chart.boxplot computes stats from the connector values.
  const bp = await call('chart.boxplot', {table: 'sales', variableNames: ['amount']});
  console.log('boxplot:', JSON.stringify(bp.data?.boxplots?.[0]));
  if (bp.data?.boxplots?.[0]?.median !== 15 || bp.data?.boxplots?.[0]?.iqr !== 10) {
    passed = false;
    console.log('FAIL: boxplot median/IQR wrong');
  }

  // 5. chart.pcp computes per-column stats.
  const pcp = await call('chart.pcp', {table: 'sales', variableNames: ['amount']});
  if (pcp.data?.pcp?.[0]?.mean !== 15) {
    passed = false;
    console.log('FAIL: pcp mean wrong');
  }

  // 6. geoda.analysis classify computes real breaks via @geoda/core (real WASM).
  const classify = await call('geoda.analysis', {
    analysis: 'classify',
    datasetName: 'sales',
    variableName: 'amount',
    method: 'quantile',
    k: 3
  });
  console.log('quantile classify breaks:', JSON.stringify(classify.data?.breaks));
  if (!Array.isArray(classify.data?.breaks) || classify.data.breaks.length === 0) {
    passed = false;
    console.log('FAIL: quantile classify returned no breaks');
  }
  const classifyNatural = await call('geoda.analysis', {
    analysis: 'classify',
    datasetName: 'sales',
    variableName: 'amount',
    method: 'natural breaks',
    k: 2
  });
  console.log('natural-breaks classify:', JSON.stringify(classifyNatural.data?.breaks));
  if (!Array.isArray(classifyNatural.data?.breaks) || classifyNatural.data.breaks.length === 0) {
    passed = false;
    console.log('FAIL: natural-breaks classify returned no breaks');
  }

  // 7. geoda.analysis regression via @geoda/regression (real WASM).
  const reg = await call('geoda.analysis', {
    analysis: 'regression',
    datasetName: 'sales',
    dependentVariable: 'amount',
    independentVariables: ['amount'],
    modelType: 'classic'
  });
  console.log('regression R²:', reg.data?.rSquared, '| obs:', reg.data?.observations);
  if (typeof reg.data?.rSquared !== 'number' || !reg.data?.coefficients || reg.data?.observations !== 4) {
    passed = false;
    console.log('FAIL: regression returned no R²/coefficients');
  }

  // 7b. geoda.analysis regression spatial-lag (needs weights) via @geoda/regression.
  const regLag = await call('geoda.analysis', {
    analysis: 'regression', datasetName: 'sales', dependentVariable: 'amount',
    independentVariables: ['amount'], modelType: 'spatial-lag',
    weights: [[1, 2], [0, 3], [0, 3], [1, 2]]
  });
  console.log('spatial-lag R²:', regLag.data?.rSquared);
  if (typeof regLag.data?.rSquared !== 'number' || regLag.data?.modelType !== 'spatial-lag') {
    passed = false;
    console.log('FAIL: spatial-lag regression returned no R²');
  }

  // 8. geoda.analysis lisa via @geoda/lisa localMoran (real WASM).
  const neighbors = [[1, 2], [0, 3], [0, 3], [1, 2]];
  const lisa = await call('geoda.analysis', {
    analysis: 'lisa',
    datasetName: 'sales',
    variableName: 'amount',
    method: 'localMoran',
    weights: neighbors,
    permutation: 99,
    significanceThreshold: 0.05
  });
  console.log('lisa clusters:', JSON.stringify(lisa.data?.clusters), '| obs:', lisa.data?.totalObservations);
  if (!Array.isArray(lisa.data?.clusters) || lisa.data?.totalObservations !== 4) {
    passed = false;
    console.log('FAIL: lisa returned no clusters');
  }

  // 9. geoda.analysis global-moran via @geoda/lisa spatialLag + slope.
  const gm = await call('geoda.analysis', {
    analysis: 'global-moran',
    datasetName: 'sales',
    variableName: 'amount',
    weights: neighbors
  });
  console.log('global-moran I:', gm.data?.globalMoranI, '| obs:', gm.data?.totalObservations);
  if (typeof gm.data?.globalMoranI !== 'number' || gm.data?.totalObservations !== 4) {
    passed = false;
    console.log('FAIL: global-moran returned no I');
  }

  // 10. geoda.analysis spatial-weights via @geoda/core createWeights (real WASM).
  const sq = (x, y) => ({
    type: 'Feature',
    properties: {id: `${x}-${y}`},
    geometry: {
      type: 'Polygon',
      coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]
    }
  });
  const sw = await call('geoda.analysis', {
    analysis: 'spatial-weights',
    datasetName: 'sales',
    type: 'queen',
    geometries: [sq(0, 0), sq(1, 0), sq(0, 1), sq(1, 1)]
  });
  console.log('spatial-weights:', sw.data?.weightsId, '| neighbors[0]:', JSON.stringify(sw.data?.weights?.[0]));
  if (!sw.data?.weightsId || !Array.isArray(sw.data?.weights) || sw.data?.weights?.[0]?.length !== 3) {
    passed = false;
    console.log('FAIL: spatial-weights returned no weights');
  }

  // 11. geoda.analysis standardize via @geoda/core.
  const st = await call('geoda.analysis', {
    analysis: 'standardize',
    datasetName: 'sales',
    variableName: 'amount',
    method: 'standardize'
  });
  console.log('standardize result[0]:', st.data?.result?.[0], '| mean≈0:', Math.abs(st.data?.result?.reduce((a, b) => a + b, 0)) < 1e-9);
  if (!Array.isArray(st.data?.result) || st.data?.result?.length !== 4) {
    passed = false;
    console.log('FAIL: standardize returned no result');
  }

  // 12. geoda.analysis rate via @geoda/core (rawRates).
  const rate = await call('geoda.analysis', {
    analysis: 'rate',
    datasetName: 'sales',
    eventVariable: 'amount',
    baseVariable: 'amount',
    method: 'rawRates'
  });
  console.log('rate result[0]:', rate.data?.result?.[0]);
  if (!Array.isArray(rate.data?.result) || rate.data?.result?.length !== 4) {
    passed = false;
    console.log('FAIL: rate returned no result');
  }

  // 13-15. geoda.analysis thiessen / mst / cartogram via @geoda/core.
  const pts = (x, y) => ({
    type: 'Feature',
    properties: {},
    geometry: {type: 'Point', coordinates: [x, y]}
  });
  const pointGeoms = [pts(0, 0), pts(2, 0), pts(0, 2), pts(2, 2)];

  const thiessen = await call('geoda.analysis', {
    analysis: 'thiessen-polygons', datasetName: 'sales', geometries: pointGeoms
  });
  console.log('thiessen features:', thiessen.data?.featureCount);
  if (thiessen.data?.featureCount < 4 || !thiessen.data?.geojson?.features) {
    passed = false;
    console.log('FAIL: thiessen returned no features');
  }

  const mst = await call('geoda.analysis', {
    analysis: 'mst', datasetName: 'sales', geometries: pointGeoms
  });
  console.log('mst edges:', mst.data?.edgeCount);
  if (mst.data?.edgeCount < 3 || !mst.data?.geojson?.features) {
    passed = false;
    console.log('FAIL: mst returned no edges');
  }

  const carto = await call('geoda.analysis', {
    analysis: 'cartogram', datasetName: 'sales', weightVariable: 'amount',
    iterations: 10, geometries: pointGeoms
  });
  console.log('cartogram features:', carto.data?.featureCount);
  if (carto.data?.featureCount !== 4 || !carto.data?.geojson?.features) {
    passed = false;
    console.log('FAIL: cartogram returned no features');
  }

  // 16. geo.grid via @turf/rectangle-grid.
  const grid = await call('geo.grid', {bbox: [[0, 0], [4, 4]], rows: 2, columns: 2});
  console.log('geo.grid cells:', grid.data?.featureCount);
  if (grid.data?.featureCount !== 4 || !grid.data?.geojson?.features) {
    passed = false;
    console.log('FAIL: geo.grid returned no cells');
  }

  // 17. geo.routing (external) returns a clear not-wired error.
  const routing = await call('geo.routing', {origin: {longitude: 0, latitude: 0}, destination: {longitude: 1, latitude: 1}});
  if (routing.success !== false || !/Mapbox/.test(routing.error || '')) {
    passed = false;
    console.log('FAIL: geo.routing should return a not-wired error');
  }

  // 18. geo.us-boundary fetches a real US state boundary (needs network).
  const ub = await call('geo.us-boundary', {type: 'state', ids: ['california']});
  console.log('us-boundary features:', ub.success ? ub.data?.featureCount : `ERR: ${ub.error}`);
  if (ub.success !== true || ub.data?.featureCount < 1 || !ub.data?.geojson?.features) {
    passed = false;
    console.log('FAIL: geo.us-boundary returned no features');
  }

  // The engine issued real SQL to the connector.
  console.log('SQL issued to connector:', connector.getRecordedSql().length, 'statement(s)');

  console.log(passed ? 'VERIFY PASS' : 'VERIFY FAIL');
} catch (error) {
  passed = false;
  console.error('verify error:', error.message);
} finally {
  process.exit(passed ? 0 : 1);
}
