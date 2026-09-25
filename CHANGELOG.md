# Changelog

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
