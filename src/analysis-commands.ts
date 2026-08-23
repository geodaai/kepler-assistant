/**
 * Analysis engine — server-side compute for `data.*` + `chart.histogram`,
 * built on the `DuckDbEngine` (real SQL via a `@sqlrooms/duckdb-core`
 * `DuckDbConnector`). `map.*` stays on the browser path (hub); this runs the
 * analysis tools.
 *
 * The connector is supplied by the host: the demo-app/browser uses
 * `createWasmDuckDbConnector` (duckdb-wasm) — which is why this same component
 * can be built for the demo-app; kepler-mcp can use native/MotherDuck/other.
 */

import {DuckDbEngine} from './duckdb-engine';
import type {QueryableConnector} from './duckdb-engine';
import {
  quantileBreaks as geodaQuantileBreaks,
  naturalBreaks as geodaNaturalBreaks,
  equalIntervalBreaks as geodaEqualIntervalBreaks,
  percentileBreaks as geodaPercentileBreaks,
  standardDeviationBreaks as geodaStdDevBreaks,
  hinge15Breaks as geodaHinge15Breaks,
  createWeights as geodaCreateWeights,
  standardize as geodaStandardize,
  standardizeMAD as geodaStandardizeMAD,
  deviationFromMean as geodaDeviationFromMean,
  rangeAdjust as geodaRangeAdjust,
  rangeStandardize as geodaRangeStandardize,
  rawRates as geodaRawRates,
  excessRisk as geodaExcessRisk,
  empiricalBayes as geodaEmpiricalBayes,
  getThiessenPolygons as geodaThiessen,
  getMinimumSpanningTree as geodaMst,
  getCartogram as geodaCartogram
} from '@geoda/core';
import {rectangleGrid} from '@turf/rectangle-grid';
import {
  linearRegression as geodaLinearRegression,
  spatialLagRegression as geodaSpatialLagRegression,
  spatialError as geodaSpatialErrorRegression
} from '@geoda/regression';
import {localMoran as geodaLocalMoran, localGeary as geodaLocalGeary, spatialLag as geodaSpatialLag} from '@geoda/lisa';
import type {ToolResult} from './types';
import type {KeplerBridge} from './kepler-bridge';
import {
  mapboxRouting,
  mapboxIsochrone,
  nominatimGeocode,
  overpassRoads,
  usBoundaries,
  featuresBbox
} from './geo-providers';
import type {GeoBounds} from './geo-providers';

export type {ToolResult} from './types';
export type {KeplerBridge} from './kepler-bridge';

export const ANALYSIS_TOOL_IDS = [
  'data.create-table',
  'data.query',
  'data.filter',
  'data.merge-tables',
  'data.load-to-map',
  'chart.histogram',
  'chart.boxplot',
  'chart.scatterplot',
  'chart.bubble',
  'chart.pcp',
  'geoda.analysis',
  'geo.grid',
  'geo.routing',
  'geo.isochrone',
  'geo.geocode',
  'geo.roads',
  'geo.us-boundary',
  'geo.spatial-query'
];

export function isAnalysisTool(tool: string): boolean {
  return (
    tool.startsWith('data.') ||
    tool.startsWith('geo.') ||
    tool.startsWith('geoda.') ||
    tool.startsWith('chart.')
  );
}

export class AnalysisEngine {
  private readonly db: DuckDbEngine;
  private readonly bridge: KeplerBridge | undefined;

  constructor(connector: QueryableConnector, bridge?: KeplerBridge) {
    this.db = new DuckDbEngine(connector);
    this.bridge = bridge;
  }

  /**
   * Ensure a kepler dataset is materialized into the connector before the
   * engine reads it (geoda/chart read `FROM <datasetName>`). No-op when no
   * bridge is provided — the MCP/service path reads pre-existing tables.
   */
  private async ensureMaterialized(datasetName?: string): Promise<void> {
    if (datasetName) await this.bridge?.materializeDataset?.(datasetName);
  }

  /**
   * Resolve GeoJSON geometries for a geoda spatial op: the caller's explicit
   * `geometries` arg wins, then the bridge's dataset geometries.
   */
  private async resolveGeometries(args: Record<string, any>): Promise<unknown[] | undefined> {
    if (Array.isArray(args.geometries) && args.geometries.length) return args.geometries;
    if (args.datasetName && this.bridge?.getGeometries) {
      const geoms = await this.bridge.getGeometries(args.datasetName);
      if (Array.isArray(geoms) && geoms.length) return geoms as unknown[];
    }
    return undefined;
  }

