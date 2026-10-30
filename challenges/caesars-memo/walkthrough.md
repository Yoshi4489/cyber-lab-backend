## The flaw

A shift cipher moves every letter by the same amount. There are only 25 keys, so the method gives no real protection. The release code is also only encoded, and encoding needs no key at all.

## Solving it

1. Try every shift, or compare letter frequencies: the most common letter is probably `e`.
2. At the right shift the memo reads as English and ends in a line starting `Release code:`.
3. That value uses only letters, digits, `+`, `/` and `=`, which suggests Base64. Decode it to get the flag.

## The fix

Use authenticated encryption from a maintained library, such as AES-GCM, with a key kept apart from the message. Don't treat encoding as protection.
