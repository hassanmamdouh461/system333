const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WORKER_URL,
  POS_WORKER_URL,
  LEGACY_WORKERS_DEV_URL,
  REPORTS_WORKER_URL,
  allowedWorkerHosts,
  assertWorkerHostAllowed,
} = require('../workerHostPolicy.cjs');

/**
 * The worker URL is a renderer-writable setting and a packaged install ships no .env, so
 * whatever the renderer last saved is the host this process would dial with the real API key
 * attached. These tests are the reason that dial is refused unless the host is expected.
 */

const PRODUCTION = {};

test('permits the hosts the app is built to talk to', () => {
  for (const url of [DEFAULT_WORKER_URL, POS_WORKER_URL, LEGACY_WORKERS_DEV_URL, REPORTS_WORKER_URL]) {
    const parsed = assertWorkerHostAllowed(url, PRODUCTION);
    assert.equal(parsed.origin, new URL(url).origin);
  }
});

test('defaults a device with no saved setting to the dedicated hostname', () => {
  // The workers.dev URL has to stay allowed while devices migrate one at a time, but nothing
  // may default to it: a fresh install would pick the host that carries no Access, WAF or
  // rate-limit rules.
  assert.equal(new URL(DEFAULT_WORKER_URL).hostname, 'api-pos.engaz.tech');
});

test('refuses to send the credential to a host the renderer chose', () => {
  // This is the whole finding: the setting is writable from the renderer, and the key is
  // attached by the main process, so an unvalidated URL is a credential exfiltration path.
  assert.throws(
    () => assertWorkerHostAllowed('https://evil.example.com', PRODUCTION),
    /Refusing to send the worker credential to evil\.example\.com/
  );
});

test('names the override in the error, so a real deployment is not stuck', () => {
  // A shop that genuinely runs its own worker has to be able to unblock itself without a
  // rebuild, and has to be told how.
  assert.throws(
    () => assertWorkerHostAllowed('https://pos.internal.example', PRODUCTION),
    /ENGAZ_ALLOWED_WORKER_HOSTS/
  );
});

test('honours the override when an operator sets it', () => {
  const env = { ENGAZ_ALLOWED_WORKER_HOSTS: 'pos.internal.example, other.example ' };
  assert.deepEqual(
    [...allowedWorkerHosts(env)].sort(),
    [
      'api-pos.engaz.tech',
      'api-reports.engaz.tech',
      'api.engaz.tech',
      'engaz-d1-proxy.hassanmamdouh461.workers.dev',
      'other.example',
      'pos.internal.example',
    ]
  );
  assert.equal(assertWorkerHostAllowed('https://pos.internal.example', env).hostname, 'pos.internal.example');
});

test('accepts the dedicated hostname the POS worker moved to', () => {
  assert.equal(assertWorkerHostAllowed(POS_WORKER_URL, PRODUCTION).hostname, 'api-pos.engaz.tech');
});

test('accepts the old workers.dev URL so un-migrated devices keep syncing', () => {
  // Removing this host before every device has been repointed would cut those devices off
  // mid-migration. It is a migration window, not a permanent entry.
  assert.equal(
    assertWorkerHostAllowed('https://engaz-d1-proxy.hassanmamdouh461.workers.dev', PRODUCTION).hostname,
    'engaz-d1-proxy.hassanmamdouh461.workers.dev'
  );
});

test('still accepts api.engaz.tech, so the cutover needs no rebuild', () => {
  assert.equal(assertWorkerHostAllowed('https://api.engaz.tech', PRODUCTION).hostname, 'api.engaz.tech');
});

test('refuses cleartext, because a key in a plain request is readable on the path', () => {
  // Even a host on the allowlist must not be dialled over http.
  assert.throws(
    () => assertWorkerHostAllowed('http://api.engaz.tech', {}),
    /must be https/
  );
});

test('matches hosts case-insensitively, since DNS is', () => {
  // URL parsing already lowercases the host, so the comparison is against the normalised
  // form rather than whatever case the caller wrote.
  assert.equal(assertWorkerHostAllowed('https://API.engaz.tech', PRODUCTION).hostname, 'api.engaz.tech');
});

test('keeps localhost out unless the app is explicitly started in dev mode', () => {
  // A packaged build must never carry dev origins: inferring them from anywhere else would
  // let the renderer point the key at a service on the user's own machine.
  assert.throws(
    () => assertWorkerHostAllowed('http://127.0.0.1:8787', PRODUCTION),
    /Refusing to send the worker credential/
  );
  assert.equal(
    assertWorkerHostAllowed('http://127.0.0.1:8787', { ENGAZ_DEV: '1' }).hostname,
    '127.0.0.1'
  );
});

test('reports an unparseable URL rather than throwing a TypeError', () => {
  assert.throws(() => assertWorkerHostAllowed('not-a-url', PRODUCTION), /Invalid worker URL/);
});

test('does not leak an override that was never set into the allowlist', () => {
  const hosts = [...allowedWorkerHosts({})].sort();
  assert.deepEqual(hosts, [
    'api-pos.engaz.tech',
    'api-reports.engaz.tech',
    'api.engaz.tech',
    'engaz-d1-proxy.hassanmamdouh461.workers.dev',
  ]);
});
