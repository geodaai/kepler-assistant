/**
 * The kepler-bound glue layer. Implements the `KeplerContext` glue methods
 * (`getValuesFromDataset`, `getDatasetContext`, `loadTableToKepler`,
 * `loadTableIntoDuckDB`, `getConnector`) plus the analysis glue the
 * `KeplerBridge` and the analysis shims use (`saveToDuckdb`,
 * `getGeometriesFromDataset`, `ensureKeplerDatasetsMaterialized`,
 * `highlightRows`, `formatResultsForLLM`, ...).
 *
 * This is the only layer that imports `@kepler.gl/*` runtime packages; the
 * vendored map-surface commands (`../mcp`, temporarily integrated from the
 * kepler.gl `@kepler.gl/mcp` module) stay kepler-app-bound through the
 * `KeplerContext` seam, and the analysis engine stays kepler-agnostic through
 * `KeplerBridge`.
 */

export * from './utils';
export * from './duckdb-cache';
