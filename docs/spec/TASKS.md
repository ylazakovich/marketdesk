# Product recovery work map

The live implementation is tracked against the original PRD in [`TRACEABILITY.md`](TRACEABILITY.md). GitHub issues are the executable backlog; this file is only the current map.

## Foundation

- #170 — canonical PRD hierarchy, traceability and closeout gates.
- #171 — shared application shell, branding and duplicate-header correction.

## Screen parity

- #137 — Dashboard.
- #172 — Products catalogue.
- #138 — guided product wizard.
- #173 — Analytics.
- #139 — Hermes overview and activity feed.
- #174 — Marketplaces and brand assets.
- #140–#149 — Settings shell, persistence and functional sections.
- #150 — product detail.

## Provider correctness

- #164 and follow-ups — OLX publication quota safety.
- #169 — semantic category validation and quota-safe recreation guidance.

## Task closeout

Do not close an issue because a route, shell, placeholder or disabled control exists. Every issue requires its own acceptance criteria, targeted checks/tests, resolved review findings, and a `TRACEABILITY.md` update in the same PR. Live-facing runtime changes additionally require deployed visual or functional evidence; documentation-only and CI/automation work instead require appropriate document review and CI output.
