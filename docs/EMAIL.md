# Authentication email delivery

The API selects an `AuthMailer` using `MAIL_PROVIDER`. The default `local`
provider writes verification and password-reset messages to the ignored
`LOCAL_MAIL_DIRECTORY`. Both providers keep email tokens out of request logs.

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
Production Resend delivery, verified domain/TLS, frontend secure-cookie/CSRF
checks, and operational launch controls remain open Phase 4 requirements.
Public signup stays closed. Never commit app passwords, `.env`, or email tokens.
