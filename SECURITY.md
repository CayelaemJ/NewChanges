# Security policy

## Reporting a vulnerability

Do not open a public issue for a security vulnerability. Report the affected route/file, impact, reproduction steps, and whether production data may be exposed through the private security channel maintained by the repository owner.

Never include passwords, session cookies, API tokens, database credentials, or personal data in a report.

## Production security baseline

Every production change must pass the repository CI gates before deployment:

- `npm ci`
- `npm run build`
- `npm run check:production`
- `npm run check:security`
- `npm run check:ui`
- `npm run check:imports`
- `npm run check:scheduling`
- `npm audit --audit-level=high`

Security-sensitive changes require review of authentication/authorization, session handling, input validation, data isolation, logging/redaction, dependency risk, and browser security headers.

## Secrets

Secrets belong in Railway environment variables or the approved secret store. Never commit `.env` files, production credentials, session tokens, API keys, or database passwords.

## Production rule

A successful Railway deployment is not by itself evidence that the application is secure. CI, application-level regression checks, dependency scanning, and controlled review are release gates.
