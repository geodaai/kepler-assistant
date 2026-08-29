## Host integration (kepler-assistant)

This section is appended by kepler-assistant's `scripts/generate-skills.mjs` on
top of the harness-agnostic GeoDa skill sourced from the `@geoda/*` library
repo (`geoda-lib/skills/geoda-analysis`). It carries the command surface of
THIS assistant — a kepler.gl map/table host. The statistical semantics in the
standalone section above (create weights FIRST, binary-only join counts,
break-bound inclusivity, never re-run LISA on a result dataset) apply unchanged.

- Run every statistical op with the `geoda.analysis` command via
  `executeCommand` — do **NOT** use `node analyze.mjs`. The standalone node
  driver is for skill installs without a map host; it is not available here.
- Geometry ops are **not** `geoda.analysis` ops — write DuckDB spatial SQL and
  run it via `geo.spatial-query` (patterns below).
- `geoda.analysis` computes on datasets already in kepler.gl. A new dataset
  produced by any tool must be saved in kepler.gl first (`data.load-to-map`)
  before it can be used as input.

### 1. Statistical operations — `geoda.analysis`

All statistical GeoDa operations go through the single `geoda.analysis`
command. Pick the operation with the `analysis` field:

```json
{
  "call": {
    "apiName": "executeCommand",
    "args": {
      "commandId": "geoda.analysis",
      "input": { "analysis": "lisa", "datasetName": "counties", "variableName": "income", "method": "localMoran", "weightsId": "w-counties-queen-1-0" }
    }
  },
  "reasoning": "Run LISA on the income variable."
}
```

