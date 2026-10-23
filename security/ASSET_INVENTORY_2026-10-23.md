# Digital Fortress — Connected asset inventory (2026-10-23)

**Classification: internal security operations.** Do not copy this inventory, service identifiers or deployment topology into public repositories. Contains no credentials.

## Coverage and limitations
Verified from connected GitHub, Render and Neon accounts during the current security iteration: **13 GitHub repositories, 9 Render web services and 10 Neon projects**. This inventory does **not** prove a comprehensive inventory of third-party assets, domains, internal hosts, CircleCI projects, secrets, or cloud assets outside these connections. A discovered asset is not a secure asset.

## GitHub repositories (13)
- CayelaemJ/Adhoc-Updates
- CayelaemJ/NewChanges
- CayelaemJ/c
- CayelaemJ/Testing-EFS
- CayelaemJ/Training-and-Development-Hub
- CayelaemJ/EFS-React-Migration
- CayelaemJ/CABOSOLUTIONS
- CayelaemJ/ecommerce-platform-for-botswana
- CayelaemJ/Grooming-and-Beauty-Bookings
- CayelaemJ/Artist-Management-Hub
- CayelaemJ/Ecommerce-Platform- (empty repository)
- CayelaemJ/Accounting-Audit-And-Analytics-Software
- CayelaemJ/HR-Software

## Render deployment mapping (9)
| Service | GitHub repository |
| --- | --- |
| cabo-learning-native-isolated-preview | Training-and-Development-Hub |
| cabo-financial-staging | Accounting-Audit-And-Analytics-Software |
| omnimaster-portfolio | Adhoc-Updates |
| cabo-human-capital | HR-Software |
| cabo-beauty-preview | Grooming-and-Beauty-Bookings |
| cabo-artist-hub | Artist-Management-Hub |
| cabo-learning-hub-pilot | Training-and-Development-Hub |
| cabo-solutions-site | CABOSOLUTIONS |
| newchanges-standby | NewChanges |

**Review:** portfolio service is mapped to Adhoc-Updates; verify intended build/repository before deployment.

## Neon projects (10)
- cabo-learning-native-demo-isolated
- cabo-financial-intelligence-staging
- cabo-human-capital
- cabo-beauty-marketplace
- cabo-artist-hub
- cabo-commerce
- cabo-solutions-site
- cabo-learning-hub
- newchanges-primary-pg18
- newchanges-identity-dr

Neon reports `block_public_connections=false` for each of these projects. This means public network connections are permitted; it does **not** establish unauthenticated database access. Review allowed IPs / private networking, TLS, roles, rotation and successful restore testing according to deployment dependencies.

## High-priority validation queue
1. Rotate any still-active credentials previously exposed outside the secret manager; inspect audit logs for misuse before revocation.
2. Confirm rate limiting, object authorization and signed session protections on every publicly reachable route.
3. Verify database tenant-isolation policies, app-role privilege restrictions and branch environments.
4. Prove CircleCI execution for each relevant security PR; do not infer success from a committed configuration.
5. Confirm portfolio repository/deployment mapping; inspect non-Render and dormant assets separately.
6. Test isolated backup restores, alerting and disaster recovery; do not claim compliance until verified.

## Evidence classification
Counts and Render–GitHub / Neon identifiers: connected provider API inventory. Security checks, CVE severity, exploitability, penetration tests, CI execution, backups and credentials: **not yet verified**. Never treat this inventory as a vulnerability assessment or completion certificate.
