#!/usr/bin/env node
/**
 * vallox-cli — command-line interface for Vallox ventilation units.
 *
 * Connects to the unit over WebSocket (--host / --port).
 * For Modbus RTU, use the library API directly with a Duplex serial stream.
 */
import { createRequire } from 'module'
import { Command, InvalidArgumentError } from 'commander'
import { ValloxClient } from './client.js'
import { WebSocketTransport } from './transport/websocket.js'
import { Profile, Mode, HrCellStatus } from './types.js'

const { version } = (createRequire(import.meta.url))('../package.json') as { version: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntArg(value: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n)) throw new InvalidArgumentError('Expected an integer.')
  return n
}

function parseFloatArg(value: string): number {
  const n = parseFloat(value)
  if (isNaN(n)) throw new InvalidArgumentError('Expected a number.')
  return n
}

function output(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2))
  } else if (typeof data === 'object' && data !== null) {
    for (const [k, v] of Object.entries(data)) {
      console.log(`${k}: ${v}`)
    }
  } else {
    console.log(String(data))
  }
}

function makeClient(opts: { host: string; port: number }): ValloxClient {
  return new ValloxClient(new WebSocketTransport({ host: opts.host, port: opts.port }))
}

// ---------------------------------------------------------------------------
// Const maps
// ---------------------------------------------------------------------------

const PROFILE_NAMES: Record<string, Profile> = {
  none: Profile.NONE,
  home: Profile.HOME,
  away: Profile.AWAY,
  boost: Profile.BOOST,
  fireplace: Profile.FIREPLACE,
  extra: Profile.EXTRA,
}

const PROFILE_LABELS: Record<number, string> = {
  [Profile.NONE]: 'NONE',
  [Profile.HOME]: 'HOME',
  [Profile.AWAY]: 'AWAY',
  [Profile.BOOST]: 'BOOST',
  [Profile.FIREPLACE]: 'FIREPLACE',
  [Profile.EXTRA]: 'EXTRA',
}

const HR_CELL_LABELS: Record<number, string> = {
  [HrCellStatus.HEAT_RECOVERY]: 'HEAT_RECOVERY',
  [HrCellStatus.COOL_RECOVERY]: 'COOL_RECOVERY',
  [HrCellStatus.BYPASS]: 'BYPASS',
  [HrCellStatus.DEFROSTING]: 'DEFROSTING',
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

const BANNER = 'Vallox.js ventilation control CLI'

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command()

program
  .addHelpText('beforeAll', BANNER)
  .hook('preAction', () => {
    if (!program.opts<{ json: boolean }>().json) process.stdout.write(BANNER + '\n')
  })
  .name('vallox')
  .description('Control a Vallox ventilation unit over WebSocket')
  .version(version)
  .requiredOption('-H, --host <host>', 'hostname or IP address of the unit')
  .option('-p, --port <port>', 'WebSocket port (default: 80)', parseIntArg, 80)
  .option('--json', 'output as JSON')

// ---------------------------------------------------------------------------
// power
// ---------------------------------------------------------------------------

const power = program.command('power').description('Power control')

power.command('status')
  .description('Show whether the unit is powered on')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const on = await makeClient(opts).isPoweredOn()
    output(opts.json ? on : (on ? 'on' : 'off'), opts.json)
  })

power.command('on')
  .description('Power the unit on')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).powerOn()
    output('ok', opts.json)
  })

power.command('off')
  .description('Power the unit off')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).powerOff()
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

const profileCmd = program.command('profile').description('Ventilation profile')

profileCmd.command('get')
  .description('Get current profile')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const p = await makeClient(opts).getProfile()
    output(opts.json ? p : PROFILE_LABELS[p], opts.json)
  })

