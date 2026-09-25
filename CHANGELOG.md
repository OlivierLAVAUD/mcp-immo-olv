# Changelog

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
