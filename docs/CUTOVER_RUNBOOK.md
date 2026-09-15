# POS worker cutover runbook — `*.workers.dev` → `api-pos.engaz.tech`

Why: the worker is published on its Cloudflare-provided `*.workers.dev` URL, which anyone on the
internet can reach by name and which sits **outside** every Access policy, WAF rule and rate limit
scoped to `engaz.tech`. It holds every order, customer, stock level and loyalty balance. The
reports worker already has `workers_dev = false` for exactly this reason.

This is the procedure for moving to the dedicated hostname **without** an outage.

---

## The rule that makes this safe

**Deploy and verify the new destination before moving any device onto it.**

An earlier version of `wrangler.toml` said the opposite — repoint devices first, then deploy. That is an
outage: the new hostname does not resolve until the route exists, so every device moved first would go
offline simultaneously and stay offline until the deploy landed.

While both hostnames are live they serve the **same D1 database**, so there is no data divergence
window. That is what makes a phased migration possible, and it is why rollback is a per-device setting
change rather than a redeploy.

---

## Preflight (do not skip)

1. **Back up the database.** Every step below is reversible except a mistake here.

   ```bash
   npx wrangler d1 export engaz-pos-db --remote --output backups/engaz-pos-$(date +%F).sql
   ```

2. **Inventory the devices.** For each till, record the installed build date and its current worker URL
   (Settings → worker URL in the app, or `engaz_d1_worker_url` in its local database).

3. **Classify each device.** A device can only be moved if its binary was built with the current
   `electron/workerHostPolicy.cjs` allowlist. Check for the host in the installed bundle:

   ```bash
   grep -rl "api-pos.engaz.tech" "<install-dir>/resources/app.asar.unpacked/electron/" 2>/dev/null
   ```

   - **Found** → the device can be repointed in place.
   - **Not found** → this install refuses the new host. **It needs a rebuild before it can be moved.**
     The claim that "no desktop rebuild is needed" is only true for binaries that already carry the
     allowlist.

---

## Procedure

### 1. Create the DNS record

```bash
npx wrangler deploy -c wrangler.toml --dry-run --outdir /tmp/pos-build   # sanity check only
```

Create `api-pos.engaz.tech` as a **proxied** (orange-cloud) CNAME in the `engaz.tech` zone. Keep the
record if it already exists.

Do **not** touch `api.engaz.tech` — it is serving a different service. Claiming its route would take
that service down.

### 2. Deploy

```bash
npx wrangler deploy -c wrangler.toml
```

Both hostnames now answer. Nothing has changed for any device yet.

### 3. Verify the new host before trusting it

```bash
# Liveness
curl -sS -o /dev/null -w '%{http_code}\n' https://api-pos.engaz.tech/health     # expect 200

# Authorised read — proves the route, the binding and the key all work together.
curl -sS -X POST https://api-pos.engaz.tech/read/manager-snapshot \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $WORKER_API_KEY" \
  -d '{}' | head -c 400
```

**Do not proceed until both return correctly.** If `/health` is 200 but the read is 401, the route is
live but the secret is wrong on the new deployment — fix that before moving anything.

Then prove a **write** from one non-critical device: change its worker URL, save an order, and confirm
the row appears in the portal. A read that works while a write silently fails is the failure mode this
whole exercise exists to prevent.

### 4. Move devices in batches

Batch size: 1, then 5, then the rest. After each batch:

- the device reports **synced**, not `error`;
- `pendingCount` falls to zero;
- new orders appear in the manager portal.

Move a device by setting Settings → worker URL to `https://api-pos.engaz.tech`. The client releases
rows parked against the previous worker automatically when the URL changes, so a device that was
falling behind gets its retry budget back.

### 5. Retire the old hostname — only when every device is migrated

1. Remove `LEGACY_WORKERS_DEV_URL` from `POS_HOSTS` in `electron/workerHostPolicy.cjs` and ship that
   build.
2. Delete the old worker (or set `workers_dev = false` on it, which this config already does).

**A device still pointing at the old URL after this step stops syncing entirely.** The host allowlist
cannot rescue it, because the hostname itself ceases to exist. Confirm zero devices remain before you
do this.

---

## Reports worker: one-step migration is required

The reports database named the loyalty balance column `balance` while the POS database and the desktop
call it `balanceAfter`. The mirror now writes the same value under **both** names so a reader written
against either schema sees the same number.

That means the reports worker's `points_transactions` write names a column that does not exist until the
migration has run:

```bash
curl -sS -X POST https://api-reports.engaz.tech/migrate \
  -H "X-API-Key: $REPORTS_API_KEY" -d '{}'
```

**Run this as part of deploying the reports worker.** Until it runs, loyalty-ledger mirrors fail — they
are **not** lost: the desktop keeps them in its outbox and flushes them once the column exists. Expect
`failedCount: 0` in the response; the `balanceAfter` step is idempotent, and existing rows are covered
because the mirror replays from the outbox rather than relying on a backfill.

## Rollback

Per device: set the worker URL back to the old `*.workers.dev` value. No redeploy needed.

If the *new* host is broken for everyone, it is still just a setting change — the old hostname is
answering throughout step 4, which is the entire reason for the phased order.

---

## Related: enabling per-branch keys

Until `api_keys` has rows, one shared key reads and writes every branch. To enable scoping:

1. Run `/migrate` on the POS worker (admin credential) so `api_keys` exists.
2. Insert one row per branch. The worker compares a **SHA-256 hash**, never the key itself:

   ```bash
   # value to insert is the hex SHA-256 of the key you give that branch
   printf '%s' 'the-branch-key' | sha256sum
   ```

   ```sql
   INSERT INTO api_keys (key_hash, branch_id, label, created_at)
   VALUES ('<hex-digest>', 'branch-1', 'Branch 1 till', '<iso-timestamp>');
   ```

3. Put the plain key in that device's `engaz_d1_worker_api_key` setting.

Revoking is `UPDATE api_keys SET revoked_at = <iso> WHERE branch_id = ?` — no redeploy, no rotation of
anyone else's key.

**Verified behaviour of the key registry** (read from `resolveKeyBranch` in
`cloudflare/d1-proxy-worker.js`):

- A key whose row exists and has `revoked_at` set is **rejected outright** (HTTP 401). It does not fall
  back to the shared key.
- A key with **no row at all** is still accepted via the shared-key path *unless* `REQUIRE_BRANCH_KEYS`
  is set to `"true"`. That default is what keeps un-migrated devices working. **Set
  `REQUIRE_BRANCH_KEYS=true` once every branch has a row**, so an unknown key stops being honoured.
- A database error other than "table missing during `/migrate`" returns 503 rather than being treated as
  a successful lookup.
