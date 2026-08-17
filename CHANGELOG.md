# Changelog

## 0.3.0 — 2026-08-17

### Fixed
- **Intermittent `property_report` section failures.** The tool fans out to
  seven sections at once and each independently geocoded the same address and
  downloaded the same commune CSVs. The value cache could not help — no call
  had resolved yet — so identical requests hit the public open-data endpoints
  simultaneously. That thundering herd made the weekly live smoke test fail
  roughly one run in three, with a different section erroring each time.
  Requests are now coalesced: concurrent calls for the same URL share a single
  fetch.
- Transient upstream errors (429 and 5xx responses, network timeouts) are now
  retried up to three times with exponential backoff and jitter. 404 and 403
  are not retried — for DVF they are a meaningful "no data for this
  commune-year" answer.

### Changed
- Repository URLs point at `github.com/zedd75/mcp-imo` (the npm package name
  is unchanged).

## 0.2.0 — 2026-07-16

### Added
- `estimate_property`: transparent comparables-based valuation (weighted median,
  year-level market adjustment, auditable comps, Kish effective sample size,
  confidence rating) with official rent indicator and gross yield.
- `rent_estimate`: Carte des loyers 2025 indicators (apartments overall, 1–2
  rooms, 3+ rooms, houses) for any commune.
- `property_report`: one-call full due-diligence dossier (market, sales,
  valuation, rent, DPE, risks, commune) with independently failing sections.
- Boundary-aware radius search: queries near a commune border now fan out to
  every commune the radius touches (8-point compass probe).
- `price_per_m2` now reports a trailing-12-months block alongside the
  all-period and per-year statistics.
- DVF years are discovered dynamically (future vintages picked up without a
  code change).

### Fixed
- City-wide queries on Paris, Lyon and Marseille returned zero sales: the
  geo-dvf distribution has no city-level file for them. City codes are now
  expanded to all municipal arrondissements.
- HTTP requests now carry a 25 s timeout; the response cache is a true LRU.

## 0.1.0 — 2026-07-16

Initial release: `geocode_address`, `reverse_geocode`, `property_sales`,
`price_per_m2`, `dpe_lookup`, `natural_risks`, `commune_info` over DVF, BAN,
ADEME, Géorisques and geo.api.gouv.fr. Unit tests, live smoke suite, CI.
