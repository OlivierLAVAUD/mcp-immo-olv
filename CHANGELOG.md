# Changelog

## 1.7.0 — 2026-10-09

### Added

- **Batch dossiers** (`property_report` with `addresses`). The tool now takes 2
  to 5 addresses instead of one and returns a full dossier per address under
  `reports`, each tagged with the `input_address` it answers. Every address is
  isolated: one that cannot be resolved returns its own `error` and leaves the
  others intact — the same rule that keeps a failed section from taking its
  neighbours down inside one dossier. The shared profile (`type_local`,
  `surface_m2`, `rooms`, `format`) applies to every address.
- **Risk digest** (`risk_summary`, the 20th tool). One plain-language sentence
  per risk — flood, clay shrink-swell, radon, industrial sites (ICPE) — plus
  the DPE rental-ban status, a one-sentence headline, and any other present
  risk named in `other_present_risks` so nothing is hidden. Reuses Géorisques
  and ADEME. When Géorisques is unreachable every risk line reads **unknown**,
  never a clean bill of health; a DPE left unchecked, missing or unreadable
  says so too. Pure summariser in `src/risk-summary.ts`.
- The `property_report` output schema now declares the batch envelope. Tests
  cover the argument rules, per-address isolation and the SDK validation of the
  envelope (`test/report.test.ts`), and the digest's present / absent / unknown
  branches (`test/risk-summary.test.ts`).

### Fixed

- The `risk_summary` headline no longer lowercases acronyms — it reads
  `sites industriels (ICPE)`, not `(icpe)` — and a status Géorisques reports
  identically at the address and in the commune is stated once instead of twice.
  Both were visible in the live output, not caught by assertions.
- A batch outside its 2–5 bound now fails with an actionable message naming the
  limit (`property_report.addresses`, `compare_properties.targets`) instead of a
  raw `Array must contain at least 2 element(s)` zod violation.

### Verification by example

- `npm run examples` drives the built server over the real `stdio` transport and
  both prints and checks the live output of the three new capabilities: the risk
  digest (including the unreachable-source branch reading **unknown**), the batch
  envelope with a failing address isolated, and the Markdown export. README
  carries the captured outputs under *Exemples*.

## 1.6.0 — 2026-10-09

### Added

- **Markdown export of the dossier.** `property_report` accepts
  `format: "markdown"` and renders the same structured dossier as shareable
  Markdown — a memo, an email, a note — through a pure function
  (`src/markdown.ts`) that touches no network. Every figure keeps the meaning
  it has in the JSON payload: a section that failed is reported as unavailable
  with its reason, and an unreachable Géorisques stays an explicit **unknown**
  rather than "no risk". The footer carries the sources and the standing
  disclaimer (open-data analysis, not a professional appraisal).
- The `property_report` output schema now declares both shapes: the structured
  form with every section, and the Markdown form as a single `content` string.
  Each section is `.optional()` because the two are disjoint. Tests cover the
  recorded Lyon dossier and the degradation cases (`test/markdown.test.ts`).

### Fixed

- README: the structured-output section said "16 outils" while 19 are
  registered.

## 1.5.0 — 2026-10-09

### Added

- **Budget search** (`search_by_budget`, the 19th tool) — the inverse of the
  estimator. Given a budget, a dwelling type and a zone (commune name, INSEE
  code, address or département code), it scans the most populous communes of
  the département, computes each median €/m² from actual notarized sales over
  the last 4 published DVF years, and divides the budget by it: the surface
  the budget buys. It layers the modelled asking rent for a gross yield and
  returns three rankings — most surface, best yield, cheapest market — plus
  the communes skipped for lack of data.
- Honest limits, stated in the payload: the budget is the purchase price only
  (fees come on top — `acquisition_costs` computes them), at most
  `max_communes` (default 15) are scanned most-populous-first, and a commune
  with too few sales is listed in `not_enough_data`, never merged into the
  ranking. Live check on the Rhône: 300 k€ buys 67 m² in Lyon (4,4 % yield)
  versus 123 m² in Villefranche-sur-Saône.
- `src/handlers/budget.ts` + `communesByDepartement` in `src/apis/communes.ts`
  + tests (`test/budget.test.ts`).

## 1.4.0 — 2026-10-09

### Added

- **Acquisition costs simulator** (`acquisition_costs`, the 18th tool). From an
  address, a dwelling type and a surface (or a known price), it returns the
  upfront costs — droits de mutation on the official 2026 scale (4.50 % base
  + 0.7163 % department + 1.204 % commune, about 6.42 %), notary fees on the
  standard "garantie civile" card (750 € per deed + 50 €/hour, with
  `hands_off` and `aggressive` alternatives), publication — plus the
  commune-average taxe foncière (REI), the modelled asking rent and the gross,
  net and after-fees yields. `price_from` marks what the price is
  (`estimate` by default, `agreed` or `asking` when supplied).
