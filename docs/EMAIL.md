# Authentication email delivery

The API selects an `AuthMailer` using `MAIL_PROVIDER`. The default `local`
provider writes verification and password-reset messages to the ignored
`LOCAL_MAIL_DIRECTORY`. All providers keep email tokens out of request logs.
The `resend` provider supplies the production delivery adapter.

## Gmail for local demos

Set these values in the backend's ignored `.env`, preserving existing secrets:

```dotenv
MAIL_PROVIDER=gmail
SMTP_USER=your-sender@gmail.com
SMTP_APP_PASSWORD=your-google-app-password
EMAIL_SENDER_NAME=Cyber Range
FRONTEND_ORIGIN=http://localhost:3000
```

Use a Google app password, not the account password. Spaces in the app password
are removed before authentication. The sender address is always `SMTP_USER`;
the display name is customizable. Credentials belong only to the backend API.
Restart `npm run dev` after changing `.env`. Set `MAIL_PROVIDER=local` to return
to file delivery.

The adapter uses `smtp.gmail.com:465` with verified TLS, bounded connection
timeouts, disabled protocol logging, and disabled file/URL content access.
Provider failures become a generic error without the original diagnostics or
cause, preventing credentials or message contents from entering API logs.
See [Nodemailer's SMTP documentation](https://nodemailer.com/smtp).

Verification links use `/verify-email?token=...`; password resets use
`/reset-password?token=...` at `FRONTEND_ORIGIN`. The frontend must implement
those pages and submit the tokens through its trusted BFF. A localhost link
works only on the computer running that frontend. Email delivery does not prove
that the frontend confirmation flow works.

## Validation and launch limits

On 2026-10-05, Gmail TLS/authentication succeeded and Gmail accepted one
operator-approved setup email. Inbox receipt remains to be confirmed by the
operator. No live verification or password-reset email was sent during that
check. Unit tests cover both link types, token encoding, recipient rejection,
sanitized errors, and transport restrictions.

Lint, typecheck, and build passed; 100 tests passed and 46 environment-gated
tests were skipped. These checks ran on the machine's Node 24.19.0; the repo
still supports Node 22, which must be used for supported-runtime validation.

Gmail is an explicit local-demo option and is rejected under
`NODE_ENV=production`. The local file mailer also rejects production use.
Public signup stays closed. Never commit app passwords, `.env`, or email tokens.

## Production Resend setup

The Resend adapter is implemented. Set the following only on the backend API,
after verifying the sender domain in your Resend account:

```dotenv
NODE_ENV=production
MAIL_PROVIDER=resend
RESEND_API_KEY=your-server-only-api-key
EMAIL_FROM=noreply@your-verified-domain.example
EMAIL_SENDER_NAME=Cyber Range
FRONTEND_ORIGIN=https://your-frontend.example
```

Production startup requires complete Resend credentials and an HTTPS frontend
origin that is not loopback and has no credentials, path, query or fragment.
Configuration cannot prove DNS/domain verification; Resend enforces that when
accepting mail. The existing local demo continues to use Gmail.

Requests use the fixed HTTPS endpoint, a 15-second timeout, rejected redirects,
and a hashed idempotency key for the same purpose/recipient/token. The adapter
validates the provider's acceptance response and discards provider diagnostics.
See the [Resend send-email contract](https://resend.com/docs/api-reference/emails/send-email).
Delivery is synchronous; there is no durable email outbox or automatic retry.
Provider acceptance does not prove inbox delivery.

Verification/reset requests retain their generic HTTP 202 acknowledgement when
delivery fails. The backend writes `auth.email.delivery_failed` with only the
backend-owned target account ID and `purpose` audit detail. It never stores the
recipient, token, password, message, or provider error in that event. Operators
must monitor this event; a player may retry the request after the provider issue
is resolved. Database token/audit persistence errors still propagate as errors.
Response timing is not made uniform by this change.

On 2026-10-05, lint, typecheck, build, and 112 local tests passed on Node 24.19.0;
46 environment-gated tests skipped. The Resend adapter's Node 22 CI passed at
[run 37268300486](https://github.com/Yoshi4489/cyber-lab-backend/actions/runs/37268300486).
The email failure security fix also passed Node 22 CI at
[run 37268528702](https://github.com/Yoshi4489/cyber-lab-backend/actions/runs/37268528702).
Contract tests use injected provider responses and do not send mail. Live Resend
delivery, domain verification, inbox receipt, production browser email-link
completion, and operational launch controls remain unverified Phase 4 gates.

An additional 16 authentication service/repository/route integration tests passed
against a freshly created disposable PostgreSQL 18.3 database on this machine.
The database was removed after the run; the local demo database was preserved.
No external mail was sent in these tests.
