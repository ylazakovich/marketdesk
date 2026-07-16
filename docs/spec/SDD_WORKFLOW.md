# SDD workflow

1. **Idea / intake** — capture the user problem, canonical PRD section, screenshots/live evidence, expected behavior and testable acceptance criteria in GitHub issues.
2. **Source reconciliation** — read the source hierarchy in `docs/spec/README.md`. If sources conflict, record an explicit decision; never silently replace the original requirement with a narrower implementation note.
3. **Traceability update** — update `docs/spec/TRACEABILITY.md` with status, owning code/tests and issue before implementation when the gap is newly discovered.
4. **Development / implementation** — keep changes reviewable and tied to one coherent issue; preserve workspace isolation, provider truth and secret safety.
5. **Testing pyramid validation** — prefer behavior coverage over raw percentages:
   - unit tests for pure logic, validators, reducers and formatters;
   - API/integration tests for contracts, DB, queue/job behavior and marketplace adapter boundaries;
   - UI/component tests for critical rendering and user interactions;
   - deployed smoke/dogfood checks for key journeys, empty/loading/error states and public health.
6. **Visual and accessibility validation** — for UI work, compare with the companion at desktop light/dark and a narrow viewport; verify keyboard/focus and accessible names.
7. **Review fixes** — inspect top-level, review and inline CodeRabbit/human comments for the current head and fix or explicitly resolve every valid finding.
8. **Closeout gate** — check every issue acceptance criterion. A shell, placeholder, mock metric, disabled control or green build is not proof of completion. Update traceability with PR and verification evidence.
9. **Server delivery** — after merge, use the live backup gate before deployment and verify health/readiness/logs/public route. Never mutate real marketplace data during smoke testing without separate authorization.
