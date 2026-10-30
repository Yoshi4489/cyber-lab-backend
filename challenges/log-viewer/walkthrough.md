## The flaw

The `file` parameter is joined onto the logs directory with no check on where the result ends up, which is path traversal (CWE-22).

## Solving it

1. Open `app.log`. One line says settings were loaded from `../config/backup.conf`.
2. Request that path through the viewer: `view?file=../config/backup.conf`.
3. The file holds the backup passphrase, which is the flag.

## The fix

Avoid taking file paths from users at all. An allowlist that maps `app` and `access` to known files is best. If a path is needed, resolve it fully and check that the result is still inside the allowed directory. Also run the service with no read access to secrets it doesn't need.
