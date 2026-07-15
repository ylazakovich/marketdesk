# SDD workflow

1. **Idea / intake** — capture the user problem, screenshots/evidence, expected behavior, and acceptance criteria in GitHub issues.
2. **Documentation/spec update** — update product/spec/runbook/task docs when the change affects scope, safety, deployment, or workflow.
3. **Development / implementation** — keep changes reviewable and tied to the issue; preserve workspace isolation and secret safety.
4. **Testing pyramid validation** — prefer behavior coverage over raw percentages:
   - unit tests for pure logic, validators, reducers, formatters;
   - API/integration tests for contracts, DB, queue/job behavior, marketplace adapter boundaries;
   - UI/component tests for critical rendering and user interactions;
   - E2E/smoke checks for key journeys and deployed health.
5. **CodeRabbit / review fixes** — inspect top-level, review, and inline comments for the current head and fix valid findings.
6. **Server delivery** — after merge, use the live backup gate before deployment and verify health/readiness/logs/public route.
