# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `ValidationError` (added in 1.2.0) was never re-exported from `src/index.ts`, so
  consumers had no way to `instanceof`-check it despite the 1.2.0 changelog entry
  saying it was exported. Now exported from the package root.

## [1.2.0] - 2026-08-28

### Added

- Semantic validation of data read from the unit, via JSON Schema (`src/schemas/*.schema.json`)
  validated with `ajv`. Catches protocol decode bugs (wrong buffer offset, endianness, a
  corrupted response) that would otherwise silently produce a nonsensical value — e.g. a
  6000°C sensor reading, a >100% fan speed, or a 32nd day of the month — by throwing a
  `ValidationError` instead. Applied to `getSensorReadings()`, the fan speed and supply
  temperature setpoint getters, `getRhThreshold()`/`getCo2Threshold()`,
  `getFilterDaysRemaining()`/`getFilterChangeInterval()`, `getFaults()`, `getUptime()`, and
  `getDeviceTime()` (validated before constructing the `Date`, so an out-of-range component
  like `month=13` is rejected rather than silently rolling over into a wrong date). New
  `ValidationError` export from `src/validation.ts`.

### Fixed

- `WebSocketTransport` cache stampede: concurrent calls that all saw a stale register cache
  each independently opened their own WebSocket connection to fetch it, rather than sharing
  one in-flight fetch. Against real hardware, whose embedded web server can only handle a
  handful of simultaneous connections, this caused `ECONNRESET`/"socket hang up" failures
  under bursts of concurrent reads (observed: 5 concurrent → 1 failure, 20 concurrent → 14
  failures) — easily triggered by any consumer issuing several `ValloxClient` calls at once.
  Concurrent callers now share a single in-flight `READ_TABLES` fetch; verified against real
  hardware with zero failures across 49 concurrent calls (bursts of 5/10/14/20) that
  previously failed at every burst size.

## [1.1.0] - 2026-08-27

### Added

- `getSerialNumber()` / `vallox serial` — reads the unit's serial number from the
  `SERIAL_NUMBER_MSW`/`SERIAL_NUMBER_LSW` register pair.
- `getUptime()` / `vallox uptime` — reads cumulative lifetime runtime and runtime
  since the unit's most recent power-on, in hours. Exposed via the new `UnitUptime` type.
- `getFilterChangeInterval()` / `setFilterChangeInterval()` and
  `vallox filter interval` / `vallox filter set-interval <days>` — read/write the
  configured filter change interval in days.
- `npm run docs` — generates HTML API documentation from source JSDoc comments via
  TypeDoc (see `typedoc.json`). Run through a pinned `npx` TypeDoc/TypeScript pair
  rather than as a devDependency, since the project's own `typescript` (`^7.0.2`)
  doesn't yet expose the Compiler API TypeDoc needs. The generated `docs/` output and
  `typedoc.json` are excluded from the published package via `.npmignore`.

### Fixed

- Published package included compiled test files (`dist/__tests__/**`, with
  sourcemaps) — dead weight for consumers, now excluded via `.npmignore`.

### Security

- Bumped `ws` (the runtime WebSocket dependency used by `WebSocketTransport`) from
  7.5.10 to 7.5.13, fixing a memory exhaustion DoS via tiny fragments and data chunks
  ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)).
- Updated dev-only transitive dependencies (`@babel/*`, `browserslist`, `caniuse-lite`,
  `js-yaml`, `picomatch`, `brace-expansion`, and others) via `npm audit fix`, resolving
  several high-severity advisories (ReDoS/DoS) in the test/build toolchain. These do
  not affect published package consumers.

## [1.0.0] - 2026-08-27

Initial release.

### Added

- `ValloxClient`, a typed API client covering:
  - Power control, basic Home/Away mode, and timed profiles (Boost, Fireplace, Extra)
  - Sensor readings (extract/exhaust/outdoor/supply temperatures, humidity, CO₂)
  - Per-profile fan speed and supply air temperature setpoints
  - RH/CO2 automatic speed-boost thresholds
  - Heat recovery cell status and defrost control
  - Fault log reading and acknowledgement
  - Weekly schedule read/write
  - Device clock read/write
  - Filter maintenance (days remaining, record filter changed)
  - Raw register read/write access
- Two `Transport` implementations:
  - `WebSocketTransport` — the proprietary binary WebSocket protocol exposed by the
    unit's built-in web server
  - `ModbusRtuTransport` — standard Modbus RTU over RS-485 (any Node.js `Duplex`
    stream, e.g. a serial port)
- `vallox` CLI for direct shell use, covering all of the above, plus `--json` output
  and a WebSocket-only history log command (`history`, with CSV export).

[Unreleased]: https://github.com/simonarnell/vallox.js/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/simonarnell/vallox.js/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/simonarnell/vallox.js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/simonarnell/vallox.js/releases/tag/v1.0.0
