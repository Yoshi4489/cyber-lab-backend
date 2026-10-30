## The flaw

The server uses HTTP Basic authentication over plain HTTP. Basic only Base64-encodes the username and password, so anyone who can see the traffic can read them.

## Solving it

1. Open the capture in Wireshark and filter on `http`.
2. Most attempts to `/admin/backup` get `401 Unauthorized`. One gets `200 OK`.
3. Open the request before it and read the `Authorization: Basic` header. Wireshark decodes it, or you can Base64-decode it yourself.
4. The value is `username:password`. The password is the flag.

## The fix

Serve logins only over TLS, and prefer short-lived tokens with multi-factor authentication for sensitive areas.
