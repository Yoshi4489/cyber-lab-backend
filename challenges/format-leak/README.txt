Format Leak
===========

The feedback terminal runs as a network service on host "target", port 9002.
Its source is vuln.c in this directory. Connect from this workstation with:

    nc target 9002

Type a message and it echoes it back. The program uses your message as the
format string for printf, so format specifiers such as %p and %s are
interpreted instead of printed. A pointer to the secret the service loaded is
sitting on the stack. Walk the stack with positional specifiers (%1$p, %2$p, ...)
until you find the message, or read it straight through a pointer with %N$s.

Tools: python3 with pwntools, gdb, nc. The lab has no internet access.
