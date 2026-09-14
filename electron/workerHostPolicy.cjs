/**
 * Which hosts the main process is willing to send the worker credential to.
 *
 * The worker URL is a renderer-writable setting, and a packaged install ships no .env, so
 * whatever URL the renderer last saved is what this process would dial — with the real API
 * key in the X-API-Key header. Making the key unreadable to the renderer only stops it being
 * shown; it still has to be sent. An allowlist is what stops it being sent to the wrong
 * host.
 *
 * This module is deliberately pure: no database, no network, no Electron. It is the one part
 * of the credential path that can be tested directly.
 */

/**
 * Where the POS worker actually lives.
 *
 * api.engaz.tech is the natural name but is already serving another service, so the worker
 * answers on its canonical Cloudflare-provided URL until that cutover is decided. Both are
 * allowed here: moving the worker is then a config change plus a settings update, not a
 * rebuild, and neither hostname is a surprise to this allowlist.
 */
const DEFAULT_WORKER_URL = 'https://engaz-d1-proxy.hassanmamdouh461.workers.dev';
const POS_HOSTS = [DEFAULT_WORKER_URL, 'https://api.engaz.tech'];

/** The isolated reports worker this process mirrors to. */
const REPORTS_WORKER_URL = 'https://api-reports.engaz.tech';

/** Local origins, permitted only when the app is explicitly started in dev mode. */
const DEV_HOSTS = ['localhost', '127.0.0.1'];

/**
 * The hosts this process will attach the API key to.
 *
 * `ENGAZ_ALLOWED_WORKER_HOSTS` is the escape hatch for a deployment that genuinely runs its
 * worker somewhere else — the same shape as the existing ENGAZ_DNS_SERVERS override, so an
 * operator who needs it is not stuck waiting for a build.
 */
function allowedWorkerHosts(env = process.env) {
  const configured = String(env.ENGAZ_ALLOWED_WORKER_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  // Dev origins are opt-in rather than inferred, so a packaged build never carries them.
  const dev = String(env.ENGAZ_DEV || '') === '1' ? DEV_HOSTS : [];

  return new Set([
    ...POS_HOSTS.map((url) => new URL(url).hostname),
    new URL(REPORTS_WORKER_URL).hostname,
    ...dev,
    ...configured,
  ]);
}

/**
 * Checks a worker URL before a credential is attached to a request for it.
 *
 * Returns the parsed URL, or throws with a message worth putting in the log: an operator has
 * to be able to tell "misconfigured" from "attacked".
 */
function assertWorkerHostAllowed(url, env = process.env) {
  // Accepts a string or an already-parsed URL: callers that need the parsed form anyway can
  // hand it over rather than parsing twice and disagreeing about the result.
  let parsed;
  if (url instanceof URL) {
    parsed = url;
  } else {
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid worker URL: ${url}`);
    }
  }

  const host = parsed.hostname.toLowerCase();
  const isDevLocal = String(env.ENGAZ_DEV || '') === '1' && DEV_HOSTS.includes(host);

  // https everywhere except an explicitly dev-mode local worker: a key sent in cleartext is
  // readable by anyone on the path, whatever the host is called.
  if (parsed.protocol !== 'https:' && !isDevLocal) {
    throw new Error(
      `Refusing to send the worker credential to ${parsed.protocol}//${host}; the worker URL must be https`
    );
  }

  if (!allowedWorkerHosts(env).has(host)) {
    throw new Error(
      `Refusing to send the worker credential to ${host}; add it to ENGAZ_ALLOWED_WORKER_HOSTS if this host is intended`
    );
  }

  return parsed;
}

module.exports = {
  DEFAULT_WORKER_URL,
  REPORTS_WORKER_URL,
  POS_HOSTS,
  DEV_HOSTS,
  allowedWorkerHosts,
  assertWorkerHostAllowed,
};
