# Shared shell-lab runtime

Helpers baked into shell-lab images (pwn, Linux). Not a backend dependency.

- `load-flag.sh` — one-shot worker flag delivery into `/tmp/flag.txt`.
- `healthcheck.sh <port>` — target is healthy once the flag is delivered and the port accepts a connection.
- `ttyd-health.sh` — workstation is healthy once ttyd listens on 7681.
- `motd` — login banner for the workstation.
- `ttyd.x86_64` — vendored [ttyd](https://github.com/tsl0922/ttyd) 1.7.7 static release binary (not packaged in Debian).
  - `sha256: 8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55`
  - Verified against the upstream `SHA256SUMS` at download time.