profileCmd.command('set')
  .description('Set profile (none|home|away|boost|fireplace|extra)')
  .argument('<profile>', 'profile name')
  .option('-d, --duration <minutes>', 'duration in minutes for timed profiles', parseIntArg)
  .action(async (profileName: string, cmdOpts: { duration?: number }) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const p = PROFILE_NAMES[profileName.toLowerCase()]
    if (p === undefined) {
      console.error(`Unknown profile: ${profileName}. Valid: ${Object.keys(PROFILE_NAMES).join(', ')}`)
      process.exit(1)
    }
    await makeClient(opts).setProfile(p, cmdOpts.duration)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// mode
// ---------------------------------------------------------------------------

const modeCmd = program.command('mode').description('Basic ventilation mode (home/away)')

modeCmd.command('get')
  .description('Get current mode')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const m = await makeClient(opts).getMode()
    output(opts.json ? m : (m === Mode.AWAY ? 'away' : 'home'), opts.json)
  })

modeCmd.command('set')
  .description('Set mode (home|away)')
  .argument('<mode>', 'home or away')
  .action(async (modeName: string) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const m = modeName.toLowerCase() === 'away' ? Mode.AWAY : Mode.HOME
    await makeClient(opts).setMode(m)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// sensors
// ---------------------------------------------------------------------------

program.command('sensors')
  .description('Read all sensor values (temperatures in °C, humidity in %, CO2 in PPM)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const readings = await makeClient(opts).getSensorReadings()
    output(readings, opts.json)
  })

// ---------------------------------------------------------------------------
// fan
// ---------------------------------------------------------------------------

const FAN_PROFILES = ['home', 'away', 'boost', 'custom-extract', 'custom-supply'] as const
type FanProfile = typeof FAN_PROFILES[number]

async function getFanSpeed(client: ValloxClient, p: FanProfile): Promise<number> {
  switch (p) {
    case 'home':           return client.getHomeFanSpeed()
    case 'away':           return client.getAwayFanSpeed()
    case 'boost':          return client.getBoostFanSpeed()
    case 'custom-extract': return client.getCustomExtractFanSpeed()
    case 'custom-supply':  return client.getCustomSupplyFanSpeed()
  }
}

async function setFanSpeed(client: ValloxClient, p: FanProfile, percent: number): Promise<void> {
  switch (p) {
    case 'home':           return client.setHomeFanSpeed(percent)
    case 'away':           return client.setAwayFanSpeed(percent)
    case 'boost':          return client.setBoostFanSpeed(percent)
    case 'custom-extract': return client.setCustomExtractFanSpeed(percent)
    case 'custom-supply':  return client.setCustomSupplyFanSpeed(percent)
  }
}

const fan = program.command('fan').description('Fan speed settings')

fan.command('get')
  .description(`Get fan speed for a profile (${FAN_PROFILES.join('|')})`)
  .argument('<profile>', 'fan profile')
  .action(async (p: string) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    if (!FAN_PROFILES.includes(p as FanProfile)) {
      console.error(`Unknown fan profile: ${p}. Valid: ${FAN_PROFILES.join(', ')}`)
      process.exit(1)
    }
    const speed = await getFanSpeed(makeClient(opts), p as FanProfile)
    output(opts.json ? speed : `${speed}%`, opts.json)
  })

