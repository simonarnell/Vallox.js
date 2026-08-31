# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `FAULT_DESCRIPTIONS` entries were unverifiable against any authoritative source and some didn't match genuine firmware text. Replaced with 7 entries confirmed directly from the unit's firmware (`HSWUPD.BIN`, unpacked with [hn/vallox-ventilation-unit](https://github.com/hn/vallox-ventilation-unit)'s `unpack-vallox-firmware.pl`); the rest correctly resolve to `'Unknown fault'`, matching the unit's own web UI, which shows no description for most codes either.

## [1.7.0] - 2026-08-31

### Added

- `ScheduleSlot.CUSTOM` (4) and `ScheduleSlot.STANDBY` (5), and a runtime `ScheduleSlot` object (previously a type-only union `0 | 1 | 2 | 3`) mirroring the existing `Mode`/`Profile` pattern. Reverse-engineered from a live unit: clicking through a weekly schedule cell's states while reading back the underlying register showed the cycle is None→Home→Away→Boost→Custom→Standby, six states in total — Automatic is never offered as a schedule slot. `STANDBY` was confirmed to power the unit off for that hour: enabling the weekly schedule with a Standby slot active caused the unit's `ON_OFF` register to flip to `POWER_OFF` within seconds.

### Fixed

- `ValloxClient.getWeeklySchedule()` collapsed any schedule register value other than `1`/`2`/`3` (Home/Away/Boost) into `0` (None) — including `4` (Custom) and `5` (Standby), which it would have silently misreported as an empty slot. Now returns the real value. Callers that treat a schedule slot as a direct index into a fixed 0–3-sized lookup (e.g. an icon/label array sized for the old 4-value range) should size it for 0–5 instead.

## [1.6.0] - 2026-08-31

### Added

- `Mode.AUTOMATIC` and `Profile.AUTOMATIC`, supporting the "Automatic" ventilation mode added in unit firmware 3.1.4. The unit dynamically adjusts fan speed itself rather than following a fixed per-mode setting. Reverse-engineered from a live unit's WebSocket traffic (capturing the WRITE_DATA frame sent when selecting "Automatic" in the unit's own web UI) — encoded as `HOME_AWAY` (STATE) register value `2`, alongside the existing Home (0) and Away (1). Neither the Modbus RTU manual nor Vallox's firmware changelog document the register encoding, only that the feature exists.
- `Profile.CUSTOM`, an alias for the existing `Profile.FIREPLACE` (same value, 4) matching the name the unit's own firmware and web UI/app have used since 2.0.20 ("Fireplace mode is renamed to Custom"). `vallox.js` already used "Custom" internally (`setCustomMode()`, `CUSTOM_TIMER`, etc.) — only the `Profile` enum name lagged behind.
- `vallox` CLI: `mode set` now accepts `automatic` (previously only `home`/`away`), and `profile set`/`profile get` recognize `custom`/`CUSTOM` and `automatic`/`AUTOMATIC`.
- `MockValloxServer` (`vallox.js/testing`) now accepts a `host` option (default `'127.0.0.1'`, matching prior behavior) so it can bind to `'0.0.0.0'` and accept connections from other hosts — e.g. a Docker container or a browser-driven integration test reaching it via `host.docker.internal`.

### Fixed

- `ValloxClient.getMode()` collapsed any `HOME_AWAY` register value other than `1` (Away) into `Mode.HOME` — including `2` (Automatic), which it would have silently misreported as Home. Now correctly distinguishes all three.
- `vallox` CLI: `mode get` labeled any mode other than Away as `"home"`, including Automatic. `mode set <name>` silently coerced any unrecognized argument (including `automatic`, before this release added support for it) to `home` instead of reporting an error.

### Deprecated

- `Profile.FIREPLACE`, in favor of `Profile.CUSTOM` (same value — no behavior change, no migration required beyond preferring the new name in new code).

## [1.5.0] - 2026-08-31

### Added

- `MockValloxServer`, exported from the new `vallox.js/testing` subpath: a real WebSocket server speaking the same READ_TABLES/WRITE_DATA/LOG_RAW binary protocol as a physical unit, for integration-testing consumers (e.g. `homebridge-vallox-redux`) against a real socket instead of a hand-mocked `ws` client. Built on `WebSocketTransport`'s own buffer-layout logic (`WS_REGIONS`, `addressToBufferIndex`, and related constants are now exported from `transport/websocket.ts`) so the mock can't drift from the real parser.
- `ValloxClient.getSerialNumber()` now accepts an optional `base` argument (`'hex'`, the existing default, or `'decimal'`), replacing the need for a separate decimal-formatted method.

### Changed

- `ws` bumped from `^7.3.1` to `^8.18.0`, fixing a latent mismatch with the already-installed `@types/ws@8.18.1` (harmless until `mock-server.ts` needed a value-level import of `WebSocketServer`, which only exists in the v8 typings/runtime).

### Deprecated

- `ValloxClient.getSerialNumberDecimal()`, in favor of `getSerialNumber('decimal')`. Still works (delegates to the new overload) but will be removed in a future major version.

## [1.4.0] - 2026-08-30

### Added

