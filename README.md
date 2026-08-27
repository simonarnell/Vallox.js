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
| `profile get` | Current profile (HOME/AWAY/BOOST/FIREPLACE/EXTRA) |
| `profile set <name> [-d <min>]` | Set profile; `-d` sets duration for timed profiles |
| `mode get\|set <home\|away>` | Basic Home/Away mode (does not clear timed overrides) |
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

### Power

```typescript
await client.isPoweredOn()          // boolean
await client.powerOn()
await client.powerOff()
```

### Mode

```typescript
import { Mode } from 'vallox.js'

await client.getMode()              // Mode.HOME | Mode.AWAY
await client.setMode(Mode.AWAY)
```

### Profile (high-level shortcut)

```typescript
import { Profile } from 'vallox.js'

await client.getProfile()           // Profile.HOME | AWAY | BOOST | FIREPLACE | EXTRA | NONE
await client.setProfile(Profile.BOOST)
await client.setProfile(Profile.BOOST, 30)   // 30-minute boost
await client.setProfile(Profile.HOME)
```

### Timed modes

```typescript
await client.setBoostMode()         // indefinite
await client.setBoostMode(30)       // 30 minutes
await client.setCustomMode(45)      // fireplace/custom mode
await client.setProgrammableMode()  // extra/programmable mode
await client.clearTimedModes()      // return to base Home/Away

await client.getBoostTimer()        // remaining minutes (0 = inactive, 65535 = indefinite)
await client.getCustomTimer()
await client.getProgrammableTimer()
```

### Sensor readings

All temperatures are in **degrees Celsius**, humidity in **%**, CO₂ in **PPM**.

```typescript
const readings = await client.getSensorReadings()
// {
//   extractAirTemp: number,      // air leaving rooms
//   exhaustAirTemp: number,      // air expelled outdoors
//   outdoorAirTemp: number,      // incoming fresh air
//   supplyCellAirTemp: number,   // air at HR cell output
//   supplyAirTemp: number,       // air delivered to rooms
//   humidity: number,
//   co2: number,
// }
```

### Fan speeds

Values are percentages (0–100).

```typescript
await client.getHomeFanSpeed()
await client.getAwayFanSpeed()
await client.getBoostFanSpeed()
await client.getCustomExtractFanSpeed()
await client.getCustomSupplyFanSpeed()

await client.setHomeFanSpeed(70)
await client.setAwayFanSpeed(30)
await client.setBoostFanSpeed(100)
await client.setCustomExtractFanSpeed(55)
await client.setCustomSupplyFanSpeed(55)
```

### Supply air temperature setpoints

Values are in **degrees Celsius**.

```typescript
await client.getHomeSupplyTemp()
await client.getAwaySupplyTemp()
await client.getBoostSupplyTemp()
await client.getCustomSupplyTemp()

await client.setHomeSupplyTemp(20)
await client.setAwaySupplyTemp(17)
await client.setBoostSupplyTemp(22)
await client.setCustomSupplyTemp(18)
```

### RH / CO₂ thresholds

```typescript
await client.getRhThreshold()       // percent
await client.setRhThreshold(70)

await client.getCo2Threshold()      // PPM
await client.setCo2Threshold(900)
```

### Heat recovery cell status

```typescript
import { HrCellStatus } from 'vallox.js'

await client.getHrCellStatus()
// HrCellStatus.HEAT_RECOVERY | COOL_RECOVERY | BYPASS | DEFROSTING
```

### Defrost

```typescript
await client.isDefrosting()         // boolean
await client.startDefrost()
await client.stopDefrost()
```

### Faults

```typescript
await client.getCriticalFaultActive()   // boolean
await client.getFaultCount()            // number (capped at 10)

const faults = await client.getFaults()
// Array of { index, code, description, isActive }

await client.acknowledgeFault(0)        // zero-based index
```

### Filter maintenance

```typescript
await client.getFilterDaysRemaining()
await client.setFilterChanged()         // defaults to today
await client.setFilterChanged(new Date('2024-03-15'))
```

### Weekly schedule

```typescript
const schedule = await client.getWeeklySchedule()
// {
//   monday: [0, 1, 1, 0, ...],   // 24 slots, 0=None 1=Home 2=Away 3=Boost
//   tuesday: [...],
//   ...
//   sunday: [...],
// }

await client.setWeeklySchedule(schedule)
await client.setWeeklyTimerEnabled(true)
```

### Device clock

```typescript
await client.getDeviceTime()            // Date
await client.setDeviceTime(new Date())
```

### Raw register access

```typescript
import { Registers } from 'vallox.js'

await client.readRegister(Registers.FAN_SPEED)
await client.writeRegister(Registers.HOME_SPEED, 70)
```

### History log (WS transport only)

Not part of the documented Modbus RTU register map — reverse-engineered from
the unit's own web UI. Available directly on `WebSocketTransport` (there's no
equivalent over Modbus RTU, so it isn't exposed through `ValloxClient`).

```typescript
import { WebSocketTransport, HistoryChannel } from 'vallox.js'

const transport = new WebSocketTransport({ host: '192.168.1.100', port: 80 })
const samples = await transport.getHistory()
// [{ channel: HistoryChannel.EXTRACT_AIR_TEMP, timestamp: Date, value: 29815 }, ...]
```

Each channel is a fixed-size ring buffer (several weeks of periodic samples,
10-minute intervals observed on a real unit), so samples come back in
on-device write order, not chronological order — sort by `timestamp` if you
need them in time order. Temperature channels (`EXTRACT_AIR_TEMP`,
`EXHAUST_AIR_TEMP`, `OUTDOOR_AIR_TEMP`, `SUPPLY_AIR_TEMP`) are in
centikelvin, matching the live sensor registers; the rest (`MAX_CO2`,
`MAX_HUMIDITY`, `FAN_SPEED`, RPM/airflow channels, etc.) are raw values.

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

### API documentation

```bash
npm run docs
```

Generates HTML API docs from the JSDoc comments in `src/` into `docs/` (see `typedoc.json`).
This runs TypeDoc via `npx` against a pinned TypeDoc/TypeScript pair rather than as a
project devDependency: the project's own `typescript` is pinned to an early 7.x preview
that doesn't yet expose the Compiler API TypeDoc depends on.

### Publishing

1. Bump the version in `package.json`
2. Build and verify: `npm run build && npm test`
3. Publish: `npm publish`

## Credits

Inspired by [@danielbayerlein/vallox-api](https://github.com/danielbayerlein/vallox-api) by Daniel Bayerlein, which provided the original WebSocket protocol implementation this library grew from.

## License

MIT © Simon Arnell
