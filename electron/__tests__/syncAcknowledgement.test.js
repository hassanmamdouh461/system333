import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// This module is loaded by the Electron main process as CommonJS, so it is required here the
// same way it is required in production rather than imported as ESM.
const require = createRequire(import.meta.url);
const { reconcileAcknowledgements } = require('../syncAcknowledgement.cjs');

describe('reconcileAcknowledgements', () => {
  // This function is the whole reason a till can be trusted when it says "synced". It takes
  // the worker's answer and decides which local rows may stop being retried — and a row that
  // stops being retried is never looked at again. Every case below is a way the old code
  // got that wrong.
  const records = [{ id: 'a' }, { id: 'b' }];

  it('accepts only the records the worker named', () => {
    const { accepted, failed } = reconcileAcknowledgements(records, {
      success: true,
      acknowledged: ['a'],
      failed: [],
    });

    expect(accepted).toEqual(['a']);
    expect(failed).toEqual([{ id: 'b', error: expect.stringMatching(/did not acknowledge/i) }]);
  });

  it('does not treat HTTP success as a receipt', () => {
    // The old client marked everything synced whenever the request did not throw. A 200 that
    // says nothing about individual records must not mark anything.
    const { accepted, failed } = reconcileAcknowledgements(records, { success: true, written: 2 });

    expect(accepted).toEqual([]);
    expect(failed).toHaveLength(2);
    expect(failed[0].error).toMatch(/acknowledgement contract/i);
  });

  it('refuses everything when the response is missing entirely', () => {
    const { accepted, failed } = reconcileAcknowledgements(records, null);
    expect(accepted).toEqual([]);
    expect(failed).toHaveLength(2);
  });

  it('holds back a record the worker rejected, with its reason', () => {
    const { accepted, failed } = reconcileAcknowledgements(records, {
      success: true,
      acknowledged: ['a'],
      failed: [{ id: 'b', error: 'branchId must be at most 40 characters' }],
    });

    expect(accepted).toEqual(['a']);
    expect(failed).toEqual([{ id: 'b', error: 'branchId must be at most 40 characters' }]);
  });

  it('will not accept a record that is both acknowledged and named as failed', () => {
    // Contradictory answers happen when a batch is partially applied. Ambiguity resolves
    // towards retrying: re-sending a stored record is harmless, losing one is not.
    const { accepted, failed } = reconcileAcknowledgements(records, {
      success: true,
      acknowledged: ['a', 'b'],
      failed: [{ id: 'b', error: 'stored state mismatch' }],
    });

    expect(accepted).toEqual(['a']);
    expect(failed.map((f) => f.id)).toEqual(['b']);
  });

  it('ignores an acknowledgement for a record it never sent', () => {
    // A server cannot invent a record into existence; only the submitted ids are eligible.
    const { accepted } = reconcileAcknowledgements(records, {
      success: true,
      acknowledged: ['a', 'from-someone-else'],
      failed: [],
    });

    expect(accepted).toEqual(['a']);
  });

  it('treats a duplicate submitted id as a failure rather than guessing', () => {
    // Two records sharing an id means the caller's batch is malformed and the counts it
    // receives cannot be mapped back to rows safely. Refuse both rather than pick one.
    const { accepted, failed } = reconcileAcknowledgements(
      [{ id: 'a' }, { id: 'a' }],
      { success: true, acknowledged: ['a'], failed: [] }
    );

    expect(accepted).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toMatch(/duplicate/i);
  });

  it('handles an empty submission without claiming anything', () => {
    expect(reconcileAcknowledgements([], { success: true, acknowledged: [], failed: [] }))
      .toEqual({ accepted: [], failed: [] });
  });
});
