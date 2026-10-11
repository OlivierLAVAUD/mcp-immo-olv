# Changelog

## Unreleased

### Added

- **Montpellier joins the rent-control registry.** `rent_control` now answers for
  Montpellier (INSEE 34172), the third area whose authority publishes an open
  reference grid. Montpellier keys its grid by IRIS (zone 1–5), so the point's
  IRIS is resolved first, exactly like Lyon. The grid itself is the metropole's
  yearly workbook (`MMM_MTP_Loyers.xlsx`, Zone1..Zone5 sheets) plus a GeoJSON
  mapping each IRIS to an OLL zone; a small dependency-free xlsx reader unpacks
  both. The zone is read from `zone_oll` and the reference / ceiling / floor
  from the zone's sheet, per furnished status. The strict format guard (fixed
  4 room groups × 5 periods, header shape) rejects anything it does not
  recognise rather than misreading it; a workbook outage degrades to "not
  covered" like any other source failure. The human `source_url` is the city's
  own dossier — the first montpellier3m.fr guess 301-redirected to the home
  page — and the smoke test HEADs it live. Verified live: Zone 1, T3, 1946-1970
  unfurnished → 12.3 / 14.8 / 8.6 €/m²/month, matching the published grid.

## 1.10.0 — 2026-10-11

### Added

- **Persistent disk cache (`IMMO_CACHE_DIR`).** When the variable points at a
  writable directory, parsed DVF commune/year rows are spilled to disk on the
  way out of the network — including the empty answer of a missing file — and
  the next process hydrates its memory cache from those files instead of
  re-downloading and re-parsing: a Paris arrondissement hydrates in ~13 ms,
  cold, where the same call cost ~530 ms on the network. No directory, no
  behavior change — this stays process-local. Disk writes are fire-and-forget,
  files are timestamped envelopes (TTL travels with the data), writes are
  atomic via tmp+rename, caller keys are filename-sanitized, and folders are
  pruned of expired files past the file cap. Any disk failure degrades silently
  to memory-only; the tools never learn the directory existed. Covered by
  offline tests (round-trip, TTL, corrupt file, unset or unwritable directory,
  traversal guard, cold-start and 404-remembrance proof) and a live
  same-number cold-start comparison.

- **Streamable HTTP transport.** Setting `IMMO_HTTP_PORT` switches the same
  tool registry from stdio to the MCP Streamable HTTP transport, so the server
  can be hosted, shared or reached by a client that cannot spawn a subprocess.
  `IMMO_HTTP_HOST` sets the bind address (loopback by default, as an
  unauthenticated MCP server exposes the whole tool surface). Each session
  (`initialize`) gets its own server + transport pair, routed by the
  `Mcp-Session-Id` header; unknown sessions answer 404. Tools answer in direct
  JSON — every tool is one request/response, no server-initiated stream. stdio
  stays the default: without the variable, nothing changes for the clients that
  spawn the package. Covered by integration tests (a real MCP client over a
  local socket, five assertions) plus a live curl check.

## 1.9.0 — 2026-10-11

### Fixed

- **A tram platform is no longer silenced by an unrelated stop of another mode
  that shares its name.** The name rule of the platform deduplication compared
  against every kept stop in the category: a bus stop named "Avenue de la Gare"
  400 m away made a tram platform of the same name — the only mapping of that
  tram stop — count for nothing. Names are now kept per mode, matching what the
  proximity rule already did: a platform is held back only when a stop *of its
  own mode* repeats its name or stands within 60 m of it. The distance rule and
  the unnamed-platform rule are unchanged.

### Changed

- **`nearby_amenities` fails fast instead of failing late.** The Overpass query
  carries `[timeout:10]` and each mirror gets a single 12 s attempt: the second
  mirror is already the retry, so a struggling mirror no longer burns 3 × 25 s
  before failover. Worst case for the tool drops from ~150 s (2 mirrors × 3
  attempts × 25 s + backoff) to ~25 s, and both mirrors down still answers
  `available: false` with every count `null` — never an empty neighbourhood.
