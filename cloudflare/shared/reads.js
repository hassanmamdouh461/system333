export const ANALYTICS_COLLECTION_BYTES = 2_000_000;
export const PUBLIC_MENU_BYTES = 12_000_000;

// All SQL fragments and identifiers are server-owned. Row-size checks run in SQLite,
// so an oversized page is never materialized as unbounded JS objects in the isolate.
export function boundedSelectSql(table, columns, where, orderBy, budget = ANALYTICS_COLLECTION_BYTES) {
  const fields = columns.join(', ');
  const object = columns.flatMap((column) => [`'${column}'`, column]).join(', ');
  return `WITH bounded_page AS (
    SELECT ${fields} FROM ${table} ${where} ORDER BY ${orderBy} LIMIT ?
  ), sized_page AS (
    SELECT ${fields}, SUM(length(CAST(json_object(${object}) AS BLOB)) + 1)
      OVER (ORDER BY ${orderBy} ROWS UNBOUNDED PRECEDING) AS response_bytes
    FROM bounded_page
  ) SELECT ${columns.map((column) => `CASE WHEN response_bytes <= ${budget} THEN ${column} END AS ${column}`).join(', ')},
    response_bytes > ${budget} AS _size_truncated
    FROM sized_page ORDER BY ${orderBy.split(',').map((part) => `sized_page.${part.trim()}`).join(', ')}`;
}

export function readPage(result, limit) {
  if (!result || result.success === false || !Array.isArray(result.results)) throw new Error('Database read unavailable');
  const rows = [];
  let truncated = result.results.length > limit;
  for (const row of result.results.slice(0, limit)) {
    if (row._size_truncated) {
      truncated = true;
    } else {
      const { _size_truncated, ...fields } = row;
      rows.push(fields);
    }
  }
  return { rows, truncated };
}
