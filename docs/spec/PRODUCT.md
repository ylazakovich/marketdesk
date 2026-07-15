# Product scope

MarketDesk helps a seller manage products and listings from one workspace, with Hermes AI assisting but not silently applying marketplace side effects.

## Current maturity

- Production/SaaS direction: yes, with workspace isolation and live-data safety as first-class requirements.
- Validated marketplace focus: OLX integration, OAuth, owned-advert import/sync, publish queue, metrics where available.
- Other marketplaces: UI may show roadmap placeholders, but they are not claimed live until provider credentials, adapters, tests, and runbook checks exist.

## In scope

- Product creation/editing, image references, listing state, marketplace sync status, price/history, and AI suggestions.
- Review-first Hermes workflows: suggestions must be visible, editable, approvable, or dismissible.
- Remote marketplace truth: local UI must surface canonical normalized OLX states such as pending moderation, active, unavailable, and unknown separately from local draft/live state.

## Not ready / unsupported

- Unconfirmed live publishing to non-OLX marketplaces.
- Secret exposure in docs, logs, frontend state, or issue/debug output.
- Automatic marketplace mutation without explicit user confirmation and configured live gate.
