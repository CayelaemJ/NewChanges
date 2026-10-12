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

## Legal, privacy and commercial release gate

- [ ] Counsel approves Privacy Policy, Terms, lawful bases, POPIA roles and any limitation-of-liability wording.
- [ ] Verify information officer, privacy/legal contacts and current deployment operator identity.
- [ ] Inventory actual cookies, scripts, trackers and analytics. If optional tracking is added, block until valid consent and support rejection/withdrawal.
- [ ] Publish verified subprocessors, processing purposes, locations and international-transfer safeguards; do not invent suppliers.
- [ ] Execute a business data-processing agreement defining responsible-party/operator duties, security, breach escalation, deletion and subprocessor approval.
- [ ] Verify full user access/export, rectification, deletion and retention workflows, including employer-controlled records, backups and legal holds.
- [ ] Check signup terms acceptance and record policy version/time; verify marketing opt-in is separate and unsubscribe works. Transactional security emails must remain available.
- [ ] Inventory images, fonts, customer logos and package licenses; obtain permission or replace unsupported assets.
- [ ] Verify no unsubstantiated SOC 2, ISO or uptime commitments appear in public content.
- [ ] Confirm whether billing, automatic renewal or self-service cancellation exist before adding corresponding disclosures and cancellation functionality.
- [ ] Review all automated scoring and any AI-provider transfers; prohibit unapproved model training on employer/employee data.
- [ ] Verify actual Railway configuration and run browser, database, tenant-isolation and recovery tests before claiming compliance.
