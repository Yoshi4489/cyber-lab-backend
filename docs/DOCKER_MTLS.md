# Remote Docker mTLS

The worker is the only component allowed to hold Docker Engine credentials. In
the production layout it runs in the control-plane trust zone and drives a
Docker Engine on a separate target host over mutual TLS. This document is the
procedure for issuing that certificate set and configuring both ends.

Mutual TLS here means both sides authenticate: the worker verifies the Engine's
server certificate, and the Engine refuses any client that cannot present a
certificate signed by the same certificate authority. Exposing Docker on a TCP
port without `tlsverify` is equivalent to handing out root on the target host.

## Trust model

| Material | Control plane | Target host | Notes |
|---|---|---|---|
| CA certificate (`ca.pem`) | yes | yes | Public. Both ends verify against it. |
| CA private key (`ca-key.pem`) | yes | **never** | Signs every certificate. Compromise means forged clients. |
| Server certificate and key | no | yes | Identifies the Engine. |
| Client certificate and key | yes | no | Identifies the worker. |

Delivery is one way: the control plane dials the target host. The target host
holds no control-plane credential, gets no inbound management route, and cannot
initiate a connection back. A container escape on the target lands on a machine
whose only secrets authenticate it as a target.

Keep every key outside the repository. The repository ignores common TLS
extensions as a backstop, but that is a safety net, not the intended location.

## Addresses

Substitute your own throughout. The planned validation topology is two VirtualBox
guests on a host-only network:

| Role | Host | Address |
|---|---|---|
| Control plane: worker, API, PostgreSQL, Redis | NongBuntu2 | `192.168.56.107` |
| Target host: Docker Engine, Traefik, targets | NongBuntu | `192.168.56.106` |

The target host address is the one the worker dials, so it is the address that
must appear in the server certificate's subject alternative name.

## 1. Issue the certificates

For this disposable two-VM validation, run on the **control plane**, so the CA
private key is created there and never reaches the target. This is not the
production key-custody arrangement: issue production certificates from an
offline signing environment and keep its CA private key off the running
control plane as well.

```sh
mkdir -p ~/cyber-range-certs && cd ~/cyber-range-certs
umask 077

# Certificate authority
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 825 -sha256 -key ca-key.pem -out ca.pem \
  -subj "/CN=cyber-range-ca"

# Server certificate for the target host
openssl genrsa -out server-key.pem 4096
openssl req -new -key server-key.pem -out server.csr -subj "/CN=192.168.56.106"
cat > server-ext.cnf <<'EOF'
subjectAltName = IP:192.168.56.106
extendedKeyUsage = serverAuth
keyUsage = critical,digitalSignature,keyEncipherment
basicConstraints = critical,CA:FALSE
EOF
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server-cert.pem -days 825 -sha256 -extfile server-ext.cnf

# Client certificate for the worker
openssl genrsa -out client-key.pem 4096
openssl req -new -key client-key.pem -out client.csr -subj "/CN=cyber-range-worker"
cat > client-ext.cnf <<'EOF'
extendedKeyUsage = clientAuth
keyUsage = critical,digitalSignature
basicConstraints = critical,CA:FALSE
EOF
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out client-cert.pem -days 825 -sha256 -extfile client-ext.cnf

rm -f server.csr client.csr server-ext.cnf client-ext.cnf
chmod 400 ca-key.pem server-key.pem client-key.pem
chmod 444 ca.pem server-cert.pem client-cert.pem
```

The subject alternative name is the part that actually matters and the part
that is easiest to get wrong. `src/orchestrator/docker-client.ts` passes the
URL hostname to Dockerode, and Node verifies an IP literal against `IP Address`
entries only. A `DNS:` entry naming the same address will not satisfy it, and
an absent SAN fails regardless of what the common name says. Confirm before
going further:

```sh
openssl x509 -in server-cert.pem -noout -text | grep -A1 "Subject Alternative Name"
```

That must print `IP Address:192.168.56.106`. If it prints a DNS entry or
nothing, reissue the server certificate rather than continuing.

Certificates are dated 825 days. Record the expiry; an expired server
certificate fails the worker closed at startup, which is correct behavior but
an unhelpful surprise if nobody is expecting it.

## 2. Install the server material on the target host

Copy only the three public-or-server files. The CA private key stays behind.

```sh
# From the control plane
scp ca.pem server-cert.pem server-key.pem vboxuser@192.168.56.106:/tmp/
```

```sh
# On the target host
sudo install -d -m 700 -o root -g root /etc/docker/certs
sudo install -m 444 -o root -g root /tmp/ca.pem          /etc/docker/certs/ca.pem
sudo install -m 444 -o root -g root /tmp/server-cert.pem /etc/docker/certs/server-cert.pem
sudo install -m 400 -o root -g root /tmp/server-key.pem  /etc/docker/certs/server-key.pem
rm -f /tmp/ca.pem /tmp/server-cert.pem /tmp/server-key.pem
```

## 3. Configure the Engine

Read the existing daemon configuration first and **merge**, never overwrite:

```sh
sudo cat /etc/docker/daemon.json
```

