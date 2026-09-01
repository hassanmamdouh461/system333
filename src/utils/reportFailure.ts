/**
 * Reporting a failed action to the user.
 *
 * The backend now rejects invalid input with a message naming the field, and refuses
 * operations it cannot honour — redeeming more points than a customer has, adjusting a
 * stock item that no longer exists. Those messages are the useful part: a bare "Failed to
 * save" tells the cashier nothing they can act on.
 *
 * This keeps one place that decides how much of an error to show, so the choice does not
 * drift between screens.
 */

/** Message from an error, or empty when there is nothing worth showing. */
export function failureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    // An IPC rejection arrives wrapped by Electron; strip the wrapper so the cashier sees
    // the cause rather than the transport.
    return error.message.replace(/^Error invoking remote method '[^']*':\s*/, '').trim();
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '';
}

/**
 * Shows why an action failed, appending the cause when there is one.
 *
 * `summary` should already be translated; it names what was being attempted.
 */
export function reportFailure(summary: string, error: unknown, log = true): void {
  const reason = failureReason(error);
  if (log) console.error(`[ui] ${summary}:`, error);
  alert(reason ? `${summary}: ${reason}` : summary);
}