fan.command('set')
  .description(`Set fan speed for a profile (${FAN_PROFILES.join('|')})`)
  .argument('<profile>', 'fan profile')
  .argument('<percent>', 'fan speed percent (0-100)', parseIntArg)
  .action(async (p: string, percent: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    if (!FAN_PROFILES.includes(p as FanProfile)) {
      console.error(`Unknown fan profile: ${p}. Valid: ${FAN_PROFILES.join(', ')}`)
      process.exit(1)
    }
    await setFanSpeed(makeClient(opts), p as FanProfile, percent)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// temp (supply air temperature setpoints)
// ---------------------------------------------------------------------------

const TEMP_PROFILES = ['home', 'away', 'boost', 'custom'] as const
type TempProfile = typeof TEMP_PROFILES[number]

async function getSupplyTemp(client: ValloxClient, p: TempProfile): Promise<number> {
  switch (p) {
    case 'home':   return client.getHomeSupplyTemp()
    case 'away':   return client.getAwaySupplyTemp()
    case 'boost':  return client.getBoostSupplyTemp()
    case 'custom': return client.getCustomSupplyTemp()
  }
}

async function setSupplyTemp(client: ValloxClient, p: TempProfile, celsius: number): Promise<void> {
  switch (p) {
    case 'home':   return client.setHomeSupplyTemp(celsius)
    case 'away':   return client.setAwaySupplyTemp(celsius)
    case 'boost':  return client.setBoostSupplyTemp(celsius)
    case 'custom': return client.setCustomSupplyTemp(celsius)
  }
}

const temp = program.command('temp').description('Supply air temperature setpoints')

temp.command('get')
  .description(`Get supply temp setpoint for a profile (${TEMP_PROFILES.join('|')})`)
  .argument('<profile>', 'profile')
  .action(async (p: string) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    if (!TEMP_PROFILES.includes(p as TempProfile)) {
      console.error(`Unknown temp profile: ${p}. Valid: ${TEMP_PROFILES.join(', ')}`)
      process.exit(1)
    }
    const t = await getSupplyTemp(makeClient(opts), p as TempProfile)
    output(opts.json ? t : `${t.toFixed(1)} °C`, opts.json)
  })

temp.command('set')
  .description(`Set supply temp setpoint for a profile (${TEMP_PROFILES.join('|')})`)
  .argument('<profile>', 'profile')
  .argument('<celsius>', 'temperature in Celsius', parseFloatArg)
  .action(async (p: string, celsius: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    if (!TEMP_PROFILES.includes(p as TempProfile)) {
      console.error(`Unknown temp profile: ${p}. Valid: ${TEMP_PROFILES.join(', ')}`)
      process.exit(1)
    }
    await setSupplyTemp(makeClient(opts), p as TempProfile, celsius)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// rh
// ---------------------------------------------------------------------------

const rh = program.command('rh').description('Relative humidity threshold')

rh.command('get')
  .description('Get RH threshold (%)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).getRhThreshold()
    output(opts.json ? v : `${v}%`, opts.json)
  })

rh.command('set')
  .description('Set RH threshold (0-100)')
  .argument('<percent>', 'RH threshold in percent', parseIntArg)
  .action(async (percent: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).setRhThreshold(percent)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// co2
// ---------------------------------------------------------------------------

const co2 = program.command('co2').description('CO2 threshold')

co2.command('get')
  .description('Get CO2 threshold (PPM)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).getCo2Threshold()
    output(opts.json ? v : `${v} PPM`, opts.json)
  })

co2.command('set')
  .description('Set CO2 threshold in PPM')
  .argument('<ppm>', 'CO2 threshold in PPM', parseIntArg)
  .action(async (ppm: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).setCo2Threshold(ppm)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// hr-cell
// ---------------------------------------------------------------------------

program.command('hr-cell')
  .description('Heat recovery cell status')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const status = await makeClient(opts).getHrCellStatus()
    output(opts.json ? status : HR_CELL_LABELS[status], opts.json)
  })

// ---------------------------------------------------------------------------
// defrost
// ---------------------------------------------------------------------------

const defrost = program.command('defrost').description('Defrost control')

defrost.command('status')
  .description('Show whether defrost is active')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const active = await makeClient(opts).isDefrosting()
    output(opts.json ? active : (active ? 'active' : 'inactive'), opts.json)
  })

defrost.command('start')
  .description('Activate defrost mode')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).startDefrost()
    output('ok', opts.json)
  })

defrost.command('stop')
  .description('Deactivate defrost mode')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).stopDefrost()
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// faults
// ---------------------------------------------------------------------------

const faultsCmd = program.command('faults').description('Fault log')

faultsCmd.command('list')
  .description('List all stored fault entries')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const client = makeClient(opts)
    const [critical, entries] = await Promise.all([
      client.getCriticalFaultActive(),
      client.getFaults(),
    ])
    if (opts.json) {
      output({ criticalFaultActive: critical, faults: entries }, true)
    } else {
      console.log(`Critical fault active: ${critical}`)
      if (entries.length === 0) {
        console.log('No faults stored.')
      } else {
        for (const f of entries) {
          const state = f.isActive ? 'ACTIVE' : 'solved'
          console.log(`  [${f.index}] code=${f.code} ${state}: ${f.description}`)
        }
      }
    }
  })

