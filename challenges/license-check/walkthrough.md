## The flaw

The tool holds everything needed to check a serial, which means it holds everything needed to make one. A check running on the user's machine can't keep a secret from that user.

## Solving it

1. Read `check`. A serial byte passes when `((byte ^ KEY[i % KEY.length]) + i) & 0xff` equals `TABLE[i]`.
2. Undo the steps in reverse: `byte = ((TABLE[i] - i) & 0xff) ^ KEY[i % KEY.length]`.
3. Apply that to every entry, then turn the bytes into text.
4. Confirm it with `node license_check.js <serial>`, then submit it.

## The fix

Verify licenses on a server you control, or use signatures with a private key that never ships to the user.
