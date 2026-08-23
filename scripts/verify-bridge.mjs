#!/usr/bin/env node
/**
 * Verify the KeplerBridge path: the AnalysisEngine calls the host bridge for
 * kepler-bound steps (materialize, geometries, saveResult, loadToMap) while
 * staying kepler-agnostic. Uses a mock bridge + the mock connector, and checks
 * that with NO bridge the engine still behaves as before.
 *
 * Usage: node scripts/verify-bridge.mjs   (exit 0 = pass)
 */

import {AnalysisEngine} from '../dist/analysis-commands.js';
import {createMockConnector} from '../dist/mock-connector.js';

const connector = createMockConnector();
const calls = {materialize: [], geometries: [], saveResult: [], loadToMap: [], addColumn: []};
const bridge = {
  async materializeDataset(name) {
    calls.materialize.push(name);
  },
  async getGeometries(name) {
    calls.geometries.push(name);
    return [
      {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [0, 0]}},
      {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [2, 0]}}
    ];
  },
  async saveResult(name, result) {
    calls.saveResult.push({name, result});
  },
  async loadToMap(table) {
    calls.loadToMap.push(table);
    return {success: true, data: {table, datasetId: `d_${table}`}};
  },
  async addColumnToDataset(name, col, values) {
    calls.addColumn.push({name, col, values});
  }
};

const engine = new AnalysisEngine(connector, bridge);
let passed = true;
const check = (label, cond) => {
  if (!cond) {
    passed = false;
    console.log('FAIL:', label);
  }
};

try {
  // 1. data.load-to-map delegates to the bridge and surfaces its result.
  const ltm = await engine.invoke('data.load-to-map', {table: 'sales'});
  check('load-to-map returns bridge data', ltm.success && ltm.data?.datasetId === 'd_sales');
  check('load-to-map called bridge', calls.loadToMap.includes('sales'));

  // 2. data.filter creates the table then pushes it to the map via the bridge.
  const flt = await engine.invoke('data.filter', {
    source: 'sales',
    resultName: 'big_sales',
    condition: {column: 'amount', op: 'gt', value: 10}
  });
  check('filter success', flt.success);
  check('filter called bridge.loadToMap', calls.loadToMap.includes('big_sales'));

  // 3. chart.histogram returns real barDataIndexes + kepler source with a bridge.
  const hist = await engine.invoke('chart.histogram', {table: 'sales', column: 'amount', bins: 2});
  const ui = hist.data?.__ui;
  check('histogram success', hist.success);
  check('histogram __ui present', !!ui);
  check(
    'histogram barDataIndexes non-empty',
    Array.isArray(ui?.barDataIndexes) && ui.barDataIndexes.some(a => a.length > 0)
  );
  check('histogram source kepler', ui?.source === 'kepler');
  check(
    'histogram bins sum to totalValues',
    ui?.histogramData?.reduce((s, b) => s + b.count, 0) === hist.data?.totalValues
  );

  // 4. geoda.analysis rate saves a columnData result through the bridge.
  const rate = await engine.invoke('geoda.analysis', {
    analysis: 'rate',
    datasetName: 'sales',
    eventVariable: 'amount',
    baseVariable: 'amount',
    method: 'excessRisk',
    outputDatasetName: 'rate_out'
  });
  check('rate success', rate.success);
  const saved = calls.saveResult.find(c => c.name === 'rate_out');
  check('rate saveResult called', !!saved);
  check('rate saveResult type columnData', saved?.result?.type === 'columnData');
  check(
    'rate saveResult has column array',
    saved?.result?.content && Array.isArray(Object.values(saved.result.content)[0])
  );

  // 5. geoda.analysis standardize saves through the bridge.
  const std = await engine.invoke('geoda.analysis', {
    analysis: 'standardize',
    datasetName: 'sales',
    variableName: 'amount',
    method: 'standardize',
    outputDatasetName: 'std_out'
  });
  check('standardize success', std.success);
  check('standardize saveResult called', calls.saveResult.some(c => c.name === 'std_out'));

  // 6. geoda thiessen resolves geometries via the bridge when not passed.
  const thiessen = await engine.invoke('geoda.analysis', {
    analysis: 'thiessen-polygons',
    datasetName: 'sales',
    outputDatasetName: 'thiessen_out'
  });
  check('thiessen success via bridge geometries', thiessen.success);
  check('thiessen used bridge geometries', calls.geometries.includes('sales'));
  check(
    'thiessen saveResult geojson',
    calls.saveResult.some(c => c.name === 'thiessen_out' && c.result?.type === 'geojson')
  );

  // 7. addColumnToDataset is NOT called unless the caller requests it.
  check('no addColumn unless requested', calls.addColumn.length === 0);
  const rate2 = await engine.invoke('geoda.analysis', {
    analysis: 'rate',
    datasetName: 'sales',
    eventVariable: 'amount',
    baseVariable: 'amount',
    method: 'excessRisk',
    outputDatasetName: 'r2',
    addColumnToKepler: true
  });
  check('rate with addColumnToKepler success', rate2.success);
  check('addColumn called when requested', calls.addColumn.length === 1 && calls.addColumn[0].name === 'sales');

  // 8. geo.spatial-query materializes datasets, resolves __tblN__ placeholders,
  //    runs SQL, and saves the result through the bridge.
  const sq = await engine.invoke('geo.spatial-query', {
    datasetNames: ['sales'],
    outputDatasetName: 'spatial_out',
    sqlQuery: 'SELECT * FROM __tbl0__',
    reasoning: 'copy sales'
  });
  check('spatial-query success', sq.success);
  check('spatial-query materialized datasets', calls.materialize.includes('sales'));
  check(
    'spatial-query saveResult geojson',
    calls.saveResult.some(c => c.name === 'spatial_out' && c.result?.type === 'geojson')
  );
  check(
    'spatial-query tableSchemas present',
    Array.isArray(sq.data?.tableSchemas) && sq.data.tableSchemas.length === 1
  );
  check('spatial-query details mentions feature count', /features -> spatial_out/.test(sq.data?.details ?? ''));

  // 9. Without a bridge, load-to-map still returns the preview (back-compat).
  const bare = new AnalysisEngine(createMockConnector());
  const bareLtm = await bare.invoke('data.load-to-map', {table: 'sales'});
  check('no-bridge load-to-map returns preview', bareLtm.success && !!bareLtm.data?.previewRows);

  // 10. data.query with full:true returns ALL rows (host persistence path).
  const qFull = await engine.invoke('data.query', {sql: 'SELECT * FROM sales', full: true});
  check('data.query full returns all rows', qFull.success && Array.isArray(qFull.data?.rows) && qFull.data.rows.length >= 1);

  console.log(passed ? 'BRIDGE VERIFY PASS' : 'BRIDGE VERIFY FAIL');
} catch (error) {
  passed = false;
  console.error('verify error:', error.message);
}
process.exit(passed ? 0 : 1);
