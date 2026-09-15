import { str, nowIso, rejected, clientError } from './common.js';

// Column names come only from the server-owned INSERT, never from request data.
export function persistedColumns(spec) {
  const match = /\bINTO\s+\w+\s*\(([^)]+)\)/i.exec(spec.upsert);
  if (!match) throw new Error('Sync target has no persisted column list');
  return match[1].split(',').map((column) => column.trim());
}

export function assertUniqueIds(items) {
  const seen = new Set();
  for (const record of items) {
    if (record?.id == null) continue;
    const id = str(record.id);
    if (seen.has(id)) throw rejected(`Duplicate submitted id: ${id}`);
    seen.add(id);
  }
}

function stableRecord(record) {
  const createdAt = str(record.createdAt ?? record.created_at, nowIso());
  const updatedAt = str(record.updatedAt ?? record.updated_at ?? record.deletedAt ?? record.deleted_at, createdAt);
  return { ...record, createdAt, created_at: createdAt, updatedAt, updated_at: updatedAt };
}

export function prepareSyncEntry(db, spec, input, { branchId = null, tombstoneUpdates = false } = {}) {
  if (!input || !input.id) throw rejected('Every record needs an id');
  const record = stableRecord(input);
  const id = str(record.id);
  const appendOnly = spec.appendOnly === true;
  const deletedAt = str(record.deletedAt ?? record.deleted_at);
  const kind = appendOnly ? 'append' : (deletedAt ? 'tombstone' : 'verify');
  let sql;
  let params;
  let columns;
  let values;

  if (tombstoneUpdates && kind === 'tombstone') {
    const incomingBranch = str(record.branchId ?? record.branch_id)?.trim() ?? null;
    if (branchId !== null && incomingBranch !== branchId) throw rejected('Record branch does not match credential');
    sql = `UPDATE ${spec.table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND (updated_at IS NULL OR ? > updated_at)`;
    params = [deletedAt, record.updatedAt, id, record.updatedAt];
    columns = ['id', 'deleted_at', 'updated_at'];
    values = [id, deletedAt, record.updatedAt];
    if (branchId !== null) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
      columns.push('branch_id');
      values.push(branchId);
    }
    // An absent row is NOT accepted. No tombstone exists for a later pull to propagate.
  } else {
    columns = persistedColumns(spec);
    values = (spec.upsertParams || spec.params)(record);
    if (columns.length !== values.length) throw new Error('Sync parameter alignment mismatch');
    sql = spec.upsert;
    params = [...values];
    if (branchId !== null) {
      if (values[columns.indexOf('branch_id')] !== branchId) throw rejected('Record branch does not match credential');
      if (!appendOnly) {
        // Enforce existing-row ownership in the write itself, including every LWW OR arm.
        const where = sql.indexOf('WHERE ');
        if (where < 0) throw new Error('Sync target has no conflict predicate');
        sql = `${sql.slice(0, where)}WHERE (${sql.slice(where + 6)}) AND ${spec.table}.branch_id = ?`;
        params.push(branchId);
      }
    }
  }

  return {
    id, kind, params, columns, values,
    statement: db.prepare(sql).bind(...params),
    verificationSql: `SELECT id AS verified_id FROM ${spec.table} WHERE ${columns.map((column) => `${column} IS ?`).join(' AND ')} LIMIT 1`,
  };
}

export function buildSyncBatch(db, spec, items, options = {}) {
  assertUniqueIds(items);
  const entries = [];
  const failed = [];
  for (const record of items) {
    try {
      entries.push(prepareSyncEntry(db, spec, record, options));
    } catch (err) {
      failed.push({ id: record?.id == null ? null : str(record.id), error: clientError(err, err?.isRejection ? 400 : 500) });
    }
  }
  return { entries, statements: entries.map((e) => e.statement), kinds: entries.map((e) => e.kind), failed, expected: items.length };
}

export function reliableChanges(result) {
  const changes = result?.meta?.changes;
  return result?.success === true && Number.isSafeInteger(changes) && changes > 0 ? changes : 0;
}

export async function executeSyncBatch(db, batch) {
  const { entries, expected } = batch;
  const failed = [...batch.failed];
  const acknowledged = [];
  let written = 0;
  if (entries.length) {
    // Interleave each write and exact replay check in ONE atomic D1 batch. Verification
    // uses the frozen normalized bind values; it never re-runs a timestamp-producing mapper.
    const statements = entries.flatMap((entry) => [
      entry.statement,
      db.prepare(entry.verificationSql).bind(...entry.values),
    ]);
    let results;
    try {
      results = await db.batch(statements);
    } catch (err) {
      clientError(err, 500);
    }
    const aligned = Array.isArray(results) && results.length === statements.length;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const write = aligned ? results[i * 2] : null;
      const verification = aligned ? results[i * 2 + 1] : null;
      const changes = reliableChanges(write);
      const matches = verification?.success === true && Array.isArray(verification.results) &&
        verification.results.length === 1 && verification.results[0].verified_id === entry.id;
      // Missing/failed write results never become acknowledgements, even if a SELECT matches.
      // rows_written counts physical work, not accepted logical changes, and is not evidence.
      if (write?.success === true && (changes > 0 || matches)) {
        acknowledged.push(entry.id);
        written += changes;
      } else {
        failed.push({ id: entry.id, error: write?.success === true
          ? 'Stored state does not match submitted record'
          : 'Write result unavailable or failed; retry required' });
      }
    }
  }
  return { success: true, acknowledged, failed, written, expected, skipped: expected - acknowledged.length };
}
