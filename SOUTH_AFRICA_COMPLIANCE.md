# South Africa Privacy, Cybersecurity and Data Governance Control Framework

Last reviewed: 30 September 2026

## Purpose

This document maps product controls to the South African legal and governance areas most relevant to the Portal. It is an engineering control framework, not legal advice or a certification.

The product should not assume that every processing activity has the same legal role. For each activity, the organisation must determine whether it is acting as a responsible party, co-responsible party or operator, based on the actual facts, contracts and decision-making responsibilities.

## POPIA controls

### Processing limitation and purpose
Every material processing activity should have:
- a defined purpose;
- a documented lawful basis;
- identified data subjects and data categories;
- a source and recipient record;
- a review owner;
- a privacy impact assessment status where appropriate.

The application stores this in the ProcessingActivity register.

### Security safeguards
The security layer records:
- authentication and failed-login events;
- active sessions and session revocation;
- device and approximate location signals;
- sensitive API access;
- administrator actions;
- security alerts;
- security incidents.

Audit logging must remain proportionate. Request bodies, passwords, tokens and secrets must not be placed into ordinary audit records.

### Operators
Where the Portal acts as an operator, the responsible-party relationship and operator agreement must be recorded. Service providers and subprocessors must be reviewed for confidentiality, security and breach-notification obligations.

### Data subject rights
The DataSubjectRequest workflow records:
- access requests;
- correction requests;
- deletion requests;
- objections;
- consent withdrawals where applicable;
- identity verification;
- due date;
- assignment;
- resolution.

Identity verification is required before disclosure or destructive changes.

### Retention
Retention is purpose-driven. The application records a retention rule and deletion method before an automated deletion job should be enabled. A legal hold prevents automated disposal.

Do not treat a fixed retention period as universally lawful. The appropriate period depends on purpose, contracts and other applicable legal obligations.

### Cross-border processing
Cross-border processing must have a documented POPIA section 72 basis before approval.

External IP geolocation is therefore disabled by default. It may only be enabled after the organisation documents and approves the applicable transfer basis and provider controls.

### Security compromises
The SecurityIncident workflow is intended to preserve:
- discovery time;
- containment;
- affected data classes;
- affected data subjects;
- Information Officer ownership;
- regulator notification status;
- data-subject notification status;
- evidence;
- mitigation;
- root cause;
- resolution.

A security alert is not automatically a legal breach determination. The Information Officer and appropriate legal/compliance personnel must assess the incident.

## PAIA controls

The organisation should maintain a current PAIA Manual and the required Information Officer / Deputy Information Officer arrangements. The Portal should provide a controlled record of access-to-information requests and support retrieval of records needed to respond.

## Cybercrimes controls

Security monitoring and incident records should preserve relevant evidence without unnecessarily retaining personal information. The incident process must allow escalation to the appropriate authorities where a statutory reporting obligation applies.

The Cybercrimes Act contains reporting obligations for specified electronic communications service providers and financial institutions in defined circumstances. Whether that obligation applies to the Portal or its operator must be determined from the actual regulated role and facts.

## Financial-sector overlay

If the product or a client is subject to FSCA, FIC, NCA, financial-sector conduct, credit-reporting or other sector-specific requirements, those obligations must be added to the processing register and retention schedule. POPIA compliance does not replace sector-specific obligations.

## Production release gates

Before production use with live personal information:
1. Register the Information Officer and required deputies.
2. Approve the PAIA Manual.
3. Complete a personal information impact assessment for the Portal.
4. Complete the processing activity register.
5. Identify responsible-party, co-responsible-party and operator roles per activity.
6. Execute operator/data-processing agreements with relevant providers.
7. Complete the cross-border transfer register.
8. Review all subprocessors.
9. Approve retention and deletion schedules.
10. Test data-subject request handling.
11. Test the POPIA security-compromise process.
12. Test backups and restoration.
13. Complete authenticated authorisation and tenant-isolation testing.
14. Complete an independent external penetration test before high-risk production use.
15. Have South African privacy/financial-services counsel review the final contracts, privacy notice, processing roles and sector-specific obligations.

## Important implementation rule

No engineering control should be presented to clients as proof that the organisation is legally compliant. The application can provide evidence, workflows and technical safeguards, but legal compliance depends on the organisation's processing purposes, contracts, policies, governance, people and actual operations.
