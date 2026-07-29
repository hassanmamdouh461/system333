# fix(#4): session tokens are server-issued JWTs with expiry checks

- authToken is now the signed JWT returned by /auth/login (HS256, 12h expiry)
  instead of a meaningless client-generated `local-<uuid>` string
- Session restore on page load validates the token exp claim — stale or
  token-less blobs in localStorage are discarded instead of being trusted
- Manager cloud endpoints (/manager/*, /telegram/send) require the bearer
  token and the worker enforces role=manager server-side, so privileged data
  is no longer reachable with a forged localStorage session
- cloudFetch({auth:true}) attaches the session token to manager requests

Code for this fix lives in `src/context/AuthContext.tsx` (token validation,
login flow) and `src/services/cloudClient.ts` (bearer attachment) — committed
with fix(#2) since they touch the same files; this note keeps the audit trail
for issue #4 explicit.
