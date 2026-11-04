## The flaw

A deploy credential was restored into `/var/backups/deploy.env` with mode `0644`,
so every user on the box can read it (CWE-552, unsecured credentials). The vault
treats the token as proof of identity, so reading the file is enough to act as the
deploy pipeline. No privilege escalation is needed.

## Solving it

1. Enumerate for readable secrets:

   ```
   grep -R VAULT /etc /var /opt /srv 2>/dev/null
   ls -l /var/backups
   ```

2. `/var/backups/deploy.env` is world-readable and holds `VAULT_URL` and
   `VAULT_TOKEN`.
3. Present the token to the vault:

   ```
   python3 -c "import urllib.request as u; print(u.urlopen(u.Request('http://vault:8080/', headers={'X-Vault-Token': '<token>'})).read().decode())"
   ```

   The vault returns the flag.

## The fix

Keep secrets out of world-readable files: restrict permissions to the owning
service account (`0640` or tighter with a dedicated group), and keep them out of
backups that are readable by everyone. Use a secret manager that issues
short-lived, scoped tokens instead of a single static deploy token, and rotate on
exposure. A leaked credential should grant as little as possible.
