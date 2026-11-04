## The flaw

The server fetches any link it is given (CWE-918). It only refuses host names that match a short denylist exactly, and a few address patterns. The real question is where the request goes once the name is resolved, and the filter never asks it.

## Solving it

1. Preview `http://metadata:8080/`. It's blocked.
2. Try other spellings. `METADATA` is lowercased first, and numeric forms of private addresses are normalized and caught.
3. Add a trailing dot: `http://metadata.:8080/`. To DNS this is the same, fully qualified name, but it isn't the string in the denylist. The preview shows `latest/`.
4. Walk the tree: `/latest/meta-data/`, then `iam/`, then `security-credentials/`, which lists `preview-fetcher`.
5. Preview `http://metadata.:8080/latest/meta-data/iam/security-credentials/preview-fetcher`. The `SecretKey` field holds the flag.

## The fix

Allow only the destinations the feature needs, and check the resolved address of every request, including after redirects, against blocked ranges. Better still, send outbound fetches through an egress proxy that can't reach internal networks. Protect metadata services with a session token that must be requested with a special method and header, as modern cloud metadata services do, so a simple forwarded GET can't read credentials. Give the service only the credentials it needs.
