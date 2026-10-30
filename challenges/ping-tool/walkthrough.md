## The flaw

The host value goes straight into a shell command (CWE-78). The filter blocks `;` and `&`, but a denylist can't cover everything a shell treats as special.

## Solving it

1. Try `127.0.0.1`. The output suggests a command is being run for you.
2. Try `127.0.0.1; id`. The filter rejects it.
3. A pipe isn't blocked. Enter `x | ls -la /tmp` and the listing comes back in the page, including an `ops` directory.
4. Enter `x | cat /tmp/ops/runbook.txt` to read the runbook, which holds the flag.

## The fix

Never pass user input through a shell. Validate the host against a strict pattern, then run the program with an argument array, such as `execFile('nc', ['-z', '-w', '1', host, '80'])`. Allowlists describe what's valid; denylists guess at what's dangerous. Running with few privileges, no network and no secrets on the box limits the damage if injection does happen.
