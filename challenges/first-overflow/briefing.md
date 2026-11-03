A reception desk prints visitor badges from a small network service. You have a
workstation terminal in the browser; the badge printer runs on the host `target`,
port 9001, and its source is on your workstation at `/opt/first-overflow/vuln.c`.

The printer reads your name into a fixed buffer without checking the length. A
staff-only `win()` function in the same program reads a vault file and prints it,
but nothing ever calls it. Make the program call it anyway and recover the vault
contents.

Your home directory is a scratch workspace: you can compile and run code there.
Tools available: `gcc`, `gdb`, `objdump`, `python3` with `pwntools`, and `nc`.
The lab has no internet access. The vault file exists only inside the `target`
service; read it through the program, not by trying to log in to `target`.

**Scope:** only the workstation and target assigned to this session.
