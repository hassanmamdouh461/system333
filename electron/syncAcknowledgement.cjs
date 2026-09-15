'use strict';

/** Positive per-record proof only. Aggregate counts and HTTP 200 are not receipts. */
function reconcileAcknowledgements(records, result) {
  const counts = new Map();
  for (const row of records || []) {
    const id = row && String(row.id || '');
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const protocolValid = result?.success === true && Array.isArray(result.acknowledged);
  const acknowledged = new Set(protocolValid
    ? result.acknowledged.filter(id => typeof id === 'string' && counts.has(id)) : []);
  const rejected = new Map();
  for (const entry of Array.isArray(result?.failed) ? result.failed : []) {
    if (entry && counts.has(String(entry.id))) {
      rejected.set(String(entry.id), String(entry.error || 'Record rejected').slice(0, 500));
    }
  }
  const accepted = [];
  const failed = [];
  for (const [id, count] of counts) {
    if (count === 1 && protocolValid && acknowledged.has(id) && !rejected.has(id)) {
      accepted.push(id);
    } else {
      failed.push({ id, error: count > 1 ? 'Duplicate submitted ID' : rejected.get(id)
        || (protocolValid ? 'Worker did not acknowledge this record'
          : 'Worker response lacks a valid per-record acknowledgement contract') });
    }
  }
  return { accepted, failed };
}

module.exports = { reconcileAcknowledgements };