- Every limit is stated in the payload: the taxe foncière is a commune
  average, never an individual tax notice; rents are modelled asking rents,
  not regulated reference rents; all figures are indicative. An OFGL outage
  degrades the tax to 0 rather than killing the simulation.
- `src/handlers/acquisition.ts` + 4 tests (`test/acquisition.test.ts`), fee
  arithmetic validated against the statutory scale.

## 1.3.0 — 2026-10-09

### Added

- **Side-by-side address comparison** (`compare_properties`, the 17th tool).
  Compares 2 to 5 addresses in one call — current market level (€/m²), the
  comparables estimate with confidence, asking rents, the latest DPE with its
  legal rental status and energy cost — plus row-index rankings (cheapest
  market, best yield). Reuses the individual tools' handlers so the numbers
  cannot drift, and degrades per section like `property_report`. The isolation
  helper moved into the shared handlers so both tools use the same one.
- `src/handlers/compare.ts`: composition + pure `buildRankings` (tests in
  `test/compare.test.ts`, including a two-cluster end-to-end comparison and a
  dead-address degradation case).

## 1.2.0 — 2026-10-09

### Added

- **DPE rental compliance and energy cost** (`dpe_lookup`). Every diagnostic now
  carries `rental_compliance` — the legal status of a main-residence lease at
  its energy label, per décret n° 2024-501 (G/H banned since 2025-01-01,
  F from 2028-01-01, E from 2034-01-01): `louable`, `bientot_interdit` with its
  `ban_date`, `interdit`, or `inconnu` when the label is missing — never a
  silent "lettable". Plus `is_passoire_thermique` (official F/G wording) and
  `annual_energy_cost`, the DPE consumption monetised at a tariff assumption
  (`energy_price_eur_kwh`, default 0.2562 €/kWh).
- `src/dpe-compliance.ts`: pure, unit-tested module (9 tests) holding the ban
  schedule and the cost computation, so the legal dates live in one auditable
  place.

## 1.1.0 — 2026-09-25

### Added

- **Structured tool output.** All 16 tools now declare the JSON Schema of what
  they return (`outputSchema`, MCP 2025-06-18) and answer with a validated
  `structuredContent` object, so a client can type and render a result instead of
  parsing a JSON string. The text block is still emitted for clients that predate
  the revision. The schemas are open (`additionalProperties: true`): a field added
  upstream cannot invalidate a tool.
- 16 contract tests (`test/output-schemas.test.ts`) covering the published
  `tools/list` schemas, an in-memory call through the real SDK, a tool failure
  that stays a failure, and the recorded Lyon dossier replayed against the
  schemas. `npm run smoke` now validates every live payload against the same
  contracts.
- `src/server.ts`: the tool registry is built by `createServer()` and can be
  attached to any transport, which is what makes the contracts testable. The
  entry point only connects stdio.

### Changed

- The web console reads `structuredContent` when the server provides it, and falls
  back to parsing the text block otherwise.

## 1.0.3 — 2026-09-25

### Fixed

- **An unreachable Géorisques no longer reads as "no risk".** The ministry's
  API answers HTTP 503 during whole-site incidents, and `natural_risks`
  surfaced that as a hard failure while `property_report` reported its `risks`
  section as an error. The client now degrades explicitly — `available: false`,
  the reason, and a link to the official portal — and the handler states that
  the status at that address is **unknown**, not absent. A 4xx still throws,
  because that means the request itself was wrong.

### Added

- `available` on the risk report, so a client can tell "nothing is known" from
  "nothing was found" without parsing prose.
- Continuous integration: build and unit tests on Node 18, 20, 22 and 24, plus
  a build of the local console.
- A scheduled live smoke job (Mondays) covering every tool end to end, and a
  tag-triggered release workflow publishing to npm and the MCP registry through
  OIDC, with no stored token.

### Changed

- The live smoke test counts `available: false` as a failure, so an upstream
  outage keeps showing up in CI instead of passing quietly; the console renders
  a warning rather than "aucun risque signalé à cette adresse".

## 1.0.2 — 2026-09-25

### Added

- **Published to the official MCP registry** as
  `io.github.OlivierLAVAUD/mcp-immo`, so a client that resolves servers from the
  registry finds it by name. The registry proves package ownership through an
  `mcpName` marker, which `package.json` now carries.

### Changed

- `server.json` migrated to the current registry schema (`2025-12-11`):
  camelCase `registryType`, a `repository` object in place of `repositoryUrl`,
  and a description trimmed to the registry's 100-character limit.

## 1.0.1 — 2026-09-25

### Fixed

