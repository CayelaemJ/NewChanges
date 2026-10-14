# Free CI alternative: CircleCI

GitHub-hosted Actions currently cannot start jobs for this account due to its billing/spending-limit restriction. This is **not** a GitHub Copilot requirement or evidence that code failed tests.

## Activate CI for this private repository
1. Sign in at https://app.circleci.com/ using GitHub; select the CircleCI Free plan. CircleCI requires explicit account authorization.
2. Authorize access to **CayelaemJ/NewChanges** only if the OAuth/GitHub app offers repository selection.
3. In CircleCI, create/follow a project for `CayelaemJ/NewChanges` using the existing `.circleci/config.yml` on branch `feat/safe-live-source-sync-layer`.
4. Confirm the `verify_pull_requests_and_main / verify` job runs and opens the build and test logs.
5. Keep GitHub PR #109 in draft until CI is green and integration tests with real private storage, Test database migration, source cutover and restore are complete.

The pipeline runs `npm ci`, full application build, source/semantic security tests, dashboard regressions, type checks and dependency audit on Node 22. It **does not** require database credentials and performs **no deployment**.

CircleCI's free credits are finite. Small Docker resource class and serialized checks keep costs predictable; review credits and disable unneeded branch builds to control usage. Never put live Neon credentials in CI.

## Future GitHub required-check policy
If the repository requires the GitHub Actions `verify` status, update branch protection to accept the CircleCI check only **after** CircleCI has successfully reported it to GitHub. Do not bypass required checks or mark a blocked run as passing.
