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

export function createMockConnector() {
  const recorded: string[] = [];
  return {
    type: 'wasm' as const,
     
    async query(sql: string): Promise<any> {
      recorded.push(sql);
      // chart.histogram / columnValues select `<col> AS _v`; return the sample
      // numbers so the engine computes real statistics. Binary columns (for the
      // colocation / local join count tests) return their 0/1 fixture. Everything
      // else returns a small table.
      if (/_v/.test(sql)) {
        for (const [column, rows] of Object.entries(BINARY_COLUMNS)) {
          if (sql.includes(`"${column}"`)) return tableFromJSON(rows);
        }
        return tableFromJSON(SAMPLE);
      }
      return tableFromJSON([{ok: true, sql: sql.slice(0, 40)}]);
    },
    async close(): Promise<void> {},
    getRecordedSql(): string[] {
      return recorded;
    }
  };
}
