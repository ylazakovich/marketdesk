# Product contract

## Purpose

MarketDesk is a workspace-scoped operating system for managing products, marketplace listings, pricing, marketplace health, analytics, and Hermes-assisted decisions from one interface.

## Source-of-truth hierarchy

Use these artifacts in this order. A lower item may clarify a higher item, but must not silently erase or contradict it.

1. **Product behavior and acceptance:** [`../design/MarketDesk PRD.dc.html`](../design/MarketDesk%20PRD.dc.html). This original 18-section PRD is the canonical product contract.
2. **Visual composition and interaction usage:** [`../design/MarketDesk.dc.html`](../design/MarketDesk.dc.html) and curated [`../design/screenshots/`](../design/screenshots/). The companion is an implementation reference, not a separate product scope.
3. **Architecture:** [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md), with [`../../ARCHITECTURE_AMENDMENTS.md`](../../ARCHITECTURE_AMENDMENTS.md) taking precedence where it explicitly amends the baseline.
4. **Current maturity and approved deviations:** this file. Maturity limits must be represented honestly in the UI; they do not remove the PRD capability or roadmap surface.
5. **Delivery state:** [`TRACEABILITY.md`](TRACEABILITY.md), GitHub issues and merged PR evidence.

When sources conflict, do not guess. Open or update an issue, record the approved decision under **Approved deviations**, then update traceability and tests in the same delivery cycle.

## Current maturity

- OLX is the only validated real marketplace integration.
- Other PRD marketplaces are roadmap/unavailable surfaces. They must never appear connected or initiate a fake integration flow.
- Product creation, Hermes activity, dashboard, product details, settings, analytics and the common shell are partially implemented; their open acceptance gaps are tracked in [`TRACEABILITY.md`](TRACEABILITY.md).
- Remote marketplace truth remains separate from local state. Normalized states include pending moderation, active, unavailable and unknown; raw provider state remains inspectable where available.
- Hermes recommendations are reviewable proposals. Approval applies product changes and queues supported live-listing updates; it must not silently claim unsupported automation.

## Approved deviations from the original PRD

| Area | Decision | Product consequence | Evidence |
| --- | --- | --- | --- |
| Marketplace availability | OLX only is operational today. | Keep non-OLX channels visible only as explicit roadmap/unavailable cards; no fake connect buttons or fabricated metrics. | #174 |
| Provider lifecycle | Marketplace state is provider truth, separate from local draft/live state. | Unknown or moderation states must not be shown as active. | Architecture amendments; existing OLX status work |
| Dangerous automation | Publication, relist, category changes and quota overrides remain guarded. | Full-auto mode cannot bypass marketplace quota/category safety. | OLX quota/category issues |

Add future deviations only after an explicit product decision. Include the issue/ADR and the affected PRD section.

## Definition of done

A product/UI issue is complete only when all applicable evidence exists:

- every original acceptance criterion is checked against the implementation;
- placeholders and disabled controls are explicitly out of scope in an approved deviation, not counted as implementation;
- behavior tests cover success, empty, loading, error and guarded/destructive states as applicable;
- visual evidence compares the deployed route with the companion at desktop light/dark and a narrow viewport;
- keyboard/focus and accessible names are verified for changed controls;
- the deployed flow is exercised without mutating real marketplace data unless separately authorized;
- `TRACEABILITY.md` is updated with code, tests, issue and PR evidence;
- review findings and CI are resolved for the current head.

A component rendering, route existing, placeholder copy, mocked metric or green build alone is not completion.