Operations:
- `spatial-weights` — `{ datasetName, type: queen|rook|knn|threshold, k?, orderOfContiguity?, includeLowerOrder?, precisionThreshold?, distanceThreshold?, isMile?, useCentroids?, weightsColumnName? }` → `{ weightsId, weightsColumnName }`. **Create weights FIRST** — LISA, global Moran, and spatial regression need a `weightsId`. Adds a `<type>w` column (e.g. `queenw`) to the map dataset **in place** holding the neighbor list: row i's value is the array of neighbor indices of row i (e.g. `[3, 8, 10]`). Pass `weightsColumnName` to override the default name. To reuse the weights for LISA / global Moran / regression, pass the returned `weightsId` (e.g. `sales-queen`) — the assistant resolves it from the saved `<type>w` column, so it survives across turns. If the `weightsId` is unknown, re-create weights first.
- `lisa` — `{ datasetName, variableName, method: localMoran|localGeary|localG|localGStar|quantileLisa, weightsId, permutation?, significanceThreshold?, k?, quantile?, clusterColumnName? }` → `{ clusterColumnName, clusterColorAndLabels, totalObservations }`. Adds a `lisa_cluster` column (0=not significant, 1=HH, 2=LL, 3=LH, 4=HL) to the map dataset **in place** so the clusters can be visualized. To build the local Moran map, call `map.add-layer` on the SAME dataset with `colorBy: clusterColumnName`, `colorType: "unique"`, and a `colorMap` built from the returned `clusterColorAndLabels` (use each entry's `value` and `color` verbatim). If the default column name is already taken, pass a different `clusterColumnName`.
- `global-moran` — `{ datasetName, variableName, weightsId }` → `{ globalMoranI }`.
- `colocation` — `{ datasetName, variableName, variableB?, weightsId, permutation?, significanceThreshold?, clusterColumnName? }` → `{ type, variables, clusterColumnName, clusterColorAndLabels, totalObservations }`. Statistical Local Join Count; both variables must be binary 0/1 (`variableB` omitted → univariate). Needs `@geoda/* >= 0.0.24` (the node WASM build fixed in 0.0.24). `variableB` computes the no-colocation statistic and requires that no observation is 1 in both variables — use mutually exclusive categories or a variable and its complement. Adds a `lisa_cluster` column (0=not significant, 1=significant) to the map dataset **in place** so the clusters can be visualized. To build the colocation map, call `map.add-layer` on the SAME dataset with `colorBy: clusterColumnName`, `colorType: "unique"`, and a `colorMap` built from the returned `clusterColorAndLabels` (use each entry's `value` and `color` verbatim). If the default column name is already taken, pass a different `clusterColumnName`.
- `regression` — `{ datasetName, dependentVariable, independentVariables, modelType: classic|spatial-lag|spatial-error, weightsId? }` → `{ result }`.
- `classify` — `{ datasetName, variableName, method, k?, hinge? }` → `{ breaks? }` or `{ uniqueValues? }`. Feed `breaks` into `map.add-layer`'s `colorMap` to visualize.
- `rate` — `{ datasetName, eventVariable, baseVariable, method?: excessRisk|empiricalBayes, outputDatasetName }` → `{ outputDatasetName, outputVariableName }`.
- `standardize` — `{ datasetName, variableName, method: deviationFromMean|standardizeMAD|rangeAdjust|rangeStandardize|standardize, outputDatasetName }` → `{ outputDatasetName, outputVariableName }`. Use this only when the user wants a SEPARATE analysis-result dataset. When the user asks to add a derived/standardized variable (e.g. a z-score) as a NEW column in the EXISTING dataset, do NOT create a new dataset — use `map.add-column` with an `expression` instead, e.g. `{ datasetName, newColumnName: "HR60_Z", expression: "(HR60 - AVG(HR60) OVER()) / STDDEV(HR60) OVER()" }`.
- `thiessen-polygons` — `{ datasetName, outputDatasetName }`.
- `mst` — `{ datasetName, outputDatasetName }`.
- `cartogram` — `{ datasetName, weightVariable, iterations?, outputDatasetName }`.

### 2. Geometry operations — `geo.spatial-query` (DuckDB spatial SQL)

Geometry operations are NOT separate commands — write the DuckDB spatial SQL
yourself and run it via `geo.spatial-query` with `input: { datasetNames,
outputDatasetName, sqlQuery, reasoning }`. Use `__tbl0__`, `__tbl1__`, ... as
table placeholders. The geometry column stores GeoJSON strings — wrap with
`ST_GeomFromGeoJSON(geometry)`. Each query must return a `geometry` column
(GeoJSON string); scalar ops include `geometry` in the SELECT so the values
land in the result's properties. After saving, call `data.load-to-map` to load
the result onto the map, then `map.add-layer` to create a layer (neither
command auto-creates one).

SQL patterns (verified for DuckDB spatial):
- **area** — `SELECT ST_Area_Spheroid(ST_GeomFromGeoJSON(geometry)) AS area, geometry FROM __tbl0__` → m² (÷1e6 → km², ÷2.59e6 → mi²).
- **length** — `SELECT ST_Length_Spheroid(ST_GeomFromGeoJSON(geometry)) AS length, geometry FROM __tbl0__` → meters (÷1000 → km, ÷1609.344 → mi).
- **perimeter** — `SELECT ST_Perimeter_Spheroid(ST_GeomFromGeoJSON(geometry)) AS perimeter, geometry FROM __tbl0__` → meters.
- **centroid** — `SELECT ST_AsGeoJSON(ST_Centroid(ST_GeomFromGeoJSON(geometry))) AS geometry, <props> FROM __tbl0__` → point features.
- **dissolve** — `SELECT ST_AsGeoJSON(ST_Union_Agg(ST_GeomFromGeoJSON(geometry))) AS geometry FROM __tbl0__`; with `dissolveBy`: add `GROUP BY "<col>"` + `SUM/AVG/MIN/MAX/MEDIAN(CAST("<var>" AS DOUBLE))` per aggregate variable (count → `COUNT(*)`).
- **buffer** — no spheroid buffer, so transform to Web Mercator, `ST_Buffer`, transform back: `ST_Transform(ST_Buffer(ST_Transform(ST_GeomFromGeoJSON(geometry), 'EPSG:4326','EPSG:3857', always_xy := true), <meters>), 'EPSG:3857','EPSG:4326', always_xy := true) AS geometry`.
- **spatial-join** — `SELECT l.*, (SELECT COUNT(*) FROM __tbl1__ r WHERE ST_Intersects(ST_GeomFromGeoJSON(l.geometry), ST_GeomFromGeoJSON(r.geometry))) AS Count FROM __tbl0__ l`; per join variable add a correlated subquery aggregate (`SUM/AVG/MIN/MAX/MEDIAN(CAST(r."<var>" AS DOUBLE))`, `unique` → `FIRST(r."<var>")`).

### Rules (kepler host)

- STRICT RULE: Never use datasets generated from previous LISA runs (dataset
  name with a "lisa_" prefix) as input for a new LISA analysis.
- If the input is a road or line dataset, buffer it by 1 meter first (via
  `geo.spatial-query`), save the buffered road as a new dataset, and use that
  for the LISA analysis.
- Prefer `map.add-column` (with `copyFromColumn` or `expression`) to add a
  column to an EXISTING dataset in place. Only reach for `geoda.analysis`
  (which produces a new `outputDatasetName`) when the user wants a separate
  analysis result.
- `lisa` adds its cluster column to the EXISTING dataset in place (no new
  dataset). After running it, build the local Moran map layer on the SAME
  dataset — do NOT create a copy or a `lisa_`-prefixed dataset.
- For `map.add-layer` colorMap from `breaks`:
  `[{value: <break>, color: "<hex>"}, ..., {value: null, color: "<hex>"}]`
  (the last `value: null` entry is the color for the highest bin).
