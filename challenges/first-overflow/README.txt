First Overflow
==============

The visitor badge printer runs as a network service on host "target", port 9001.
Its source is vuln.c in this directory. Connect from this workstation with:

    nc target 9001

The printer reads your name into a small fixed buffer without checking the
length. Redirect execution to the win() function, which reads the flag the
service holds at /tmp/flag.txt and prints it to your connection.

Tools on this workstation: gcc, gdb, objdump, python3 with pwntools, nc.
The win() address is fixed (the binary is built with -no-pie), so no leak is
needed. The flag file exists only inside the target container; read it through
the program, not by logging in to the target.