A target host that passes preflight already sets `userns-remap`. Replacing that
file silently removes user-namespace remapping, and the next preflight refuses
to start the worker with a message about host isolation rather than about the
file you edited. Add only the TLS keys:

```json
{
  "userns-remap": "default",
  "tls": true,
  "tlsverify": true,
  "tlscacert": "/etc/docker/certs/ca.pem",
  "tlscert": "/etc/docker/certs/server-cert.pem",
  "tlskey": "/etc/docker/certs/server-key.pem"
}
```

The listener goes in a systemd drop-in rather than in `daemon.json`. Docker
refuses to start when a directive appears both as a flag and in the
configuration file, and the packaged unit already passes `-H fd://`. Setting
`hosts` in `daemon.json` collides with it; adding a second `-H` does not.

```sh
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/override.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://192.168.56.106:2376 --containerd=/run/containerd/containerd.sock
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
sudo systemctl status docker --no-pager
```

The empty `ExecStart=` is required: it clears the inherited value so the second
line replaces rather than appends.

Binding to the host-only address rather than `0.0.0.0` keeps the Engine off
every other interface the machine has. Add a firewall rule for defence in
depth, allowing only the control plane:

```sh
sudo ufw status
sudo ufw allow 22/tcp
sudo ufw allow from 192.168.56.107 to any port 2376 proto tcp comment 'cyber-range control plane'
```

Allow SSH before enabling `ufw` on a machine you reach over SSH. Targets run on
internal networks with no published ports, so the firewall does not interfere
with the lab traffic path.

## 4. Verify before trusting it

Run from the control plane, in the certificate directory. This exercises the
same chain and hostname verification Node will perform:

```sh
curl --cacert ca.pem --cert client-cert.pem --key client-key.pem \
  https://192.168.56.106:2376/version
```

A JSON document naming the Engine version means the handshake, the chain, the
IP SAN, and client authentication all succeeded.

Both negative checks must fail, and a configuration that passes the positive
check while failing these is not enforcing mutual TLS:

```sh
curl -k https://192.168.56.106:2376/version                 # no client certificate
curl --cacert ca.pem https://192.168.56.106:2376/version    # CA trusted, still no client certificate
```

| Symptom | Cause |
|---|---|
| `certificate subject name does not match` | SAN is a DNS entry, or names a different address |
| `unable to get local issuer certificate` | Wrong `ca.pem`, or server certificate signed by another CA |
| `tlsv13 alert certificate required` | Working as intended on the negative checks |
| `connection refused` | Engine not listening; check the drop-in took effect |
| `the following directives are specified both as a flag and in the configuration file` | `hosts` left in `daemon.json` |

## 5. Point the worker at it

On the control plane, in the worker environment. No `DOCKER_SOCKET_PATH`: the
configuration schema rejects a local socket in production, and rejects it
alongside remote settings in any environment.

```sh
NODE_ENV=production
DOCKER_HOST=https://192.168.56.106:2376
DOCKER_CA_PATH=/home/vboxuser/cyber-range-certs/ca.pem
DOCKER_CERT_PATH=/home/vboxuser/cyber-range-certs/client-cert.pem
DOCKER_KEY_PATH=/home/vboxuser/cyber-range-certs/client-key.pem
TRAEFIK_ROUTE_DELIVERY=ingress
TRAEFIK_CONTAINER_DYNAMIC_DIRECTORY=/etc/traefik/dynamic
LAB_INGRESS_CONTAINER=phase3-traefik
LAB_NODE_NAME=nongbuntu-target
```

`DOCKER_HOST` must be an HTTPS URL with no credentials, path, query, or
fragment. Production additionally requires `ingress` route delivery, because a
route written beside the worker would land on the control plane while Traefik
reads from the target host.

One split is easy to miss. The worker reads `RUNTIME_MANIFEST_PATH` from its own
filesystem, so the manifest belongs on the **control plane**. Every image the
manifest pins is inspected over the Docker connection, so the images must be
present on the **target host**. A manifest on the control plane naming an image
only the control plane has will fail preflight.

Then:

```sh
npm run worker:preflight
```

Preflight reads host security options, verifies the ingress container is
running, inspects every pinned image, and verifies route delivery with a
temporary marker it removes afterwards. It creates no target, network, route,
database connection, or Redis connection. Success prints `status`,
`manifestCount`, and `routeDelivery`.

## Rotation and revocation

There is no CRL or OCSP in this setup. Revoking a client means reissuing the CA
and both certificates, then restarting the Engine and the worker. Keep the
rotation cost in mind when deciding how many client certificates to issue;
one per worker is enough.

Rotate the server certificate before expiry. The worker fails closed on an
expired or untrusted certificate, so an unnoticed expiry presents as a worker
that will not start rather than as a security hole.

## What this does not prove

A passing handshake shows the transport is authenticated in both directions. It
does not show that the target host is isolated, that targets cannot reach the
control plane, or that a live target is reachable through ingress. Those are
separate checks in
[the Phase 4 security gate record](PHASE4_SECURITY_GATE.md), and the gate stays
open until they pass on this topology.
