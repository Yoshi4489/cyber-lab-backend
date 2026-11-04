## The flaw

The tool uses textbook RSA with `e = 3` and no padding. The secret is short, so `m^3` is smaller than `n` and the modular reduction never happens. The ciphertext is simply `m` cubed.

## Solving it

1. Read `c` from `output.txt`.
2. Take the exact integer cube root of `c`, using big-integer arithmetic. Floating point loses the precision you need.
3. Convert the result from an integer to bytes to get the flag.

## The fix

Use RSA-OAEP from a maintained library, or a modern hybrid scheme. Padding makes the message large and randomised, so this attack no longer applies.
