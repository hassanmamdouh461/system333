import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTables,
  setTables,
  addTable,
  removeTable,
  getNextTableSuggestion,
  DEFAULT_TABLES,
} from './tablesConfig';

describe('tablesConfig', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
      clear: () => { storage = {}; },
      key: () => null,
      length: 0,
    };
  });

  it('returns DEFAULT_TABLES when no tables are saved', () => {
    expect(getTables()).toEqual(DEFAULT_TABLES);
  });

  it('adds a new table and persists it', () => {
    const updated = addTable('11');
    expect(updated).toContain('11');
    expect(getTables()).toContain('11');
  });

  it('does not duplicate existing table', () => {
    const before = getTables().length;
    addTable('1');
    expect(getTables().length).toBe(before);
  });

  it('removes a table and persists change', () => {
    removeTable('5');
    expect(getTables()).not.toContain('5');
  });

  it('sets custom table list and trims entries', () => {
    setTables(['A1', ' A2 ', 'A3']);
    expect(getTables()).toEqual(['A1', 'A2', 'A3']);
  });

  it('suggests the next table number', () => {
    expect(getNextTableSuggestion(['1', '2', '3'])).toBe('4');
    expect(getNextTableSuggestion(['T1', 'T5', 'T10'])).toBe('11');
    expect(getNextTableSuggestion([])).toBe('1');
  });
});
