## The flaw

The login builds its SQL by joining strings, so input can change the meaning of the query (CWE-89). The verbose database error makes this easy to confirm.

## Solving it

1. Enter `'` as the username. The error page shows a SQL syntax error, which confirms that input reaches the query unescaped.
2. Enter `administrator' --` as the username and anything as the password. The query becomes:

   ```sql
   select username, role, note from staff where username = 'administrator' --' and password_hash = '...'
   ```

   Everything after `--` is a comment, so the password check disappears.
3. The dashboard shows the admin note, which holds the flag.

## The fix

Use parameterized queries, so input is always data and never SQL: `where username = ? and password_hash = ?`. Show users a generic error and keep details in server logs. Passwords also need a slow password hash such as Argon2id rather than plain SHA-256.