faultsCmd.command('ack')
  .description('Acknowledge (mark as solved) a fault by index')
  .argument('<index>', 'zero-based fault index', parseIntArg)
  .action(async (index: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).acknowledgeFault(index)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------

const filterCmd = program.command('filter').description('Filter maintenance')

filterCmd.command('days-remaining')
  .description('Get number of days remaining until filter change')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const days = await makeClient(opts).getFilterDaysRemaining()
    output(opts.json ? days : `${days} days`, opts.json)
  })

filterCmd.command('changed')
  .description('Record that the filter has been changed (defaults to today)')
  .argument('[date]', 'date of change as YYYY-MM-DD (default: today)')
  .action(async (dateStr?: string) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const date = dateStr ? new Date(dateStr) : undefined
    if (dateStr && isNaN(date!.getTime())) {
      console.error(`Invalid date: ${dateStr}. Use YYYY-MM-DD.`)
      process.exit(1)
    }
    await makeClient(opts).setFilterChanged(date)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------

const timerCmd = program.command('timer').description('Timed mode overrides')

timerCmd.command('boost')
  .description('Show remaining boost timer minutes (0=inactive, 65535=indefinite)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).getBoostTimer()
    output(opts.json ? v : `${v} min`, opts.json)
  })

timerCmd.command('custom')
  .description('Show remaining custom (fireplace) timer minutes')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).getCustomTimer()
    output(opts.json ? v : `${v} min`, opts.json)
  })

timerCmd.command('programmable')
  .description('Show remaining programmable (extra) timer minutes')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).getProgrammableTimer()
    output(opts.json ? v : `${v} min`, opts.json)
  })

timerCmd.command('clear')
  .description('Clear all timed mode overrides (return to Home/Away base mode)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).clearTimedModes()
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

const scheduleCmd = program.command('schedule').description('Weekly ventilation schedule')

scheduleCmd.command('get')
  .description('Read the full weekly schedule')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const s = await makeClient(opts).getWeeklySchedule()
    if (opts.json) {
      output(s, true)
    } else {
      const SLOT_NAMES = ['none', 'home', 'away', 'boost']
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
      for (const day of days) {
        const slots = s[day].map((v, h) => `  ${String(h).padStart(2, '0')}:00 ${SLOT_NAMES[v]}`).join('\n')
        console.log(`${day}:\n${slots}`)
      }
    }
  })

scheduleCmd.command('enable')
  .description('Enable the weekly schedule (programmable timer)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).setWeeklyTimerEnabled(true)
    output('ok', opts.json)
  })

scheduleCmd.command('disable')
  .description('Disable the weekly schedule (programmable timer)')
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).setWeeklyTimerEnabled(false)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// time
// ---------------------------------------------------------------------------

const timeCmd = program.command('time').description("Unit's internal clock")

timeCmd.command('get')
  .description("Read the unit's current date and time")
  .action(async () => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const d = await makeClient(opts).getDeviceTime()
    output(opts.json ? d.toISOString() : d.toLocaleString(), opts.json)
  })

timeCmd.command('set')
  .description("Set the unit's clock (default: now)")
  .argument('[datetime]', 'ISO 8601 datetime string (default: now)')
  .action(async (datetimeStr?: string) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const date = datetimeStr ? new Date(datetimeStr) : new Date()
    if (isNaN(date.getTime())) {
      console.error(`Invalid datetime: ${datetimeStr}`)
      process.exit(1)
    }
    await makeClient(opts).setDeviceTime(date)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// register (raw access)
// ---------------------------------------------------------------------------

const registerCmd = program.command('register').description('Raw register access')

registerCmd.command('read')
  .description('Read a raw register value by address')
  .argument('<address>', 'register address (decimal)', parseIntArg)
  .action(async (address: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    const v = await makeClient(opts).readRegister(address)
    output(opts.json ? v : `${address}: ${v}`, opts.json)
  })

registerCmd.command('write')
  .description('Write a raw register value by address')
  .argument('<address>', 'register address (decimal)', parseIntArg)
  .argument('<value>', 'value to write (decimal)', parseIntArg)
  .action(async (address: number, value: number) => {
    const opts = program.opts<{ host: string; port: number; json: boolean }>()
    await makeClient(opts).writeRegister(address, value)
    output('ok', opts.json)
  })

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
