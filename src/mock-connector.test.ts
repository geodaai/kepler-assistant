import {describe, expect, it} from 'vitest';
import {createMockConnector} from './mock-connector';

describe('createMockConnector', () => {
  it('returns Arrow tables for SQL (with _v column reads returning sample data)', async () => {
    const connector = createMockConnector();
    const table = await connector.query('SELECT amount AS _v FROM sales');
    expect(table.numRows).toBe(4);
  });

  it('returns a generic table for other SQL', async () => {
    const connector = createMockConnector();
    const table = await connector.query('SELECT region, amount FROM sales');
    expect(table.numRows).toBeGreaterThanOrEqual(1);
  });

  it('records every issued SQL statement', async () => {
    const connector = createMockConnector();
    await connector.query('SELECT 1');
    await connector.query('SELECT 2');
    expect(connector.getRecordedSql()).toHaveLength(2);
  });

  it('close resolves without error', async () => {
    const connector = createMockConnector();
    await expect(connector.close()).resolves.toBeUndefined();
  });
});
