# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  doesn't yet expose the Compiler API TypeDoc needs.

### Fixed

- **WebSocket transport returned all-zero sensor and register data.** `WebSocketTransport`
  encoded the entire outgoing frame as big-endian, but the unit only accepts the
  length/command envelope and checksum as little-endian (register data words are
  big-endian); a big-endian envelope caused the unit to reject every request with a
  short error frame, silently yielding all-zero readings (e.g. temperatures reported
  as -273.15 °C). The frame builder now encodes the envelope/checksum as little-endian
  and data words as big-endian, matching the unit's actual protocol. This also fixes
  raw `register read`/`register write` access, which shares the same transport.
- **`getDeviceTime()` reported the wrong century.** The unit's `YEAR` clock register
  (and `FILTER_CHANGED_YEAR`) stores a 2-digit offset from 2000 (e.g. `26` for 2026),
  not a full 4-digit year. `getDeviceTime()` passed the raw value straight to `Date`,
  which misinterpreted it as 1926 instead of 2026. `getDeviceTime()`/`setDeviceTime()`
  and `setFilterChanged()` now convert to/from the 2-digit representation correctly.

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

[Unreleased]: https://github.com/simonarnell/vallox.js/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/simonarnell/vallox.js/releases/tag/v1.0.0
