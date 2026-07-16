# MarketDesk specification set

## Authoritative reading order

1. [`../design/MarketDesk PRD.dc.html`](../design/MarketDesk%20PRD.dc.html) — canonical product behavior and acceptance contract.
2. [`../design/MarketDesk.dc.html`](../design/MarketDesk.dc.html) and [`../design/screenshots/`](../design/screenshots/) — canonical visual composition and interaction usage.
3. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) plus later [`../../ARCHITECTURE_AMENDMENTS.md`](../../ARCHITECTURE_AMENDMENTS.md) — architecture and safety constraints.
4. [`PRODUCT.md`](PRODUCT.md) — current maturity and explicitly approved deviations; it constrains claims but does not erase PRD requirements.
5. [`TRACEABILITY.md`](TRACEABILITY.md) — implementation status, evidence and active issues.

Supporting delivery documents:

- [`TECH_STACK.md`](TECH_STACK.md) — current implementation stack and boundaries.
- [`TASKS.md`](TASKS.md) — active product-recovery work map.
- [`SDD_WORKFLOW.md`](SDD_WORKFLOW.md) — delivery and closeout gates.
- [`RUNBOOK.md`](RUNBOOK.md) — safe development and deployment commands.
- [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) — unresolved product/technical choices.

## Conflict rule

Never resolve a conflict by silently choosing the shortest or newest document. Record the decision in a GitHub issue, add it to `PRODUCT.md` if it is an approved deviation, update `TRACEABILITY.md`, then implement and verify it.

## Security and workspace constraints

- Never commit secrets, tokens, cookies, credentials, exports or production data.
- Keep every read/write workspace-scoped.
- Treat marketplace payloads, remote statuses and provider lifecycle as external truth behind adapters.
- Use isolated QA workspaces for deployed testing; do not publish, relist or mutate real marketplace data without explicit authorization.
