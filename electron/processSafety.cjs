'use strict';

/**
 * What the main process does when it can no longer reason about its own state.
 *
 * The previous handler logged an uncaught exception and carried on, on the reasoning that a
 * till must keep serving a queue. That reasoning is backwards for a system that takes money:
 * an *unknown* exception means the process has reached a state nobody has analysed. The
 * failure is not necessarily in the background task that threw — it may be in the database
 * layer, the sync engine, or a half-applied write. Continuing means orders, stock and
 * loyalty points keep being processed on top of that unknown state, and the only visible
 * symptom is a number that quietly stops matching the cloud.
 *
 * So a fatal error stops the work deliberately instead of hoping:
 *   • the failure is logged with its stack, because an operator needs the record;
 *   • the sync loop is stopped, so no further writes are attempted from a broken process;
 *   • the operator is told, rather than being left with a frozen-looking till;
 *   • the process exits non-zero, so whatever supervises it can restart into a known state.
 *
 * Recoverable failures never reach here: they are handled at their own call site. Anything
 * that arrives at this handler is by definition unhandled.
 */

function defaultStop() {}

function reportFatal(error, deps = {}) {
  const {
    log = (...args) => console.error(...args),
    stopSync = defaultStop,
    notify = null,
    exit = (code) => process.exit(code),
  } = deps;

  const detail = error instanceof Error ? (error.stack || error.message) : String(error);

  log('[main] Fatal error: shutting down rather than continuing with unknown state.');
  log('[main]', detail);

  try {
    stopSync();
  } catch (stopError) {
    // Stopping cleanly is best-effort: a failure here must not mask the original fault.
    log('[main] Could not stop the sync engine during shutdown:', stopError && stopError.message);
  }

  if (typeof notify === 'function') {
    try {
      notify(detail);
    } catch (notifyError) {
      log('[main] Could not show the fatal error dialog:', notifyError && notifyError.message);
    }
  }

  exit(1);
}

/**
 * Installs the handlers. Returns a disposer so a test can remove them again.
 *
 * Each handler runs once: a shutdown path that itself throws must not re-enter here and
 * recurse, and the second error carries no more information than the first.
 */
function installFatalHandlers(deps = {}) {
  const handlers = new Map();
  const once = (kind) => {
    const handler = (error) => {
      process.removeListener(kind, handler);
      reportFatal(kind === 'uncaughtException' ? error : (error instanceof Error ? error : new Error(String(error))), deps);
    };
    handlers.set(kind, handler);
    process.on(kind, handler);
  };

  once('uncaughtException');
  once('unhandledRejection');

  return () => {
    for (const [kind, handler] of handlers) process.removeListener(kind, handler);
  };
}

module.exports = { reportFatal, installFatalHandlers };
