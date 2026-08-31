# Vallox.js

TypeScript library for [Vallox](https://www.vallox.com) ventilation units.

Supports two communication transports:

- **WebSocket** — proprietary binary WebSocket protocol exposed by the unit's built-in web server
- **Modbus RTU** — standard Modbus RTU over RS-485 (any Node.js `Duplex` stream, e.g. a serial port)

## Installation

```bash
npm install vallox.js
```

## CLI

A `vallox` command is included for direct use from the shell.

```
vallox -H <host> [--port 80] [--json] <command>
```

### Examples

```bash
# Read all sensor values
vallox -H 192.168.1.100 sensors

# Get / set the active profile
vallox -H 192.168.1.100 profile get
vallox -H 192.168.1.100 profile set boost --duration 30

# Fan speed
vallox -H 192.168.1.100 fan get home
vallox -H 192.168.1.100 fan set home 70

# Supply temperature setpoint
vallox -H 192.168.1.100 temp get home
vallox -H 192.168.1.100 temp set home 20.5

# Power
vallox -H 192.168.1.100 power status
vallox -H 192.168.1.100 power off

# Faults
vallox -H 192.168.1.100 faults list
vallox -H 192.168.1.100 faults ack 0

# Weekly schedule
vallox -H 192.168.1.100 schedule get
vallox -H 192.168.1.100 schedule enable

# Device clock
vallox -H 192.168.1.100 time get
vallox -H 192.168.1.100 time set          # sync to now

# Raw register access
vallox -H 192.168.1.100 register read 4608
vallox -H 192.168.1.100 register write 4608 50

# History log (WS transport only — several weeks of periodic samples per channel)
vallox -H 192.168.1.100 history
vallox -H 192.168.1.100 history --channel EXTRACT_AIR_TEMP
vallox -H 192.168.1.100 history --csv > history.csv   # wide format: one row per timestamp, one column per channel

# Machine-readable output


```

### Command reference

| Command | Description |
|---|---|
| `power status\|on\|off` | Power control |
| `profile get` | Current profile (HOME/AWAY/BOOST/CUSTOM/EXTRA/AUTOMATIC) |
| `profile set <name> [-d <min>]` | Set profile (none\|home\|away\|boost\|custom\|extra\|automatic); `-d` sets duration for timed profiles |
| `mode get\|set <home\|away\|automatic>` | Basic Home/Away/Automatic mode (does not clear timed overrides) |
| `sensors` | All sensor readings (temps, humidity, CO₂) |
| `fan get\|set <profile> [%]` | Fan speed; profiles: home/away/boost/custom-extract/custom-supply |
| `temp get\|set <profile> [°C]` | Supply temp setpoint; profiles: home/away/boost/custom |
| `rh get\|set [%]` | RH threshold for auto boost |
| `co2 get\|set [ppm]` | CO₂ threshold for auto boost |
| `hr-cell` | Heat recovery cell status |
| `defrost status\|start\|stop` | Defrost control |
| `faults list` | All stored faults with active/solved state |
| `faults ack <index>` | Acknowledge a fault by its zero-based index |
| `filter days-remaining` | Days until next filter change |
| `filter changed [YYYY-MM-DD]` | Record a filter change (defaults to today) |
| `timer boost\|custom\|programmable` | Remaining minutes for each timed override |
| `timer clear` | Cancel all timed overrides |
| `schedule get` | Full weekly schedule (hourly slots) |
| `schedule enable\|disable` | Enable/disable the weekly programme |
| `time get\|set [ISO8601]` | Read or set the unit's internal clock |
| `register read <addr>` | Read a raw register by decimal address |
| `register write <addr> <val>` | Write a raw register |
| `history [-c <channel>] [--csv]` | Read the history log (WS only); `--csv` outputs one row per timestamp, one column per channel |

Pass `--json` to any command for machine-readable output. `history` also accepts `--csv` (mutually exclusive with `--json`) for a wide-format CSV export.

## Library usage

### WebSocket transport

```typescript
import { ValloxClient, WebSocketTransport } from 'vallox.js'

const transport = new WebSocketTransport({ host: '192.168.1.100', port: 80 })
const client = new ValloxClient(transport)
```

### Modbus RTU transport

```typescript
import { ValloxClient, ModbusRtuTransport } from 'vallox.js'
import { SerialPort } from 'serialport'

const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 19200 })
const transport = new ModbusRtuTransport(port, 1 /* unit address */)
const client = new ValloxClient(transport)
```

## API

Quick taste — everything on `ValloxClient` follows this shape:

```typescript
import { Mode, Profile } from 'vallox.js'

await client.isPoweredOn()                   // boolean
await client.getSensorReadings()             // { extractAirTemp, humidity, co2, ... }
await client.getProfile()                    // Profile.HOME | AWAY | BOOST | CUSTOM | EXTRA | AUTOMATIC | NONE
await client.setProfile(Profile.BOOST, 30)   // 30-minute boost
await client.setMode(Mode.AUTOMATIC)         // unit adjusts fan speed itself (firmware 3.1.4+)
```

Full method-by-method reference, including fan speeds, temperature setpoints, faults, filter maintenance, the weekly schedule, raw register access, and the WebSocket-only history log:

**→ [API documentation](https://simonarnell.github.io/Vallox.js/)**

(Generated from the JSDoc comments in `src/` — see [Maintenance](#api-documentation) below for how it's built.)

### Testing your own code against this library

```typescript
import { MockValloxServer } from 'vallox.js/testing'

const server = new MockValloxServer() // real WebSocket server, defaults matching a healthy unit
await server.start()
const client = new ValloxClient(new WebSocketTransport({ host: server.host, port: server.port }))
// ... exercise your own code against `client` ...
await server.stop()
```

A real WebSocket server speaking the same READ_TABLES/WRITE_DATA/LOG_RAW binary protocol as a physical unit — for integration-testing code that depends on this library (like [`homebridge-vallox-redux`](https://github.com/simonarnell/homebridge-vallox-redux)) against a real socket instead of a hand-mocked transport. `setRegister()`/`getRegister()` read and write its simulated register state directly; `setHistory()` seeds what a `getHistory()` call returns.

## Maintenance

### Prerequisites

- Node.js >= 24
- npm

### Setup

```bash
git clone https://github.com/simonarnell/vallox.js.git
cd vallox.js
npm install
```

### Build

```bash
npm run build
```

Output is written to `dist/`.

### Test

```bash
npm test
```

Runs the full suite against `MockValloxServer` — always CI-safe, no real hardware needed.

```bash
npm run test:coverage
```

Same suite, plus an HTML coverage report at `coverage/lcov-report/index.html` (file tree, line-by-line hit/miss highlighting) and a text summary in the console. Local only — not published, not committed (see `.gitignore`/`.npmignore`).

```bash
VALLOX_HOST=192.168.1.100 npm run test:hardware
```

Runs a separate suite against a **real unit** — the one thing `MockValloxServer` can never prove, since it's just this project's own model of the protocol. Opt-in only (skips cleanly if `VALLOX_HOST` is unset), and never runs in CI — the unit is only reachable on its own LAN. Read-only checks run by default; the power on/off round-trip additionally requires `VALLOX_ALLOW_POWER_TEST=1`, since it briefly stops the unit's real ventilation.

```bash
VALLOX_HOST=192.168.1.100 npm run test:report
```

Generates `coverage/test-report.html`: styled like (and reusing the real CSS/markup from) the Istanbul HTML report above, extended with a table of which `ValloxClient`/`WebSocketTransport` methods were *actually hit* — real per-function execution counts from `coverage-final.json` — by the mocked suite and, when `VALLOX_HOST` is set, the real-hardware suite. A method only counts as covered if it was hit during a passing run of that suite; if either suite fails, its column reflects that rather than reporting fabricated coverage. Omit `VALLOX_HOST` to still get the mocked half of the report, with the hardware column honestly marked "not run".

### API documentation

```bash
npm run docs
```

Generates HTML API docs from the JSDoc comments in `src/` into `docs/` (see `typedoc.json`).
This runs TypeDoc via `npx` against a pinned TypeDoc/TypeScript pair rather than as a
project devDependency: the project's own `typescript` is pinned to an early 7.x preview
that doesn't yet expose the Compiler API TypeDoc depends on.

Published automatically to **[simonarnell.github.io/Vallox.js](https://simonarnell.github.io/Vallox.js/)** by [`.github/workflows/docs.yml`](.github/workflows/docs.yml) whenever a GitHub Release is published (same trigger as [`publish.yml`](.github/workflows/publish.yml), so the hosted docs and the npm package always describe the same released API — never an unreleased/in-progress one) — running `npm run docs` locally is only needed to preview changes before pushing.

### Publishing

1. Bump the version in `package.json`
2. Build and verify: `npm run build && npm test`
3. Commit, push, and [create a GitHub Release](https://github.com/simonarnell/vallox.js/releases/new) with a `vX.Y.Z` tag matching the version — this triggers [`publish.yml`](.github/workflows/publish.yml), which publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC; no token to manage) and deploys the updated API docs. `npm publish` is not run locally — the package's Trusted Publisher on npm is scoped to that workflow specifically.

## Credits

Inspired by [@danielbayerlein/vallox-api](https://github.com/danielbayerlein/vallox-api) by Daniel Bayerlein, which provided the original WebSocket protocol implementation this library grew from.

## License

MIT © Simon Arnell