  async invoke(tool: string, input: unknown): Promise<ToolResult> {
    const args = (input ?? {}) as Record<string, any>;
    try {
      switch (tool) {
        case 'data.create-table':
          return await this.createTable(args);
        case 'data.query':
          return await this.query(args);
        case 'data.filter':
          return await this.filter(args);
        case 'data.merge-tables':
          return await this.merge(args);
        case 'data.load-to-map':
          return await this.loadToMap(args);
        case 'chart.histogram':
          return await this.histogram(args);
        case 'chart.boxplot':
          return await this.boxplot(args);
        case 'chart.scatterplot':
          return await this.scatterplot(args);
        case 'chart.bubble':
          return await this.bubble(args);
        case 'chart.pcp':
          return await this.pcp(args);
        case 'geoda.analysis':
          return await this.geodaAnalysis(args);
        case 'geo.grid':
          return this.geoGrid(args);
        case 'geo.routing':
          return this.geoRouting(args);
        case 'geo.isochrone':
          return this.geoIsochrone(args);
        case 'geo.geocode':
          return this.geoGeocode(args);
        case 'geo.roads':
          return this.geoRoads(args);
        case 'geo.us-boundary':
          return this.geoUsBoundary(args);
        case 'geo.spatial-query':
          return this.geoSpatialQuery(args);
        default:
          return {success: false, error: `No analysis handler for "${tool}"`};
      }
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async createTable(args: Record<string, any>): Promise<ToolResult> {
    const {name, rows, sql} = args;
    if (!name) return {success: false, error: 'data.create-table requires name'};
    if (sql) {
      await this.db.exec(`CREATE OR REPLACE TABLE ${q(name)} AS ${sql}`);
    } else if (Array.isArray(rows)) {
      await this.db.createTableFromRows(name, rows);
    } else {
      return {success: false, error: 'data.create-table requires sql or rows'};
    }
    return {success: true, data: {tableName: name, details: `Created table "${name}"`}};
  }

  private async query(args: Record<string, any>): Promise<ToolResult> {
    const {sql} = args;
    if (!sql) return {success: false, error: 'data.query requires sql'};
    // `full: true` returns ALL rows (uncapped) so a host that delegates its
    // query surface to the engine can persist the complete result. Defaults to
    // the model-facing preview (capped), so the MCP/service path is unchanged.
    const full = args.full === true;
    const result = full
      ? await this.db.queryAll(sql)
      : await this.db.query(sql, args.limit ?? 50);
    return {
      success: true,
      data: {
        columns: result.columns,
        ...(full ? {rows: result.rows} : {}),
        truncatedQueryResult: JSON.stringify(result.rows.slice(0, 5)),
        totalRows: result.totalRows,
        firstFiveRows: result.rows.slice(0, 5)
      }
    };
  }

  private async filter(args: Record<string, any>): Promise<ToolResult> {
    const {source, resultName, condition} = args;
    if (!source || !resultName || !condition?.column) {
      return {success: false, error: 'data.filter requires {source, resultName, condition}'};
    }
    const where = buildCondition(condition);
    await this.db.exec(`CREATE TABLE ${q(resultName)} AS SELECT * FROM ${q(source)} WHERE ${where}`);
    // The host demo-app pushes the filtered result onto the map (addDataToMap);
    // mirror that through the bridge when one is present.
    if (this.bridge?.loadToMap) {
      const loaded = await this.bridge.loadToMap(resultName);
      if (!loaded.success) return loaded;
    }
    return {success: true, data: {resultName, details: `Filtered ${source} into ${resultName}`}};
  }

  private async merge(args: Record<string, any>): Promise<ToolResult> {
    const {left, right, on, how, resultName} = args;
    if (!left || !right || !on || !resultName) {
      return {success: false, error: 'data.merge-tables requires {left, right, on, resultName}'};
    }
    const kind = how === 'left' ? 'LEFT JOIN' : 'INNER JOIN';
    await this.db.exec(
      `CREATE TABLE ${q(resultName)} AS SELECT * FROM ${q(left)} ${kind} ${q(right)} ON ${q(left)}.${q(on)} = ${q(right)}.${q(on)}`
    );
    return {success: true, data: {resultName, details: `Merged ${left} + ${right} into ${resultName}`}};
  }

  private async loadToMap(args: Record<string, any>): Promise<ToolResult> {
    // In the browser path the host pushes the table into kepler via the bridge;
    // the MCP/service path (no bridge) returns a preview of the table.
    if (this.bridge?.loadToMap) return this.bridge.loadToMap(args.table);
    const result = await this.db.query(`SELECT * FROM ${q(args.table)}`, 5);
    return {
      success: true,
      data: {table: args.table, columns: result.columns, previewRows: result.rows}
    };
  }

  private async histogram(args: Record<string, any>): Promise<ToolResult> {
    const {table, column, bins = 7} = args;
    // Charts read `FROM <datasetName>`; ensure the kepler dataset is materialized
    // (no-op without a bridge — the MCP path reads pre-existing tables).
    await this.ensureMaterialized(table);
    // Read ALL rows (uncapped) keeping row positions so brush-selection on the
    // map can map bin → dataset rows. Non-numeric / null cells are dropped but
    // the original row index is retained (matches the host's getValuesFromDataset).
    const result = await this.db.queryAll(`SELECT ${q(column)} AS _v FROM ${q(table)}`);
    const entries: {v: number; i: number}[] = [];
    result.rows.forEach((r, i) => {
      const raw = r._v;
      if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) return;
      entries.push({v: Number(raw), i});
    });
    const {histogramData, barDataIndexes} = buildHistogramBins(
      entries.map(e => e.v),
      entries.map(e => e.i),
      bins
    );
    return {
      success: true,
      data: {
        table,
        column,
        totalValues: entries.length,
        details: `Histogram for ${column}: ${bins} bins.`,
        // renderer-only payload under __ui; MCP strips it
        __ui: {histogramData, barDataIndexes, source: this.bridge ? 'kepler' : 'duckdb'}
      }
    };
  }

  private async boxplot(args: Record<string, any>): Promise<ToolResult> {
    const {table, variableNames} = args;
    if (!table || !Array.isArray(variableNames) || !variableNames.length) {
      return {success: false, error: 'chart.boxplot requires {table, variableNames}'};
    }
    await this.ensureMaterialized(table);
    const boxplots = [];
    for (const column of variableNames) {
      const values = await this.columnValues(table, column);
      boxplots.push({name: column, ...percentileStats(values)});
    }
    return {
      success: true,
      data: {
        table,
        variables: variableNames,
        boxplots,
        // renderer-only payload under __ui; MCP strips it
        __ui: {meanPoint: boxplots.map(b => [b.name, b.mean] as [string, number])}
      }
    };
  }

  private async scatterplot(args: Record<string, any>): Promise<ToolResult> {
    const {table, xVariableName, yVariableName} = args;
    if (!table || !xVariableName || !yVariableName) {
      return {success: false, error: 'chart.scatterplot requires {table, xVariableName, yVariableName}'};
    }
    await this.ensureMaterialized(table);
    const x = await this.columnValues(table, xVariableName);
    const y = await this.columnValues(table, yVariableName);
    return {
      success: true,
      data: {
        table,
        xVariableName,
        yVariableName,
        totalPoints: Math.min(x.length, y.length),
        correlation: pearsonCorrelation(x, y),
        xStats: numericStats(x),
        yStats: numericStats(y)
      }
    };
  }

  private async bubble(args: Record<string, any>): Promise<ToolResult> {
    const {table, xVariableName, yVariableName, sizeVariableName} = args;
    if (!table || !xVariableName || !yVariableName || !sizeVariableName) {
      return {success: false, error: 'chart.bubble requires {table, x, y, size columns}'};
    }
    await this.ensureMaterialized(table);
    const stat = async (c: string) => numericStats(await this.columnValues(table, c));
    return {
      success: true,
      data: {
        table,
        xVariableName,
        yVariableName,
        sizeVariableName,
        xStats: await stat(xVariableName),
        yStats: await stat(yVariableName),
        sizeStats: await stat(sizeVariableName)
      }
    };
  }

  private async pcp(args: Record<string, any>): Promise<ToolResult> {
    const {table, variableNames} = args;
    if (!table || !Array.isArray(variableNames) || !variableNames.length) {
      return {success: false, error: 'chart.pcp requires {table, variableNames}'};
    }
    await this.ensureMaterialized(table);
    const pcp = [];
    for (const column of variableNames) {
      pcp.push({name: column, ...numericStats(await this.columnValues(table, column))});
    }
    return {success: true, data: {table, variables: variableNames, pcp}};
  }

  private async geodaAnalysis(args: Record<string, any>): Promise<ToolResult> {
    const {analysis} = args;
    // Ensure the source dataset is materialized into the connector before any
    // op reads it. No-op without a bridge (MCP path reads pre-existing tables).
    await this.ensureMaterialized(args.datasetName);
    if (analysis === 'spatial-weights') return this.geodaSpatialWeights(args);
    if (analysis === 'classify') return this.geodaClassify(args);
    if (analysis === 'regression') return this.geodaRegression(args);
    if (analysis === 'lisa') return this.geodaLisa(args);
    if (analysis === 'global-moran') return this.geodaGlobalMoran(args);
    if (analysis === 'standardize') return this.geodaStandardize(args);
    if (analysis === 'rate') return this.geodaRate(args);
    if (analysis === 'thiessen-polygons') return this.geodaThiessen(args);
    if (analysis === 'mst') return this.geodaMst(args);
    if (analysis === 'cartogram') return this.geodaCartogram(args);
    return {
      success: false,
      error: `geoda.analysis operation "${analysis ?? '(none)'}" is not implemented`
    };
  }

  private async geodaThiessen(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, outputDatasetName} = args;
    const geometries = await this.resolveGeometries(args);
    if (!Array.isArray(geometries) || !geometries.length) {
      return {
        success: false,
        error: 'geoda.analysis thiessen-polygons requires `geometries` (or a kepler dataset with geometry)'
      };
    }
    const features = await geodaThiessen({geoms: geometries});
    if (outputDatasetName && this.bridge?.saveResult) {
      await this.bridge.saveResult(outputDatasetName, {type: 'geojson', content: {type: 'FeatureCollection', features}});
    }
    return {
      success: true,
      data: {
        outputDatasetName,
        featureCount: features.length,
        geojson: {type: 'FeatureCollection', features},
        details: `Thiessen polygons from ${geometries.length} features${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geodaMst(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, outputDatasetName} = args;
    const geometries = await this.resolveGeometries(args);
    if (!Array.isArray(geometries) || !geometries.length) {
      return {
        success: false,
        error: 'geoda.analysis mst requires `geometries` (or a kepler dataset with geometry)'
      };
    }
    const features = await geodaMst({geoms: geometries});
    if (outputDatasetName && this.bridge?.saveResult) {
      await this.bridge.saveResult(outputDatasetName, {type: 'geojson', content: {type: 'FeatureCollection', features}});
    }
    return {
      success: true,
      data: {
        outputDatasetName,
        edgeCount: features.length,
        geojson: {type: 'FeatureCollection', features},
        details: `MST with ${features.length} edges from ${geometries.length} features${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geodaCartogram(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, weightVariable, iterations = 100, outputDatasetName} = args;
    const geometries = await this.resolveGeometries(args);
    if (!Array.isArray(geometries) || !geometries.length || !weightVariable) {
      return {
        success: false,
        error: 'geoda.analysis cartogram requires {weightVariable, geometries} (or a kepler dataset with geometry)'
      };
    }
    const values = datasetName ? await this.columnValues(datasetName, weightVariable) : [];
    const features = await geodaCartogram(geometries, values.length ? values : geometries.map((_, i) => i + 1), iterations);
    if (outputDatasetName && this.bridge?.saveResult) {
      await this.bridge.saveResult(outputDatasetName, {type: 'geojson', content: {type: 'FeatureCollection', features}});
    }
    return {
      success: true,
      data: {
        outputDatasetName,
        featureCount: features.length,
        geojson: {type: 'FeatureCollection', features},
        details: `Cartogram from ${features.length} features (${weightVariable})${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geodaRate(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, eventVariable, baseVariable, method = 'excessRisk', outputDatasetName} = args;
    if (!datasetName || !eventVariable || !baseVariable) {
      return {
        success: false,
        error: 'geoda.analysis rate requires {datasetName, eventVariable, baseVariable, method}'
      };
    }
    const event = await this.columnValues(datasetName, eventVariable);
    const base = await this.columnValues(datasetName, baseVariable);
    // @geoda/core signatures are `rawRates(base, event)` / `excessRisk(base, event)`
    // / `empiricalBayes(base, event)` — base (population at risk) first.
    let result: number[];
    if (method === 'rawRates') result = await geodaRawRates(base, event);
    else if (method === 'empiricalBayes') result = await geodaEmpiricalBayes(base, event);
    else result = await geodaExcessRisk(base, event);
    const outputVariableName = `${eventVariable}_${method}_rate`;
    // Persist the computed column so follow-up SQL / the map can reach it
    // (mirrors the demo-app's onToolCompleted → saveToDuckdb columnData).
    if (outputDatasetName && this.bridge?.saveResult) {
      await this.bridge.saveResult(outputDatasetName, {type: 'columnData', content: {[outputVariableName]: result}});
    }
    // Optional direct kepler write-back, only when the caller asks for it.
    if (outputDatasetName && args.addColumnToKepler && this.bridge?.addColumnToDataset) {
      await this.bridge.addColumnToDataset(datasetName, outputVariableName, result);
    }
    return {
      success: true,
      data: {
        datasetName,
        method,
        outputDatasetName,
        outputVariableName,
        result,
        details: `Rate (${method}) for ${eventVariable} / ${baseVariable}${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geodaStandardize(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, variableName, method = 'standardize', outputDatasetName} = args;
    if (!datasetName || !variableName) {
      return {success: false, error: 'geoda.analysis standardize requires {datasetName, variableName, method}'};
    }
    const values = await this.columnValues(datasetName, variableName);
    let result: number[];
    switch (method) {
      case 'deviationFromMean': result = await geodaDeviationFromMean(values); break;
      case 'standardizeMAD': result = await geodaStandardizeMAD(values); break;
      case 'rangeAdjust': result = await geodaRangeAdjust(values); break;
      case 'rangeStandardize': result = await geodaRangeStandardize(values); break;
      default: result = await geodaStandardize(values); break;
    }
    const outputVariableName = `${variableName}_${method}`;
    // Persist the computed column (mirrors the demo-app's saveToDuckdb columnData).
    if (outputDatasetName && this.bridge?.saveResult) {
      await this.bridge.saveResult(outputDatasetName, {type: 'columnData', content: {[outputVariableName]: result}});
    }
    // Optional direct kepler write-back, only when the caller asks for it.
    if (outputDatasetName && args.addColumnToKepler && this.bridge?.addColumnToDataset) {
      await this.bridge.addColumnToDataset(datasetName, outputVariableName, result);
    }
    return {
      success: true,
      data: {
        datasetName,
        variableName,
        method,
        outputDatasetName,
        outputVariableName,
        result,
        details: `Standardized ${variableName} (${method})${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geodaSpatialWeights(args: Record<string, any>): Promise<ToolResult> {
    const {
      datasetName,
      type = 'queen',
      k,
      orderOfContiguity,
      includeLowerOrder,
      precisionThreshold,
      distanceThreshold,
      isMile,
      useCentroids
    } = args;
    const geometries = await this.resolveGeometries(args);
    if (!Array.isArray(geometries) || !geometries.length) {
      return {
        success: false,
        error:
          'geoda.analysis spatial-weights requires `geometries` (array of GeoJSON features) or a kepler dataset with geometry'
      };
    }
    const w = await geodaCreateWeights({
      weightsType: type,
      isQueen: type === 'queen',
      k,
      orderOfContiguity,
      includeLowerOrder,
      precisionThreshold,
      distanceThreshold,
      isMile,
      useCentroids,
      geometries
    });
    const weightsId = `${datasetName ?? 'dataset'}-${type}`;
    return {
      success: true,
      data: {
        weightsId,
        weights: w.weights,
        weightsMeta: w.weightsMeta,
        details: `Weights created using ${type} for ${datasetName ?? 'dataset'}. weightsId: ${weightsId}`
      }
    };
  }

  private async geodaRegression(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, dependentVariable, independentVariables, modelType = 'classic'} = args;
    if (!datasetName || !dependentVariable || !Array.isArray(independentVariables) || !independentVariables.length) {
      return {
        success: false,
        error: 'geoda.analysis regression requires {datasetName, dependentVariable, independentVariables, modelType}'
      };
    }
    const y = await this.columnValues(datasetName, dependentVariable);
    const x = await Promise.all(independentVariables.map(c => this.columnValues(datasetName, c)));
    const weights = args.weights;
    if (modelType !== 'classic' && !Array.isArray(weights)) {
      return {
        success: false,
        error: `geoda.analysis regression modelType "${modelType}" requires a \`weights\` neighbor-list input`
      };
    }
    const props = {
      y,
      x,
      yName: dependentVariable,
      xNames: independentVariables,
      datasetName,
      ...(Array.isArray(weights) ? {weights, weightsId: args.weightsId ?? `${datasetName}-w`} : {})
    };
    let result: Record<string, any>;
    if (modelType === 'spatial-lag') result = await geodaSpatialLagRegression(props);
    else if (modelType === 'spatial-error') result = await geodaSpatialErrorRegression(props);
    else result = await geodaLinearRegression(props);
    return {
      success: true,
      data: {
        modelType,
        dependentVariable,
        independentVariables,
        observations: result['Number of Observations'],
        rSquared: result['R-squared'],
        adjustedRSquared: result['Adjusted R-squared'],
        coefficients: result['Variable Coefficients'],
        details: `${modelType} regression of ${dependentVariable} ~ ${independentVariables.join(' + ')} (R²=${result['R-squared']})`
      }
    };
  }

  private async geodaClassify(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, variableName, method, k = 5, hinge = 1.5} = args;
    const values = await this.columnValues(datasetName, variableName);
    let breaks: number[];
    // Note: @geoda/core functions take (k, values) — order matters.
    switch (method) {
      case 'quantile': breaks = await geodaQuantileBreaks(k, values); break;
      case 'equal interval': breaks = await geodaEqualIntervalBreaks(k, values); break;
      case 'natural breaks': breaks = await geodaNaturalBreaks(k, values); break;
      case 'percentile': breaks = await geodaPercentileBreaks(values); break;
      case 'standard deviation': breaks = await geodaStdDevBreaks(values); break;
      case 'box': breaks = await geodaHinge15Breaks(values); break;
      default: return {success: false, error: `Unknown classify method "${method}"`};
    }
    return {success: true, data: {breaks, details: `${method} breaks for ${variableName}: ${breaks.join(', ')}`}};
  }

  private async geodaLisa(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, variableName, method = 'localMoran', weights, permutation = 999, significanceThreshold = 0.05} =
      args;
    if (!datasetName || !variableName || !Array.isArray(weights)) {
      return {
        success: false,
        error: 'geoda.analysis lisa requires {datasetName, variableName, weights} (weights = neighbor list)'
      };
    }
    const values = await this.columnValues(datasetName, variableName);
    const opts = {data: values, neighbors: weights, permutation, significanceCutoff: significanceThreshold};
    const lm = method === 'localGeary' ? await geodaLocalGeary(opts) : await geodaLocalMoran(opts);
    const labels = lm.labels as string[];
    const clusterColorAndLabels = labels.map((label, i) => ({
      value: i,
      label,
      color: (lm.colors as string[])[i],
      numberOfObservations: (lm.clusters as number[]).filter(c => c === i).length
    }));
    return {
      success: true,
      data: {
        datasetName,
        variableName,
        method,
        lisaValues: lm.lisaValues,
        pValues: lm.pValues,
        clusters: lm.clusters,
        clusterColorAndLabels,
        totalObservations: values.length,
        details: `LISA (${method}) completed for ${variableName}. ${clusterColorAndLabels
          .filter(c => c.numberOfObservations > 0)
          .map(c => `${c.label}: ${c.numberOfObservations}`)
          .join(', ')}`
      }
    };
  }

  private async geodaGlobalMoran(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, variableName, weights} = args;
    if (!datasetName || !variableName || !Array.isArray(weights)) {
      return {
        success: false,
        error: 'geoda.analysis global-moran requires {datasetName, variableName, weights} (weights = neighbor list)'
      };
    }
    const values = await this.columnValues(datasetName, variableName);
    const lagValues = await geodaSpatialLag(values, weights);
    const n = values.length;
    const meanX = values.reduce((a, b) => a + b, 0) / n;
    let numerator = 0;
    let denomX = 0;
    for (let i = 0; i < n; i++) {
      const dx = values[i] - meanX;
      const dy = (lagValues[i] as number) - meanX;
      numerator += dx * dy;
      denomX += dx * dx;
    }
    const slope = denomX > 0 ? numerator / denomX : 0;
    return {
      success: true,
      data: {
        globalMoranI: slope,
        datasetName,
        variableName,
        totalObservations: n,
        details: `Global Moran's I is ${slope.toFixed(4)} for ${variableName}.`
      }
    };
  }

  private async geoGrid(args: Record<string, any>): Promise<ToolResult> {
    const {bbox, rows, columns, outputDatasetName} = args;
    if (!bbox || !rows || !columns) {
      return {
        success: false,
        error: 'geo.grid requires {bbox: [[minLng,minLat],[maxLng,maxLat]], rows, columns}'
      };
    }
    const [[minX, minY], [maxX, maxY]] = bbox as [[number, number], [number, number]];
    const cellWidth = (maxX - minX) / columns;
    const cellHeight = (maxY - minY) / rows;
    const grid = rectangleGrid([minX, minY, maxX, maxY], cellWidth, cellHeight, {units: 'degrees'});
    return {
      success: true,
      data: {
        outputDatasetName,
        featureCount: grid.features.length,
        geojson: grid,
        details: `Rectangular grid of ${rows}×${columns} (${grid.features.length} cells)${outputDatasetName ? ` → ${outputDatasetName}` : ''}.`
      }
    };
  }

  private async geoRouting(args: Record<string, any>): Promise<ToolResult> {
    const {origin, destination, mode = 'driving', datasetName} = args;
    if (!origin || !destination) {
      return {success: false, error: 'geo.routing requires {origin, destination}'};
    }
    try {
      const token = await this.bridge?.getMapboxToken?.();
      const {geojson, distance, duration} = await mapboxRouting(origin, destination, mode, token);
      if (datasetName && this.bridge?.saveResult) {
        await this.bridge.saveResult(datasetName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          datasetName,
          distance,
          duration,
          details: `Routing directions saved as ${datasetName ?? '<not named>'}.`
        }
      };
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async geoIsochrone(args: Record<string, any>): Promise<ToolResult> {
    const {origin, timeLimit, distanceLimit, profile = 'driving', datasetName} = args;
    if (!origin) return {success: false, error: 'geo.isochrone requires {origin}'};
    try {
      const token = await this.bridge?.getMapboxToken?.();
      const geojson = await mapboxIsochrone(origin, {timeLimit, distanceLimit, profile}, token);
      if (datasetName && this.bridge?.saveResult) {
        await this.bridge.saveResult(datasetName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          datasetName,
          featureCount: geojson.features.length,
          details: `Isochrone polygons saved as ${datasetName ?? '<not named>'}.`
        }
      };
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async geoGeocode(args: Record<string, any>): Promise<ToolResult> {
    const {address, datasetName} = args;
    if (!address) return {success: false, error: 'geo.geocode requires {address}'};
    try {
      const geojson = await nominatimGeocode(address);
      if (datasetName && this.bridge?.saveResult) {
        await this.bridge.saveResult(datasetName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          datasetName,
          featureCount: geojson.features.length,
          details: `Geocoded address: ${address}. Saved as ${datasetName ?? '<not named>'}.`
        }
      };
    } catch (error) {
      return {success: false, error: `Failed to geocode: ${error instanceof Error ? error.message : error}`};
    }
  }

  private async geoRoads(args: Record<string, any>): Promise<ToolResult> {
    const {datasetName, mapBounds, outputDatasetName} = args;
    try {
      let bounds: GeoBounds | undefined;
      if (datasetName) {
        const geometries = await this.resolveGeometries(args);
        if (!Array.isArray(geometries) || !geometries.length) {
          return {success: false, error: `Dataset ${datasetName} is empty or not found`};
        }
        bounds = featuresBbox(geometries);
      } else if (mapBounds) {
        bounds = {
          south: mapBounds.southeast.latitude,
          east: mapBounds.southeast.longitude,
          north: mapBounds.northwest.latitude,
          west: mapBounds.northwest.longitude
        };
      } else {
        const boundary = await this.bridge?.getMapBoundary?.();
        if (boundary) {
          bounds = {west: boundary.nw[0], north: boundary.nw[1], east: boundary.se[0], south: boundary.se[1]};
        }
      }
      if (!bounds) {
        return {
          success: false,
          error: 'geo.roads requires a datasetName, mapBounds, or the current map viewport'
        };
      }
      const geojson = await overpassRoads(bounds);
      const outName = outputDatasetName || `roads_${Date.now()}`;
      if (this.bridge?.saveResult) {
        await this.bridge.saveResult(outName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          outputDatasetName: outName,
          featureCount: geojson.features.length,
          details: `Fetched ${geojson.features.length} roads -> ${outName}.`
        }
      };
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async geoUsBoundary(args: Record<string, any>): Promise<ToolResult> {
    const {type, ids, outputDatasetName} = args;
    if (!type || !Array.isArray(ids) || !ids.length) {
      return {success: false, error: 'geo.us-boundary requires {type: state|county|zipcode, ids: string[]}'};
    }
    try {
      const features = await usBoundaries(type, ids);
      const prefix = type === 'state' ? 'states' : type === 'county' ? 'counties' : 'zipcodes';
      const outName = outputDatasetName || `${prefix}_${Date.now()}`;
      const geojson = {type: 'FeatureCollection', features};
      if (this.bridge?.saveResult) {
        await this.bridge.saveResult(outName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          outputDatasetName: outName,
          featureCount: features.length,
          geojson,
          details: `Fetched ${features.length} ${type} boundaries -> ${outName}.`
        }
      };
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  /**
   * Run a DuckDB spatial SQL query over one or more materialized datasets.
   * `__tbl0__`, `__tbl1__`, ... placeholders resolve to the (verbatim)
   * dataset names the bridge materialized, so the same naming the rest of the
   * engine uses applies. Returns the GeoJSON features plus per-input `tableSchemas`
   * and a `firstFiveRows` scalar preview for the model.
   */
  private async geoSpatialQuery(args: Record<string, any>): Promise<ToolResult> {
    const {datasetNames, outputDatasetName, sqlQuery, reasoning} = args;
    if (!Array.isArray(datasetNames) || !datasetNames.length || !outputDatasetName || !sqlQuery) {
      return {
        success: false,
        error: 'geo.spatial-query requires {datasetNames, outputDatasetName, sqlQuery}'
      };
    }
    try {
      const tableSchemas: {tableName: string; columns: string[]}[] = [];
      for (const name of datasetNames) {
        await this.ensureMaterialized(name);
        const desc = await this.db.queryAll(`DESCRIBE "${name}"`);
        tableSchemas.push({
          tableName: name,
          columns: desc.rows.map(r => String(r.column_name ?? r.name)).filter(Boolean)
        });
      }

      let resolvedSql = sqlQuery;
      datasetNames.forEach((name, i) => {
        resolvedSql = resolvedSql.replace(new RegExp(`__tbl${i}__`, 'g'), `"${name}"`);
      });

      const result = await this.db.queryAll(resolvedSql);
      const features = result.rows.map((row: any) => {
        let geometry = row.geometry;
        if (typeof geometry === 'string') {
          try {
            geometry = JSON.parse(geometry);
          } catch {
            // leave as-is (already a GeoJSON object in a string column)
          }
        }
        const props = {...row};
        delete props.geometry;
        return {type: 'Feature', geometry, properties: props};
      });
      const geojson = {type: 'FeatureCollection', features};
      if (this.bridge?.saveResult) {
        await this.bridge.saveResult(outputDatasetName, {type: 'geojson', content: geojson});
      }
      return {
        success: true,
        data: {
          outputDatasetName,
          details: `${reasoning ?? 'Spatial query'} — ${features.length} features -> ${outputDatasetName}.`,
          tableSchemas,
          firstFiveRows: features.slice(0, 5).map(f => f.properties)
        }
      };
    } catch (error) {
      return {success: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  private async columnValues(table: string, column: string): Promise<number[]> {
    // Uncapped read: the 50-row model-facing cap would silently sample larger
    // datasets and skew geoda/chart statistics.
    const result = await this.db.queryAll(
      `SELECT ${q(column)} AS _v FROM ${q(table)} WHERE ${q(column)} IS NOT NULL`
    );
    return result.rows.map(r => Number(r._v)).filter(v => Number.isFinite(v));
  }
}

/**
 * Quote a SQL identifier (table / column) so verbatim names like `us-states.json`
 * or `bart.geo.json` parse. Double quotes inside the identifier are escaped.
 */
function q(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function buildCondition(c: {column: string; op: string; value?: unknown}): string {
  const col = q(c.column);
  switch (c.op) {
    case 'eq': return `${col} = ${sqlVal(c.value)}`;
    case 'neq': return `${col} != ${sqlVal(c.value)}`;
    case 'gt': return `${col} > ${sqlVal(c.value)}`;
    case 'gte': return `${col} >= ${sqlVal(c.value)}`;
    case 'lt': return `${col} < ${sqlVal(c.value)}`;
    case 'lte': return `${col} <= ${sqlVal(c.value)}`;
    case 'contains': return `${col} ILIKE '%${String(c.value).replace(/'/g, "''")}%'`;
    default: return 'TRUE';
  }
}

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Build histogram bins plus the original row index of every value in each bin
 * (so the renderer's brush-selection can map a bin back to kepler dataset rows).
 */
function buildHistogramBins(
  values: number[],
  indices: number[],
  bins: number
): {histogramData: {binStart: number; binEnd: number; count: number}[]; barDataIndexes: number[][]} {
  if (!values.length) return {histogramData: [], barDataIndexes: []};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = (max - min) / bins || 1;
  const histogramData = new Array(bins).fill(0).map((_, i) => ({
    binStart: min + i * w,
    binEnd: min + (i + 1) * w,
    count: 0
  }));
  const barDataIndexes: number[][] = Array.from({length: bins}, () => []);
  values.forEach((v, i) => {
    const bin = Math.min(Math.floor((v - min) / w), bins - 1);
    histogramData[bin].count++;
    barDataIndexes[bin].push(indices[i]);
  });
  return {histogramData, barDataIndexes};
}

// --- pure-JS statistics helpers (GeoDa-style classify + chart stats) ---

function sortedValues(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function percentile(values: number[], p: number): number {
  const s = sortedValues(values);
  if (!s.length) return NaN;
  if (s.length === 1) return s[0];
  // linear interpolation (type 7, numpy default)
  const rank = ((s.length - 1) * p) / 100;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (rank - lo) * (s[hi] - s[lo]);
}

function numericStats(values: number[]): {min: number; max: number; mean: number; std: number} {
  if (!values.length) return {min: 0, max: 0, mean: 0, std: 0};
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {min: Math.min(...values), max: Math.max(...values), mean, std: Math.sqrt(variance)};
}

function percentileStats(values: number[]): {
  min: number; q1: number; median: number; q3: number; max: number; mean: number; std: number; iqr: number;
} {
  const s = sortedValues(values);
  const q1 = percentile(s, 25);
  const q3 = percentile(s, 75);
  const {mean, std} = numericStats(s);
  return {
    min: s[0] ?? 0,
    q1,
    median: percentile(s, 50),
    q3,
    max: s[s.length - 1] ?? 0,
    mean,
    std,
    iqr: q3 - q1
  };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (!n) return 0;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
