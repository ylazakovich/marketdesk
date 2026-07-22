# MarketDesk agent execution contract

MarketDesk owns a versioned allowlist of agents. The first profile is `listing-seo@1.0.0`. New product UI requests a product-scoped run with authenticated `POST /api/hermes/products/:productId/run`; the server resolves that product inside the caller's workspace. Legacy `POST /api/hermes/run` without `productId` remains available only for existing clients and compatibility tests, not as a new UI entry point.

`listing-seo` receives only typed product/listing JSON: identifiers, title/name, description, category, condition, tags, image count and marketplace identifier. Unknown fields are rejected. Credentials, tokens, internal paths, workspace settings/context, host Hermes skills, memories and files are never input. Its profile grants no web, network, terminal, filesystem or other tools. Creativity (`precise`, `balanced`, `creative`, default `balanced`) changes the versioned system instruction, not tool permissions or autonomy.

Every result is a review suggestion with a concrete product change for an allowlisted v1 field (`title` or `description`). Product-scoped SEO cannot publish, update a marketplace, or auto-apply under any autonomy level. The suggestion records workspace/product scope, agent/version, creativity, source and normalized recommendation fingerprints plus an outcome (`suggested`, `suppressed`, or `failed`). Equal semantic recommendations for an unchanged SEO source are suppressed for 30 days; changing an allowlisted SEO input creates a new source fingerprint and permits immediate analysis.

Recommendation provenance supports approve/dismiss/apply timestamps and later OLX views/watchers/messages/sale observations. Metrics must carry provider, observation time and freshness; missing metrics are unknown, never evidence of improvement.

## Staged improvement loop

1. Hermes may propose a new, immutable versioned profile candidate.
2. The candidate is evaluated offline and on a holdout against safety and quality criteria.
3. A human reviews the profile, evaluation and data provenance.
4. MarketDesk explicitly activates the approved version and retains rollback.

Hermes never edits or promotes a production prompt itself. Pricing, read-only competitor adapters, durable/background runs, and global catalogue execution are separate future stages.