- **BAN and geo.api.gouv.fr get an 8 s, 2-attempt leash.** A geocoder answers in
  under a second when healthy; the 25 s × 3 retry policy stays where it belongs
  — multi-MB DVF commune CSVs — and no longer sets the floor on a geocoding
  outage. `fetchJson` takes optional per-source `timeoutMs` / `attempts`;
  defaults are unchanged.
- **`nearby_amenities` now answers public transport per mode.** The `transports`
  category carries a `modes` breakdown (train, métro, tram, bus), each with its
  own count and its closest objects. A single total mixed a bus stop 30 m away
  with a tram stop 400 m away, and the closest list — sorted by distance — could
  push the tram out of it. Both cache-hit and outage paths keep the same shape:
  on an Overpass outage every mode count is `null`, never 0, or the answer would
  claim "no tram here".
- **Tram stops mapped as a platform alone are now counted.** `public_transport`
  / `railway` platforms tagged `tram=yes` are queried too, so a stop OSM has not
  given a `railway=tram_stop` node is still answered (Bordeaux's Hôtel de Ville,
  served by lines A, B and F, was missing). A platform is held back when it only
  repeats a stop already counted — same name, or standing within 60 m of a stop
  of its own mode, which catches the platform named after its street rather than
  the stop (Montpellier's "Avenue Henri Frenay" is the Du Guesclin stop).
  Unnamed platforms are left out: they cannot be attributed to any stop. Across
  six tram cities this adds exactly one stop to the count, and no duplicate.

## 1.8.1 — 2026-10-10

### Changed

- Release plumbing only, no code change since 1.8.0. A tag now publishes to npm
  through GitHub Actions **trusted publishing** (OIDC) instead of a stored token,
  and npm generates a provenance attestation for the published package. This
  release exists to validate that trusted-publisher configuration against
  `publish.yml`; it also carries the repository re-creation that dropped the
  legacy commit objects, so older commit URLs no longer resolve.

## 1.8.0 — 2026-10-09

### Added

- **`nearby_amenities`, the 21st tool.** What is around a French address, from
  OpenStreetMap through the Overpass API: public transport (train, metro, tram,
  bus stop), schools and higher education, everyday shops, health (pharmacy,
  doctor, hospital) and green / sport space. For each category it returns how
  many objects fall within the radius (100 m – 5 km, default 1 km) and the
  closest ones, in metres as the crow flies, each one carrying its OSM id so a
  claim can be checked at the source. Two Overpass mirrors are tried in order;
  when neither answers, every `count` is `null` — UNKNOWN, never an empty
  neighbourhood. Query clauses and category classification are derived from one
  table (`src/apis/overpass.ts`), so a category cannot be queried without being
  classified. Source: OpenStreetMap contributors, ODbL.
- README documents the tool, its ODbL attribution and the honesty rule, and the
  skill tells a client never to read an empty category as a real absence;
  `npm run smoke` and `npm run examples` now cover it live.
- **`Prompts.md`**: example usage prompts for all 21 tools, grouped by need and
  by end-to-end scenario, with attachments for the plugin commands and a section
  of prompts that test the guardrails (unreachable source reads unknown, fewer
  than three comparables, unknown address).
- The captured example outputs move out of the README into **EXAMPLES.md** — one
  numbered block per tool, each stating what its output proves, kept in step
  with `npm run examples` which replays and checks them. README keeps a pointer,
  and the file ships with the npm package so that pointer resolves on npm too.

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
- Two source URLs handed to clients in `rent_control.source_url` had gone 404
  (`paris.fr`, `grandlyon.com`); both now point at the live official pages, and
  `npm run smoke` HEADs every source URL the server emits, failing on a
  definitive 404/410 while treating a 5xx or a timeout as upstream trouble. The
  README sources table links each dataset to its official reference page.

### Verification by example

- `npm run examples` drives the built server over the real `stdio` transport and
  both prints and checks the live output, example by example: the risk digest
  (including the unreachable-source branch reading **unknown**), the side-by-side
  comparison, the inverse budget search, the batch envelope with a failing
  address isolated, the Markdown export, and the malformed-batch messages.
  EXAMPLES.md carries the captured outputs.

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
