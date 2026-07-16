# Product traceability

This matrix tracks the canonical PRD in [`../design/MarketDesk PRD.dc.html`](../design/MarketDesk%20PRD.dc.html). Status describes the deployed product, not whether a route or component merely exists.

Status vocabulary:

- **Implemented** — original acceptance criteria are verified with code, tests and deployed evidence.
- **Partial** — a real subset works, but one or more acceptance criteria are missing.
- **Not implemented** — only a placeholder/mock exists or the capability is absent.
- **Docs only** — a product statement, not a runtime capability.

| PRD section | Contract | Status | Implementation evidence | Tests / verification evidence | Acceptance state / tracking |
| --- | --- | --- | --- | --- | --- |
| §1 | Product summary | Docs only | `docs/spec/PRODUCT.md` | `npm run verify:spec` | Delivered by #175; closes #170 |
| §2 | Target users | Docs only | `docs/design/MarketDesk PRD.dc.html` personas | `npm run verify:spec` | Delivered by #175; closes #170 |
| §3 | Product goals | Partial | `src/backend/presentation/http/controllers`, `src/frontend/pages` | `src/backend/presentation/__tests__/api.integration.test.ts`; live QA audit 2026-07-16 | Open gaps: #170, #174 |
| §4 | Information architecture | Partial | `src/frontend/App.tsx`, `src/frontend/utils/constants.ts` | Live QA route/navigation audit 2026-07-16 | Open gap: #171 |
| §5 | Global app shell | Partial | `src/frontend/components/layout/AppShell.tsx`, `TopBar.tsx`, `Sidebar.tsx` | Live light/dark QA audit 2026-07-16 | Open gap: #171 |
| §6 | Dashboard | Partial | `src/frontend/pages/DashboardPage.tsx` | Live empty-workspace audit 2026-07-16 | Open gap: #137 |
| §7 | Products catalogue | Partial | `src/frontend/pages/ProductsPage.tsx` | Live empty-workspace audit 2026-07-16; table unit coverage | Open gap: #172 |
| §8 | Product creation wizard | Partial | `src/frontend/components/forms/ProductWizardForm.tsx` | Live six-step/validation audit 2026-07-16 | Open gap: #138 |
| §9 | Analytics | Partial | `src/frontend/pages/AnalyticsPage.tsx` | `src/frontend/pages/AnalyticsPage.test.tsx`; live KPI/layout audit 2026-07-16 | Open gap: #173 |
| §10 | Hermes AI overview | Partial | `src/frontend/pages/HermesActivityPage.tsx` | Live run/empty-state audit 2026-07-16 | Open gap: #139 |
| §11 | Hermes activity feed | Partial | `src/frontend/components/hermes/HermesEventCard.tsx` | Existing API event tests; populated visual flow not yet verified | Open gap: #139 |
| §12 | Marketplaces | Partial | `src/frontend/pages/MarketplacesPage.tsx`, `src/backend/infrastructure/adapters/OLXAdapter.ts` | `src/frontend/pages/MarketplacesPage.test.tsx`; live OLX-only audit 2026-07-16 | Open gap: #174 |
| §13 | Settings | Partial | `src/frontend/pages/SettingsPage.tsx` | `src/frontend/pages/SettingsPage.test.tsx`; live section audit 2026-07-16 | Open gaps: #140–#149 |
| §14 | Global interactions | Partial | `src/frontend/components/common`, `src/frontend/state/slices/uiSlice.ts` | Existing component tests; live toast/theme audit 2026-07-16 | Open gaps: #171, #138 |
| §15 | Responsive behavior | Partial | MUI breakpoints across `src/frontend` | No complete required-width visual evidence yet | Open per-screen gaps: #137–#150, #171–#174 |
| §16 | Accessibility | Partial | MUI semantics and accessible labels across `src/frontend` | No systematic keyboard/focus/contrast acceptance run yet | Open per-screen gaps: #137–#150, #171–#174 |
| §17 | Dark theme | Partial | `src/frontend/theme`, `src/frontend/state/slices/uiSlice.ts` | Live dark-theme audit 2026-07-16; persistence code review | Open gap: #146 and per-screen issues |
| §18 | Delivery and assets | Partial | `docs/design`, `docs/design/screenshots` | `npm run verify:spec`; curated screenshots present | Open gaps: #171, #174 |

## Screen acceptance map

| Screen | Canonical visual state | Route/code | Minimum verification before closing |
| --- | --- | --- | --- |
| Dashboard | Companion Dashboard | `/`, `DashboardPage.tsx` | populated and empty dashboard; real quick actions; light/dark/narrow evidence |
| Products | `screenshots/products.png` | `/products`, `ProductsPage.tsx` | server search/filter/sort, tabs/counts, list/card, selection/bulk, pagination |
| New product | Companion six-step wizard | `/products?newProduct=1`, `ProductWizardForm.tsx` | upload/reorder/cover, field validation, AI review path, marketplace readiness, final review/publish |
| Analytics | `screenshots/analytics.png` | `/analytics`, `AnalyticsPage.tsx` | canonical KPI mapping, date/marketplace controls, charts, export, empty/error states |
| Hermes AI | Companion Hermes AI | `/hermes`, `HermesActivityPage.tsx` | truthful metrics, configure path, typed event icons, approve/dismiss/view populated flow |
| Marketplaces | Companion Marketplaces | `/marketplaces`, `MarketplacesPage.tsx` | honest OLX + roadmap grid, summary, brand assets, connect/sync/error states |
| Settings | Companion Settings sections | `/settings`, `SettingsPage.tsx` | every section backed by a real contract or approved disabled deviation; save/cancel/reload |
| Product detail | Companion detail screen | `/products/:productId`, `ListingDetailsPage.tsx` | populated gallery, pricing, stats, status, history, timeline, recommendations and activity |

## Maintenance

Update this file in the same PR whenever product behavior, maturity, route ownership or acceptance status changes. Do not mark a row **Implemented** without a linked issue/PR and verification evidence.
