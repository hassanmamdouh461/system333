const { BrowserWindow } = require('electron');

const MAX_HTML_CHARS = 2_000_000;

/** How long the receipt may take to render. */
const RENDER_TIMEOUT_MS = 30_000;
/**
 * How long the operator may take with the print dialog.
 *
 * One 30-second guard used to cover both phases, so anyone who had to find the right printer,
 * clear a jam, or answer the driver's own prompt had the job destroyed mid-dialog and the
 * receipt lost — with no error the cashier could act on. The load phase stays tightly bounded;
 * the wait on a human is not.
 */
const PRINT_DIALOG_TIMEOUT_MS = 5 * 60_000;

/**
 * Renders receipt HTML in an isolated, sandboxed, invisible window and triggers printing.
 *
 * Security guarantees:
 * - nodeIntegration: false, contextIsolation: true, sandbox: true
 * - javascript: false (no scripts execute in print window)
 * - strict Content-Security-Policy (no network, only data: images allowed)
 * - all navigation and window-open requests are blocked
 * - window destroyed upon print completion, cancel, or timeout
 */
function printReceiptHtml(html) {
  return new Promise((resolve, reject) => {
    if (typeof html !== 'string' || !html.trim()) {
      return reject(new Error('Invalid HTML content for printing'));
    }
    if (html.length > MAX_HTML_CHARS) {
      return reject(new Error(`Print HTML content exceeds maximum allowed size (${MAX_HTML_CHARS} chars)`));
    }

    let printWindow = null;
    let finished = false;
    let timeoutId = null;

    const cleanup = () => {
      // Without this the 30s guard below stays armed for every receipt ever printed,
      // keeping a timer and a window reference alive long after the job finished.
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (printWindow && !printWindow.isDestroyed()) {
        try {
          printWindow.destroy();
        } catch {
          // ignore
        }
        printWindow = null;
      }
    };

    try {
      printWindow = new BrowserWindow({
        show: false,
        width: 400,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          javascript: false,
        },
      });
    } catch (err) {
      return reject(err);
    }

    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault());

    // Inject strict CSP
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">`;
    let safeHtml = html;
    if (safeHtml.includes('<head>')) {
      safeHtml = safeHtml.replace('<head>', `<head>${cspMeta}`);
    } else {
      safeHtml = `${cspMeta}${safeHtml}`;
    }

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`;

    printWindow.webContents.once('did-finish-load', () => {
      // In automated tests or CI environments, do not reach out to physical printers
      if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.CI) {
        cleanup();
        finished = true;
        return resolve();
      }

      // The dialog is up: from here the delay is the operator's, not the app's.
      armTimeout(PRINT_DIALOG_TIMEOUT_MS);

      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true,
        },
        (success, failureReason) => {
          cleanup();
          finished = true;
          if (success) {
            resolve();
          } else {
            // Cancelling the dialog is a normal outcome, not a failure. Electron reports it
            // as "Print job canceled" — one 'l', American spelling — which the two literals
            // this used to compare against never matched, so every cancelled receipt came
            // back as a rejected promise and surfaced as an error on the till.
            const reason = String(failureReason || '').toLowerCase();
            if (reason.includes('cancel')) {
              resolve();
            } else {
              reject(new Error(failureReason || 'Printing failed'));
            }
          }
        }
      );
    });

    printWindow.webContents.once('did-fail-load', (_, errorCode, errorDescription) => {
      cleanup();
      finished = true;
      reject(new Error(`Failed to load receipt HTML: ${errorDescription} (${errorCode})`));
    });

    // Re-armable guard: the same deadline cannot sensibly cover rendering the receipt and
    // waiting on a person at a printer dialog.
    const armTimeout = (ms) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!finished) {
          cleanup();
          reject(new Error('Print operation timed out'));
        }
      }, ms);
    };

    armTimeout(RENDER_TIMEOUT_MS);

    printWindow.loadURL(dataUrl).catch((err) => {
      cleanup();
      finished = true;
      reject(err);
    });
  });
}

module.exports = { printReceiptHtml, MAX_HTML_CHARS };
