World Readable
==============

You have a shell on a staging workstation. An internal deploy vault runs on the
host "vault", port 8080, and only returns its secret to a caller that presents
the right deploy token.

You don't have that token... but someone left a credential lying around where it
should never have been. Enumerate the box for configuration and backup files that
are readable by everyone, find the deploy token, and use it to read the vault.

Tools: python3, nc, grep, find, less. The lab has no internet access.
Try: grep -R VAULT /etc /var /opt /srv 2>/dev/null
