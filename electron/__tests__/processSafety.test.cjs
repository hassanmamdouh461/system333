'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { reportFatal, installFatalHandlers } = require('../processSafety.cjs');

/** A minimal stand-in for the pieces a real shutdown touches. */
function harness() {
  const calls = { logs: [], stopped: 0, notified: [], exits: [] };
  return {
    calls,
    deps: {
      log: (...args) => calls.logs.push(args.join(' ')),
      stopSync: () => { calls.stopped += 1; },
      notify: (detail) => calls.notified.push(detail),
      exit: (code) => calls.exits.push(code),
    },
  };
}

test('fatal error stops syncing, notifies the operator and exits non-zero', () => {
  const { calls, deps } = harness();
  reportFatal(new Error('boom'), deps);

  assert.equal(calls.stopped, 1, 'the sync loop must stop before anything else is attempted');
  assert.equal(calls.notified.length, 1, 'the operator must be told, not left with a silent till');
  assert.deepEqual(calls.exits, [1], 'a non-zero exit is what lets a supervisor restart it');
  assert.ok(
    calls.logs.join('\n').includes('boom'),
    'the failure has to be in the log with enough detail to diagnose it'
  );
});

test('it does not swallow the error the way the old handler did', () => {
  // The previous behaviour was "log and continue". If this ever regresses, the only symptom
  // in the field is a till that keeps taking orders in an unknown state, so assert on the
  // outcome rather than on the log line.
  const { calls, deps } = harness();
  reportFatal(new Error('db is closed'), deps);

  assert.equal(calls.exits.length, 1);
  assert.notEqual(calls.exits[0], 0);
});

test('a stop or notify failure cannot mask the original fault', () => {
  const { calls, deps } = harness();
  reportFatal(new Error('original'), {
    ...deps,
    stopSync: () => { throw new Error('stop failed'); },
    notify: () => { throw new Error('dialog failed'); },
  });

  assert.deepEqual(calls.exits, [1], 'shutdown still completes');
  assert.ok(calls.logs.join('\n').includes('original'), 'the original error is still logged');
});

test('a non-Error rejection is still reported and still exits', () => {
  const { calls, deps } = harness();
  reportFatal('just a string', deps);

  assert.equal(calls.notified.length, 1);
  assert.deepEqual(calls.exits, [1]);
});

test('installFatalHandlers wires both process events and can be removed again', () => {
  // Measured as a delta: the test runner installs a listener of its own, so an absolute
  // count would assert on the harness rather than on this code.
  const beforeUncaught = process.listenerCount('uncaughtException');
  const beforeRejection = process.listenerCount('unhandledRejection');
  const dispose = installFatalHandlers(harness().deps);

  assert.equal(process.listenerCount('uncaughtException'), beforeUncaught + 1);
  assert.equal(process.listenerCount('unhandledRejection'), beforeRejection + 1);

  dispose();
  assert.equal(process.listenerCount('uncaughtException'), beforeUncaught);
  assert.equal(process.listenerCount('unhandledRejection'), beforeRejection);
});

test('the installed handler detaches before it runs, so a throwing shutdown cannot recurse', () => {
  const { calls, deps } = harness();
  const dispose = installFatalHandlers({
    ...deps,
    // Re-entering the handler would push a second exit code; one entry proves it ran once.
    exit: (code) => { calls.exits.push(code); throw new Error('exit threw'); },
  });

  // Invoked directly rather than through process.emit, which would let Node's own default
  // handling rethrow the error and fail the test for the wrong reason.
  const handler = process.listeners('uncaughtException').at(-1);

  assert.throws(() => handler(new Error('first')), /exit threw/);
  assert.deepEqual(calls.exits, [1], 'the exit path ran exactly once');

  // A second delivery after detachment must not run it again.
  assert.equal(process.listeners('uncaughtException').includes(handler), false);
  dispose();
});
