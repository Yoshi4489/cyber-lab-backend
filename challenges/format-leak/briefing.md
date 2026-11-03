A support team runs a feedback terminal as a small network service. You have a
workstation terminal in the browser; the service runs on the host `target`,
port 9002, and its source is on your workstation at `/opt/format-leak/vuln.c`.

The terminal echoes each message back to you. It loaded a secret into memory at
startup and keeps a pointer to it on the stack. Read that secret.

Tools available: `python3` with `pwntools`, `gdb`, and `nc`. The lab has no
internet access. The secret exists only inside the `target` service; read it
through the service, not by trying to log in to `target`.

**Scope:** only the workstation and target assigned to this session.
