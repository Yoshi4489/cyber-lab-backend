## The flaw

Image viewers stop reading at the end of the image, so they ignore anything added after it. That makes it an easy place to hide data.

## Solving it

1. Run `exiftool scan-0417.png`. The comment says a case note is stored with the scan.
2. Find the `IEND` chunk. The PNG ends 8 bytes after the start of that name.
3. The bytes that follow start with `1f 8b`, the gzip signature. Carve them out with `binwalk -e`, or with `dd`.
4. Decompress them and read the custody code, which is the flag.

## The fix

This isn't a bug to patch, but an investigation habit. Compare a file's size with what its format needs, and check evidence for appended data.
