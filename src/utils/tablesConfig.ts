const LS_TABLES_KEY = 'engaz_tables_config';

export const DEFAULT_TABLES: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function getStorageItem(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return null;
}

function setStorageItem(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, val);
  }
}

/**
 * Persist settings value through electronAPI to SQLite (if available)
 * and update localStorage cache.
 */
function persistTables(tables: string[]): void {
  const serialized = JSON.stringify(tables);
  setStorageItem(LS_TABLES_KEY, serialized);
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
    window.electronAPI.saveSetting(LS_TABLES_KEY, serialized).catch((err: unknown) => {
      console.warn('[tables] Failed to persist tables to SQLite:', err);
    });
  }
}

/**
 * Get the list of configured tables.
 */
export function getTables(): string[] {
  const saved = getStorageItem(LS_TABLES_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = Array.from(new Set(parsed.map(t => String(t).trim()).filter(Boolean)));
        if (clean.length > 0) return clean;
      }
    } catch {
      // Fallback to default
    }
  }
  return [...DEFAULT_TABLES];
}

/**
 * Save the entire list of tables.
 */
export function setTables(tables: string[]): string[] {
  const clean = Array.from(new Set(tables.map(t => String(t).trim()).filter(Boolean)));
  persistTables(clean);
  return clean;
}

/**
 * Add a table to the list.
 */
export function addTable(tableName: string): string[] {
  const trimmed = tableName.trim();
  if (!trimmed) return getTables();

  const current = getTables();
  if (current.includes(trimmed)) return current;

  const updated = [...current, trimmed];
  persistTables(updated);
  return updated;
}

/**
 * Remove a table from the list.
 */
export function removeTable(tableName: string): string[] {
  const current = getTables();
  const updated = current.filter(t => t !== tableName);
  persistTables(updated);
  return updated;
}

/**
 * Helper to suggest the next logical table number.
 * e.g., if current has ['1','2',...,'10'], suggests '11'.
 */
export function getNextTableSuggestion(tables: string[]): string {
  const nums = tables
    .map(t => {
      const match = t.match(/\d+/);
      return match ? parseInt(match[0], 10) : NaN;
    })
    .filter(n => !isNaN(n));

  if (nums.length === 0) return '1';
  return String(Math.max(...nums) + 1);
}
