# Product traceability

This matrix tracks the canonical PRD in [`../design/MarketDesk PRD.dc.html`](../design/MarketDesk%20PRD.dc.html). Status describes the deployed product, not whether a route or component merely exists.

Status vocabulary:

- **Implemented** — original acceptance criteria are verified with code, tests and deployed evidence.
- **Partial** — a real subset works, but one or more acceptance criteria are missing.
- **Not implemented** — only a placeholder/mock exists or the capability is absent.
- **Docs only** — a product statement, not a runtime capability.

| PRD section | Contract | Status | Implementation / evidence | Active issue |
| --- | --- | --- | --- | --- |
| §1 | Product summary | Docs only | `docs/spec/PRODUCT.md` | #170 |
| §2 | Target users | Docs only | Canonical PRD personas | #170 |
| §3 | Product goals | Partial | Core workspace/product/listing flows exist; unified multi-channel outcome is OLX-only | #170, #174 |
| §4 | Information architecture | Partial | `src/frontend/App.tsx`, `src/frontend/utils/constants.ts`; extra top-level Listings route needs decision | #171 |
| §5 | Global app shell | Partial | `AppShell.tsx`, `TopBar.tsx`, `Sidebar.tsx`; deployed blank/duplicate header and brand gaps | #171 |
| §6 | Dashboard | Partial | `DashboardPage.tsx`; command-center blocks exist but visual/behavior acceptance remains open | #137 |
| §7 | Products catalogue | Partial | `ProductsPage.tsx`; catalogue exists without complete tabs, server controls, card view or bulk flows | #172 |
| §8 | Product creation wizard | Partial | `ProductWizardForm.tsx`; six steps exist without required upload/reorder/guidance/publish behavior | #138 |
| §9 | Analytics | Partial | `AnalyticsPage.tsx`; current KPI and report composition differs materially from contract | #173 |
| §10 | Hermes AI overview | Partial | `HermesActivityPage.tsx`; hero/tabs exist, configuration and truthful metrics remain incomplete | #139 |
| §11 | Hermes activity feed | Partial | `HermesEventCard.tsx`; review actions exist, icon/status anatomy and populated-flow acceptance remain open | #139 |
| §12 | Marketplaces | Partial | `MarketplacesPage.tsx`; OLX works, summary/grid/brand/roadmap surfaces are incomplete | #174 |
| §13 | Settings | Partial | `SettingsPage.tsx`; shell exists, several sections are placeholders or read-only | #140–#149 |
| §14 | Global interactions | Partial | Toasts/modals exist; global search, command palette, notifications, undo and autosave are incomplete | #171, #138 |
| §15 | Responsive behavior | Partial | MUI breakpoints exist; no current deployed visual evidence across required widths | #171 and per-screen issues |
| §16 | Accessibility | Partial | MUI semantics provide a baseline; keyboard/focus/contrast acceptance is not systematically covered | #171 and per-screen issues |
| §17 | Dark theme | Partial | Theme toggle works; per-screen parity and persistence remain incomplete | #146 and per-screen issues |
| §18 | Delivery and assets | Partial | HTML companion/screenshots are versioned; application brand/marketplace assets and visual regression evidence are incomplete | #171, #174 |

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
