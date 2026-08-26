/**
 * Mock `DuckDbConnector` for Node dev/verification.
 *
 * duckdb-wasm does not run under this environment's Node (it expects a
 * browser-style Worker), and native DuckDB needs a build toolchain we don't
 * have here. This connector implements the `@sqlrooms/duckdb-core`
 * `DuckDbConnector` shape well enough to exercise the analysis engine's
 * SQL→Arrow→JSON→MCP wiring over the tool surface. It returns Arrow tables
 * (via `apache-arrow`) that the engine's `DuckDbEngine` consumes.
 *
 * The demo-app/browser uses the real `createWasmDuckDbConnector` (duckdb-wasm);
 * this mock is only for local Node runs/tests.
 */

import {tableFromJSON} from 'apache-arrow';

interface Row {
  _v?: number;
  [key: string]: unknown;
}

/** A canned dataset the mock returns for column reads. */
const SAMPLE: Row[] = [{_v: 10}, {_v: 10}, {_v: 20}, {_v: 20}];

/** Binary 0/1 columns for the colocation (local join count) tests. */
const BINARY_COLUMNS: Record<string, Row[]> = {
  binFlag: [{_v: 1}, {_v: 1}, {_v: 0}, {_v: 0}],
  binFlagB: [{_v: 0}, {_v: 0}, {_v: 1}, {_v: 1}]
};

/**
 * Wrap a resolved promise in the `QueryHandle` shape `DuckDbConnector` returns
 * (a thenable with `result` / `cancel` / `signal`), so `await` still yields the
 * value while the mock satisfies the interface.
 */
function toHandle<T>(result: Promise<T>) {
  return Object.assign(result, {
    result,
    cancel: async () => {},
    signal: new AbortController().signal
  });
}

export function createMockConnector() {
  const recorded: string[] = [];
  // Tables registered via `loadArrow` (and removed by `DROP TABLE IF EXISTS`),
  // so `information_schema.tables` existence checks — used by
  // `ensureKeplerDatasetsMaterialized` — answer truthfully.
  const tables = new Set<string>();
  const loadArrowCounts = new Map<string, number>();
  return {
    type: 'wasm' as const,

    query(sql: string) {
      recorded.push(sql);
      let result: Promise<any>;
      // information_schema.tables existence checks: 1 row when the named table
      // has been loaded, 0 rows otherwise.
      if (/information_schema\.tables/.test(sql)) {
        const match = sql.match(/table_name = '([^']+)'/);
        const name = match?.[1];
        result = Promise.resolve(tableFromJSON(name && tables.has(name) ? [{exists: 1}] : []));
      } else if (/_v/.test(sql)) {
        // chart.histogram / columnValues select `<col> AS _v`; return the sample
        // numbers so the engine computes real statistics. Binary columns (for the
        // colocation / local join count tests) return their 0/1 fixture.
        let rows = SAMPLE;
        for (const [column, binaryRows] of Object.entries(BINARY_COLUMNS)) {
          if (sql.includes(`"${column}"`)) {
            rows = binaryRows;
            break;
          }
        }
        result = Promise.resolve(tableFromJSON(rows));
      } else {
        result = Promise.resolve(tableFromJSON([{ok: true, sql: sql.slice(0, 40)}]));
      }
      return toHandle(result);
    },
    execute(sql: string) {
      recorded.push(sql);
      const drop = sql.match(/DROP TABLE IF EXISTS "([^"]+)"/);
      if (drop) tables.delete(drop[1]);
      return toHandle(Promise.resolve());
    },
    async loadArrow(_table: any, name: string): Promise<void> {
      tables.add(name);
      loadArrowCounts.set(name, (loadArrowCounts.get(name) ?? 0) + 1);
    },
    async initialize(): Promise<void> {},
    async destroy(): Promise<void> {},
    queryJson(sql: string) {
      const table = this.query(sql);
      return toHandle(
        Promise.resolve(table.then((t: any) => t.toArray().map((row: any) => row.toJSON())))
      );
    },
    async loadFile(): Promise<void> {},
    async loadObjects(): Promise<void> {},
    async close(): Promise<void> {},
    getRecordedSql(): string[] {
      return recorded;
    },
    hasTable(name: string): boolean {
      return tables.has(name);
    },
    getLoadArrowCount(name: string): number {
      return loadArrowCounts.get(name) ?? 0;
    }
  };
}
