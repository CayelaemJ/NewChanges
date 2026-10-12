# NewChanges security workstream — PR #93

This PR is the sole active security-hardening workstream. It consolidates password hash verification and immediate session revocation when roles, employer links, partner links, or activation status change.

## Remaining review gates

- Verify CI, dependency audit and TypeScript build on this combined branch.
- Run database-backed authorization tests for role downgrade, employer reassignment, superadmin isolation and account deactivation.
- Confirm Railway proxy topology and restrict trusted forwarding headers.
- Harden external API egress against DNS rebinding and SSRF.
- Introduce shared or edge-enforced rate limiting for login and password reset.
- Replace permissive inline-script CSP after migrating scripts to compatible delivery.
- Verify source SQL TLS certificate validation and read-only credentials.
- Verify recovery, tenant isolation, incident response, logging redaction and POPIA controls.

Do not merge until review gates are complete. Passing static checks does not certify production security.
