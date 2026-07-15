# MarketDesk SDD

MarketDesk is a self-hosted marketplace operations desk for creating products, managing listings, reviewing Hermes AI suggestions, and safely syncing with marketplaces. The current validated integration focus is OLX; other marketplace surfaces are product-direction placeholders until their credentials, adapters, and live contracts are implemented.

## Source of truth

- `PRODUCT.md` — product scope, maturity, supported/unsupported claims.
- `TASKS.md` — backlog/task conventions and closeout rules.
- `OPEN_QUESTIONS.md` — unresolved product or integration decisions.
- `TECH_STACK.md` — stack and architecture map.
- `RUNBOOK.md` — local/dev/live delivery and backup expectations.
- `SDD_WORKFLOW.md` — idea → docs → development → testing → review fixes → server delivery cycle.

Agents and humans should read this spec set before implementing product changes. If implementation changes scope, safety, deployment, or testing expectations, update the relevant spec doc in the same PR.

## Done means

A task is done only when the implementation is merged, relevant tests/checks pass, CodeRabbit/review comments are resolved, and the deployed app is verified when the task affects the live service.