- `ValloxClient.getSerialNumberDecimal()`, returning the same serial number as `getSerialNumber()` but formatted as decimal (e.g. "2524262093") rather than hex, matching how the unit's own dashboard displays it.

## [1.3.0] - 2026-08-30

### Added

- `ValloxClient.getModel()`, `getMachineType()`, and `getSoftwareVersion()`, exposing the unit's model name (e.g. "Vallox 110 MV"), type designation (e.g. "A3702"), and application software version (e.g. "3.1.6") — the same fields shown on the unit's own dashboard info page. Reverse-engineered from the unit's web UI (`bundle.js`), undocumented in the Modbus RTU manual. Backed by new `Registers.MACHINE_MODEL`/`MACHINE_TYPE`/`APPL_SW_VERSION_START` addresses and new `MACHINE_MODELS`/`MACHINE_TYPES` lookup tables exported from `device-catalog.ts`.

## [1.2.1] - 2026-08-28

### Fixed

- `ValidationError` (added in 1.2.0) was never re-exported from `src/index.ts`, so consumers had no way to `instanceof`-check it despite the 1.2.0 changelog entry saying it was exported. Now exported from the package root.

## [1.2.0] - 2026-08-28

### Added

- Semantic validation of data read from the unit, via JSON Schema (`src/schemas/*.schema.json`) validated with `ajv`. Catches protocol decode bugs (wrong buffer offset, endianness, a corrupted response) that would otherwise silently produce a nonsensical value — e.g. a 6000°C sensor reading, a >100% fan speed, or a 32nd day of the month — by throwing a `ValidationError` instead. Applied to `getSensorReadings()`, the fan speed and supply temperature setpoint getters, `getRhThreshold()`/`getCo2Threshold()`, `getFilterDaysRemaining()`/`getFilterChangeInterval()`, `getFaults()`, `getUptime()`, and `getDeviceTime()` (validated before constructing the `Date`, so an out-of-range component like `month=13` is rejected rather than silently rolling over into a wrong date). New `ValidationError` export from `src/validation.ts`.

### Fixed

- `WebSocketTransport` cache stampede: concurrent calls that all saw a stale register cache each independently opened their own WebSocket connection to fetch it, rather than sharing one in-flight fetch. Against real hardware, whose embedded web server can only handle a handful of simultaneous connections, this caused `ECONNRESET`/"socket hang up" failures under bursts of concurrent reads (observed: 5 concurrent → 1 failure, 20 concurrent → 14 failures) — easily triggered by any consumer issuing several `ValloxClient` calls at once. Concurrent callers now share a single in-flight `READ_TABLES` fetch; verified against real hardware with zero failures across 49 concurrent calls (bursts of 5/10/14/20) that previously failed at every burst size.

## [1.1.0] - 2026-08-27

### Added

- `getSerialNumber()` / `vallox serial` — reads the unit's serial number from the `SERIAL_NUMBER_MSW`/`SERIAL_NUMBER_LSW` register pair.
- `getUptime()` / `vallox uptime` — reads cumulative lifetime runtime and runtime since the unit's most recent power-on, in hours. Exposed via the new `UnitUptime` type.
- `getFilterChangeInterval()` / `setFilterChangeInterval()` and `vallox filter interval` / `vallox filter set-interval <days>` — read/write the configured filter change interval in days.
- `npm run docs` — generates HTML API documentation from source JSDoc comments via TypeDoc (see `typedoc.json`). Run through a pinned `npx` TypeDoc/TypeScript pair rather than as a devDependency, since the project's own `typescript` (`^7.0.2`) doesn't yet expose the Compiler API TypeDoc needs. The generated `docs/` output and `typedoc.json` are excluded from the published package via `.npmignore`.

### Fixed

- Published package included compiled test files (`dist/__tests__/**`, with sourcemaps) — dead weight for consumers, now excluded via `.npmignore`.

### Security

- Bumped `ws` (the runtime WebSocket dependency used by `WebSocketTransport`) from 7.5.10 to 7.5.13, fixing a memory exhaustion DoS via tiny fragments and data chunks ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)).
- Updated dev-only transitive dependencies (`@babel/*`, `browserslist`, `caniuse-lite`, `js-yaml`, `picomatch`, `brace-expansion`, and others) via `npm audit fix`, resolving several high-severity advisories (ReDoS/DoS) in the test/build toolchain. These do not affect published package consumers.

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
  - `WebSocketTransport` — the proprietary binary WebSocket protocol exposed by the unit's built-in web server
  - `ModbusRtuTransport` — standard Modbus RTU over RS-485 (any Node.js `Duplex` stream, e.g. a serial port)
- `vallox` CLI for direct shell use, covering all of the above, plus `--json` output and a WebSocket-only history log command (`history`, with CSV export).

[Unreleased]: https://github.com/simonarnell/vallox.js/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/simonarnell/vallox.js/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/simonarnell/vallox.js/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/simonarnell/vallox.js/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/simonarnell/vallox.js/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/simonarnell/vallox.js/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/simonarnell/vallox.js/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/simonarnell/vallox.js/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/simonarnell/vallox.js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/simonarnell/vallox.js/releases/tag/v1.0.0