- **The version identifiers had drifted apart**: `package.json` said 1.0.0 while
  `src/version.ts` and `server.json` still said 0.5.1, so every published build
  advertised a stale version in its HTTP `User-Agent`. The four now move
  together, and the release workflow refuses to publish when they disagree.

### Changed

- `LICENSE` reduced to the project's own copyright notice.

## 1.0.0 — 2026-09-15

### Notes

- **No functional change over 0.5.1.** Comparing the published tarballs, only
  the version field and the README introduction differ; `dist/` is
  byte-identical to 0.5.1.

## 0.6.0 — 2026-09-15

### Notes

- Version bump only: identical to 0.5.1. Never published to npm, no longer
  tagged, superseded by 1.0.0 the same day. The 0.5.2 bump in between has the
  same status.

## 0.5.1 — 2026-09-15

### Changed

- **Handlers refactored into domain modules** (`market`, `valuation`, `context`,
  `report`); runtime version centralized in `src/version.ts`; duplicated MCP
  tool schemas deduplicated via shared fragments.
- Package metadata now declares the source repository (`repository`, `homepage`,
  `bugs` in `package.json`, `repositoryUrl` in `server.json`).

## 0.5.0 — 2026-09-14

### Added

- **`backtest_estimator`.** Walk-forward backtest of the comparables engine:
  every historical sale is re-valued using only the sales recorded before it
  (own deed excluded, future market levels impossible to leak in), then scored
  against the price actually paid. Reports MAPE, median and 90th-percentile
  absolute error, signed bias, P25–P75 interval coverage, and the same metrics
  by surface band and by year. The `estimate_property` engine gained the
  `asOf` / `excludeIds` options that make this honest.
- **`cadastral_parcel`.** Official cadastral parcel at an address: unique
  cadastral id (`idu`), section, number and the taxed `contenance` in m².
  Source: IGN / DGFiP PCI, via API Carto.
- **`urbanism_zoning`.** Urbanism zoning and prescriptions from the Géoportail
  de l'urbanisme: zoning label and type (U / AU / A / N), regulation document,
  and the surface, linear and point prescriptions. States which rules apply —
  never whether a project is permitted.
- **`iris_lookup`.** The IRIS — INSEE's infra-communal statistical unit —
  containing an address, with its 9-character code, name, type and commune.
  Boundaries: IGN ADMINEXPRESS.
- **`rent_control`.** Loyer de référence, majoré (legal ceiling) and minoré per
  m² per month, by rooms, construction period and furnished status, for the
  areas whose authority publishes an open grid (Paris, Métropole de Lyon). An
  address outside a covered area gets an explicit "not covered" answer.
- **DPE neuf.** `dpe_lookup` now queries both `dpe03existant` and `dpe02neuf`,
  tags each row with its register, and accepts a `dataset` filter.
- `property_report` gained `cadastre`, `urbanism`, `iris` and `rent_control`
  sections, each isolated so one upstream outage degrades one block only.

### Notes

- **DVF coverage is unchanged, and stated explicitly.** The geo-dvf
  distribution publishes geolocated sales from 2021 onwards only. Pre-2021 DVF
  exists as all-France, non-geolocated per-year archives, which cannot back a
  per-address radius or comparables query; the Cerema DVF+ publishing channel
  has no machine-readable endpoint. Year handling stays data-driven, so new
  millésimes are picked up automatically without a code change.

## 0.4.0 — 2026-09-14

### Added

- **Parsed DVF LRU cache.** Repeated commune/year reads now reuse parsed rows
  for 24 hours (up to 64 entries), avoiding both public-data downloads and CSV
  parsing. Concurrent reads still collapse to a single request.
- **`property_tax_estimate`.** Commune-level average annual tax context from
  the official DGFiP REI fiscal dataset, queried through OFGL's public API.
  It returns communal, intercommunal, syndicate, GEMAPI and TEOM components
  whenever they are published.
- **Yield after average property tax.** `estimate_property` and
  `property_report` now report a clearly qualified yield after the REI average
  charge. It is not an individual taxe foncière bill.
- Local React console (`ui/`) to inspect the full dossier and every MCP tool.

### Changed

- Project stewardship and package metadata are now maintained by **Olivier
  LAVAUD**.
- The server is identified as `mcp-immo-olv` for future local/npm use. Confirm
  npm-name availability before publishing.

## 0.3.0 — 2026-08-17

### Fixed

- Concurrent requests for an identical public-data URL share a single fetch.
- Transient upstream errors (429, 5xx and network timeouts) retry with
  exponential backoff; 404 and 403 remain meaningful DVF no-data answers.

## Earlier releases

Earlier releases introduced the transparent comparable-sales valuation,
official rent indicators, due-diligence report, boundary-aware DVF search,
DPE, natural-risk and commune tools.
