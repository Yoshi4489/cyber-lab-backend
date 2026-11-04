## The flaw

The portal checks that you're signed in, but never that the invoice you asked for belongs to you. This is an insecure direct object reference (CWE-639).

## Solving it

1. Sign in with the demo account and open an invoice. The address ends in `invoice?id=1042`.
2. Change the number. Other customers' invoices open without any error.
3. Work downward from 1042. Invoice 1001 belongs to the Northwind Board, and its memo holds the flag.

## The fix

Filter by owner on the server, for example by looking up `invoice.id = ? AND invoice.customer_id = ?` using the session's customer. Unguessable IDs make the flaw harder to find, but they don't fix it. Return the same "not found" for missing and forbidden invoices, so the response doesn't confirm that an ID exists.
