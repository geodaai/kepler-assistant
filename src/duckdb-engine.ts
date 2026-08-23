/**
 * DuckDB-backed data engine for the `data.*` commands.
 *
 * Built on the `@sqlrooms/duckdb-core` `DuckDbConnector` interface, so it is
 * portable across backends — `createWasmDuckDbConnector` (duckdb-wasm, the
 * demo-app/browser build), native DuckDB, or MotherDuck (a WebSocket connector).
 * This is exactly the abstraction the demo-app uses, which is why the same
 * analysis component can be built for the demo-app.
 */

import type {Table} from 'apache-arrow';

/**
 * Minimal connector surface the engine needs. Any `@sqlrooms/duckdb-core`
 * `DuckDbConnector` (or anything with `query(sql)`) satisfies this
 * structurally, so the engine is not coupled to a specific duckdb-core version.
 */
export interface QueryableConnector {
  query(sql: string): unknown;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export class DuckDbEngine {
  constructor(private readonly connector: QueryableConnector) {}

  /** Run a SELECT and return the rows as JSON (capped for the model). */
  async query(sql: string, limit = 50): Promise<QueryResult> {
    const table = (await this.connector.query(
      `SELECT * FROM (${stripTrailingSemicolon(sql)}) AS _kepler_q LIMIT ${limit}`
    )) as Table;
    const rows = tableToJson(table);
    return {
      columns: table.schema.fields.map(f => f.name),
      rows,
      totalRows: rows.length
    };
  }

  /**
   * Run a SELECT and return ALL rows as JSON (uncapped). Used by internal
   * compute reads (chart.*, geoda.*) where the model-facing 50-row cap would
   * silently sample a larger dataset and skew statistics/histograms. The host
   * demo-app reads the full column too (`getValuesFromDataset`), so this is
   * behavior-preserving for the browser path.
   */
  async queryAll(sql: string): Promise<QueryResult> {
    const table = (await this.connector.query(stripTrailingSemicolon(sql))) as Table;
    const rows = tableToJson(table);
    return {
      columns: table.schema.fields.map(f => f.name),
      rows,
      totalRows: rows.length
    };
  }

  /** Run an arbitrary statement (CREATE/INSERT/DROP). */
  async exec(sql: string): Promise<void> {
    await this.connector.query(sql);
  }

  /** Create a table from an inline `VALUES` list derived from rows. */
  async createTableFromRows(name: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) {
      await this.connector.query(`CREATE TABLE ${name} (__empty BOOLEAN)`);
      return;
    }
    const cols = Object.keys(rows[0]);
    const colsSql = cols.map(c => `"${c}"`).join(', ');
    const values = rows
      .map(r => `(${cols.map(c => sqlLiteral(r[c])).join(', ')})`)
      .join(', ');
    await this.connector.query(
      `CREATE TABLE ${name} AS SELECT ${cols.map(c => `_v."${c}"`).join(', ')} FROM (VALUES ${values}) AS _v(${colsSql})`
    );
  }

  /** List tables in the catalog. */
  async listTables(): Promise<string[]> {
    const res = await this.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='main'`);
    return res.rows.map(r => String(r.table_name));
  }
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * JSON-safe scalar. Arrow INT64 surfaces as a JS BigInt, which breaks
 * JSON.stringify (data.query previews) and CDP `returnByValue` (a host reading
 * engine rows through Puppeteer) — coerce to String, matching the host's
 * `convertArrowRowToObject` convention. Arrow DECIMAL surfaces as a BigNum
 * wrapper object — coerce to Number via its valueOf.
 */
function toJsonSafe(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v !== null && typeof v === 'object' && typeof (v as any).valueOf === 'function') {
    const name = (v as any).constructor?.name;
    if (name === 'Decimal' || name === 'DecimalBigNum') {
      const d = Number(v as any);
      if (Number.isFinite(d)) return d;
    }
  }
  return v;
}

/** Convert an Apache Arrow table to an array of plain objects. */
function tableToJson(table: Table): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const obj: Record<string, unknown> = {};
    for (const field of table.schema.fields) {
      obj[field.name] = toJsonSafe(table.getChild(field.name)?.get(i));
    }
    out.push(obj);
  }
  return out;
}
