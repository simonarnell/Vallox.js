import { jest, describe, it, expect } from '@jest/globals'
import { ValloxClient } from '../client.js'
import { Mode, Profile, HrCellStatus } from '../types.js'
import { Registers, faultCodeRegister, faultActivityRegister } from '../registers.js'
import type { Transport } from '../types.js'

// ---------------------------------------------------------------------------
// Mock transport
// ---------------------------------------------------------------------------

function makeMockTransport(registers: Record<number, number> = {}): jest.Mocked<Transport> {
  return {
    readRegister: jest.fn(async (address: number) => registers[address] ?? 0),
    readRegisters: jest.fn(async (address: number, count: number) => {
      const result = new Uint16Array(count)
      for (let i = 0; i < count; i++) {
        result[i] = registers[address + i] ?? 0
      }
      return result
    }),
    writeRegister: jest.fn(async (_address: number, _value: number): Promise<void> => undefined),
    writeRegisters: jest.fn(async (_address: number, _values: readonly number[]): Promise<void> => undefined),
  }
}

// ---------------------------------------------------------------------------
// Temperature conversion helpers (tested via the public API)
// ---------------------------------------------------------------------------

describe('temperature conversion', () => {
  it('converts centikelvins to Celsius correctly', async () => {
    // 27315 cK = 0 °C. Other temp registers get a plausible baseline (20 °C)
    // so the overall sensor readings object passes semantic validation —
    // this test only cares about the extractAirTemp conversion.
    const transport = makeMockTransport({
      [Registers.EXTRACT_AIR_TEMP]: 27315,
      [Registers.EXHAUST_AIR_TEMP]: 29315,
      [Registers.OUTDOOR_AIR_TEMP]: 29315,
      [Registers.SUPPLY_CELL_AIR_TEMP]: 29315,
      [Registers.SUPPLY_AIR_TEMP]: 29315,
    })
    const client = new ValloxClient(transport)
    const readings = await client.getSensorReadings()
    expect(readings.extractAirTemp).toBeCloseTo(0, 2)
  })

  it('converts 20 °C to centikelvins correctly on write', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setHomeSupplyTemp(20)
    // 20 °C = Math.round(20 * 100 + 27315) = 29315
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_SUPPLY_TEMP, 29315)
  })

  it('converts negative temperatures correctly', async () => {
    // -15 °C = 27315 - 1500 = 25815 cK. Other temp registers get a plausible
    // baseline (20 °C) so the overall sensor readings object passes semantic
    // validation — this test only cares about the outdoorAirTemp conversion.
    const transport = makeMockTransport({
      [Registers.OUTDOOR_AIR_TEMP]: 25815,
      [Registers.EXTRACT_AIR_TEMP]: 29315,
      [Registers.EXHAUST_AIR_TEMP]: 29315,
      [Registers.SUPPLY_CELL_AIR_TEMP]: 29315,
      [Registers.SUPPLY_AIR_TEMP]: 29315,
    })
    const client = new ValloxClient(transport)
    const readings = await client.getSensorReadings()
    expect(readings.outdoorAirTemp).toBeCloseTo(-15, 2)
  })
})

// ---------------------------------------------------------------------------
// Unit identity
// ---------------------------------------------------------------------------

describe('ValloxClient – unit identity', () => {
  it('getSerialNumber assembles a hex string from the MSW/LSW register pair', async () => {
    const transport = makeMockTransport({
      [Registers.SERIAL_NUMBER_MSW]: 0x9675,
      [Registers.SERIAL_NUMBER_LSW]: 0x2ecd,
    })
    const serial = await new ValloxClient(transport).getSerialNumber()
    expect(serial).toBe('0x96752ecd')
  })

  it('getSerialNumber zero-pads short words', async () => {
    const transport = makeMockTransport({
      [Registers.SERIAL_NUMBER_MSW]: 0x1,
      [Registers.SERIAL_NUMBER_LSW]: 0xab,
    })
    const serial = await new ValloxClient(transport).getSerialNumber()
    expect(serial).toBe('0x000100ab')
  })

  it("getSerialNumber('decimal') assembles a decimal string from the MSW/LSW register pair", async () => {
    const transport = makeMockTransport({
      [Registers.SERIAL_NUMBER_MSW]: 0x9675,
      [Registers.SERIAL_NUMBER_LSW]: 0x2ecd,
    })
    const serial = await new ValloxClient(transport).getSerialNumber('decimal')
    expect(serial).toBe('2524262093')
  })

  it("getSerialNumber('hex') is equivalent to the no-argument default", async () => {
    const transport = makeMockTransport({
      [Registers.SERIAL_NUMBER_MSW]: 0x9675,
      [Registers.SERIAL_NUMBER_LSW]: 0x2ecd,
    })
    const serial = await new ValloxClient(transport).getSerialNumber('hex')
    expect(serial).toBe('0x96752ecd')
  })

  it('getSerialNumberDecimal (deprecated) delegates to getSerialNumber(\'decimal\')', async () => {
    const transport = makeMockTransport({
      [Registers.SERIAL_NUMBER_MSW]: 0x9675,
      [Registers.SERIAL_NUMBER_LSW]: 0x2ecd,
    })
    const serial = await new ValloxClient(transport).getSerialNumberDecimal()
    expect(serial).toBe('2524262093')
  })

  it('getUptime combines years and hours into a single hour count', async () => {
    const transport = makeMockTransport({
      [Registers.TOTAL_UP_TIME_YEARS]: 1,
      [Registers.TOTAL_UP_TIME_HOURS]: 100,
      [Registers.CURRENT_UP_TIME_HOURS]: 29,
    })
    const uptime = await new ValloxClient(transport).getUptime()
    expect(uptime.totalHours).toBe(8860)  // 1*8760 + 100
    expect(uptime.currentSessionHours).toBe(29)
  })

  it('getModel looks up the machine model name from the raw register code', async () => {
    const transport = makeMockTransport({ [Registers.MACHINE_MODEL]: 2 })
    const model = await new ValloxClient(transport).getModel()
    expect(model).toBe('Vallox 110 MV')
  })

  it('getModel returns undefined for an unrecognised code', async () => {
    const transport = makeMockTransport({ [Registers.MACHINE_MODEL]: 9999 })
    const model = await new ValloxClient(transport).getModel()
    expect(model).toBeUndefined()
  })

  it('getMachineType looks up the type designation from the raw register code', async () => {
    const transport = makeMockTransport({ [Registers.MACHINE_TYPE]: 19 })
    const type = await new ValloxClient(transport).getMachineType()
    expect(type).toBe('A3702')
  })

  it('getSoftwareVersion decodes byte-swapped words and trims leading zero components', async () => {
    // Real-device capture: registers 2-10 (big-endian) = 0,0,0,0,0,0,0x0300,0x0100,0x0600
    // Byte-swapped: 0,0,0,0,0,0,3,1,6 -> leading zeros trimmed -> "3.1.6"
    const transport = makeMockTransport({
      [Registers.APPL_SW_VERSION_START + 6]: 0x0300,
      [Registers.APPL_SW_VERSION_START + 7]: 0x0100,
      [Registers.APPL_SW_VERSION_START + 8]: 0x0600,
    })
    const version = await new ValloxClient(transport).getSoftwareVersion()
    expect(version).toBe('3.1.6')
  })

  it('getSoftwareVersion returns undefined when all words are uninitialized (0xFFFF)', async () => {
    const registers: Record<number, number> = {}
    for (let i = 0; i < 9; i++) registers[Registers.APPL_SW_VERSION_START + i] = 0xffff
    const transport = makeMockTransport(registers)
    const version = await new ValloxClient(transport).getSoftwareVersion()
    expect(version).toBeUndefined()
  })

  it('getSoftwareVersion falls back to all components when every word is zero', async () => {
    const transport = makeMockTransport()
    const version = await new ValloxClient(transport).getSoftwareVersion()
    expect(version).toBe('0.0.0.0.0.0.0.0.0')
  })
})

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

describe('ValloxClient – power', () => {
  it('isPoweredOn returns true when ON_OFF register is 0', async () => {
    const transport = makeMockTransport({ [Registers.ON_OFF]: 0 })
    const client = new ValloxClient(transport)
    expect(await client.isPoweredOn()).toBe(true)
  })

  it('isPoweredOn returns false when ON_OFF register is 5', async () => {
    const transport = makeMockTransport({ [Registers.ON_OFF]: 5 })
    const client = new ValloxClient(transport)
    expect(await client.isPoweredOn()).toBe(false)
  })

  it('isPoweredOn returns true for any non-5 value', async () => {
    const transport = makeMockTransport({ [Registers.ON_OFF]: 1 })
    const client = new ValloxClient(transport)
    expect(await client.isPoweredOn()).toBe(true)
  })

  it('powerOff writes 5 to ON_OFF register', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.powerOff()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.ON_OFF, 5)
  })

  it('powerOn writes 0 to ON_OFF register', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.powerOn()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.ON_OFF, 0)
  })
})

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

describe('ValloxClient – mode', () => {
  it('getMode returns HOME when register is 0', async () => {
    const transport = makeMockTransport({ [Registers.HOME_AWAY]: 0 })
    const client = new ValloxClient(transport)
    expect(await client.getMode()).toBe(Mode.HOME)
  })

  it('getMode returns AWAY when register is 1', async () => {
    const transport = makeMockTransport({ [Registers.HOME_AWAY]: 1 })
    const client = new ValloxClient(transport)
    expect(await client.getMode()).toBe(Mode.AWAY)
  })

  it('getMode returns AUTOMATIC when register is 2', async () => {
    const transport = makeMockTransport({ [Registers.HOME_AWAY]: 2 })
    const client = new ValloxClient(transport)
    expect(await client.getMode()).toBe(Mode.AUTOMATIC)
  })

  it('getMode returns HOME for unrecognised values', async () => {
    const transport = makeMockTransport({ [Registers.HOME_AWAY]: 99 })
    const client = new ValloxClient(transport)
    expect(await client.getMode()).toBe(Mode.HOME)
  })

  it('setMode writes mode value to HOME_AWAY register', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setMode(Mode.AWAY)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_AWAY, Mode.AWAY)
  })
})

// ---------------------------------------------------------------------------
// Timed modes
// ---------------------------------------------------------------------------

describe('ValloxClient – timed modes', () => {
  it('getBoostTimer reads BOOST_TIMER register', async () => {
    const transport = makeMockTransport({ [Registers.BOOST_TIMER]: 30 })
    const client = new ValloxClient(transport)
    expect(await client.getBoostTimer()).toBe(30)
  })

  it('setBoostMode with duration writes duration to timer registers', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setBoostMode(60)
    expect(transport.writeRegisters).toHaveBeenCalledWith(Registers.BOOST_TIME_CURRENT, [60])
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 60)
  })

  it('setBoostMode without duration uses 65535 (indefinite)', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setBoostMode()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 65535)
  })

  it('setCustomMode with duration writes duration to timer registers', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setCustomMode(45)
    expect(transport.writeRegisters).toHaveBeenCalledWith(Registers.CUSTOM_TIME_CURRENT, [45])
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 45)
  })

  it('setProgrammableMode without duration uses 65535', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProgrammableMode()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_INPUT_TIMER, 65535)
  })

  it('getCustomTimer reads CUSTOM_TIMER register', async () => {
    const transport = makeMockTransport({ [Registers.CUSTOM_TIMER]: 45 })
    const client = new ValloxClient(transport)
    expect(await client.getCustomTimer()).toBe(45)
  })

  it('getProgrammableTimer reads PROG_INPUT_TIMER register', async () => {
    const transport = makeMockTransport({ [Registers.PROG_INPUT_TIMER]: 120 })
    const client = new ValloxClient(transport)
    expect(await client.getProgrammableTimer()).toBe(120)
  })

  it('clearTimedModes writes 0 to all timer registers', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.clearTimedModes()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_INPUT_TIMER, 0)
  })
})

// ---------------------------------------------------------------------------
// Profile (backward-compatible API)
// ---------------------------------------------------------------------------

describe('ValloxClient – getProfile', () => {
  function makeProfileTransport(boostTimer: number, customTimer: number, extraTimer: number, mode: number) {
    return makeMockTransport({
      [Registers.HOME_AWAY]: mode,
      [Registers.BOOST_TIMER]: boostTimer,
      [Registers.CUSTOM_TIMER]: customTimer,
      [Registers.PROG_INPUT_TIMER]: extraTimer,
    })
  }

  it('returns BOOST when boost timer > 0', async () => {
    const transport = makeProfileTransport(30, 0, 0, Mode.HOME)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.BOOST)
  })

  it('returns CUSTOM (same value as the deprecated FIREPLACE) when only custom timer > 0', async () => {
    const transport = makeProfileTransport(0, 30, 0, Mode.HOME)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.CUSTOM)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.FIREPLACE)
  })

  it('returns EXTRA when only programmable timer > 0', async () => {
    const transport = makeProfileTransport(0, 0, 30, Mode.HOME)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.EXTRA)
  })

  it('returns AWAY when no timers active and mode is AWAY', async () => {
    const transport = makeProfileTransport(0, 0, 0, Mode.AWAY)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.AWAY)
  })

  it('returns AUTOMATIC when no timers active and mode is AUTOMATIC', async () => {
    const transport = makeProfileTransport(0, 0, 0, Mode.AUTOMATIC)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.AUTOMATIC)
  })

  it('returns HOME when no timers active and mode is HOME', async () => {
    const transport = makeProfileTransport(0, 0, 0, Mode.HOME)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.HOME)
  })

  it('BOOST takes priority over other active timers', async () => {
    const transport = makeProfileTransport(10, 10, 10, Mode.HOME)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.BOOST)
  })

  it('returns NONE when no timers active and mode register is an unrecognised value', async () => {
    const transport = makeProfileTransport(0, 0, 0, 99)
    expect(await new ValloxClient(transport).getProfile()).toBe(Profile.NONE)
  })
})

describe('ValloxClient – setProfile', () => {
  it('setProfile HOME clears timers and sets HOME mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.HOME)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_INPUT_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_AWAY, Mode.HOME)
  })

  it('setProfile AWAY clears timers and sets AWAY mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.AWAY)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_AWAY, Mode.AWAY)
  })

  it('setProfile BOOST activates boost mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.BOOST, 30)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 30)
  })

  it('setProfile AUTOMATIC clears timers and sets AUTOMATIC mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.AUTOMATIC)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_INPUT_TIMER, 0)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_AWAY, Mode.AUTOMATIC)
  })

  it('setProfile CUSTOM (and the deprecated FIREPLACE alias) activates custom mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.CUSTOM)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 65535)

    const transport2 = makeMockTransport()
    await new ValloxClient(transport2).setProfile(Profile.FIREPLACE)
    expect(transport2.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_TIMER, 65535)
  })

  it('setProfile EXTRA activates programmable mode', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.setProfile(Profile.EXTRA, 120)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_INPUT_TIMER, 120)
  })

  it('setProfile NONE throws TypeError', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await expect(client.setProfile(Profile.NONE)).rejects.toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------

describe('ValloxClient – getSensorReadings', () => {
  it('returns all sensor values converted from centikelvins', async () => {
    const transport = makeMockTransport({
      [Registers.EXTRACT_AIR_TEMP]:     29415,  // 21 °C
      [Registers.EXHAUST_AIR_TEMP]:     28815,  // 15 °C
      [Registers.OUTDOOR_AIR_TEMP]:     27815,  // 5 °C
      [Registers.SUPPLY_CELL_AIR_TEMP]: 28515,  // 12 °C
      [Registers.SUPPLY_AIR_TEMP]:      28615,  // 13 °C
      [Registers.RH_VALUE]:             55,
      [Registers.CO2_VALUE]:            800,
    })
    const client = new ValloxClient(transport)
    const readings = await client.getSensorReadings()

    expect(readings.extractAirTemp).toBeCloseTo(21, 1)
    expect(readings.exhaustAirTemp).toBeCloseTo(15, 1)
    expect(readings.outdoorAirTemp).toBeCloseTo(5, 1)
    expect(readings.supplyCellAirTemp).toBeCloseTo(12, 1)
    expect(readings.supplyAirTemp).toBeCloseTo(13, 1)
    expect(readings.humidity).toBe(55)
    expect(readings.co2).toBe(800)
  })
})

// ---------------------------------------------------------------------------
// Fan speeds
// ---------------------------------------------------------------------------

describe('ValloxClient – fan speeds', () => {
  it('getHomeFanSpeed reads HOME_SPEED register', async () => {
    const transport = makeMockTransport({ [Registers.HOME_SPEED]: 70 })
    expect(await new ValloxClient(transport).getHomeFanSpeed()).toBe(70)
  })

  it('getAwayFanSpeed reads AWAY_SPEED register', async () => {
    const transport = makeMockTransport({ [Registers.AWAY_SPEED]: 40 })
    expect(await new ValloxClient(transport).getAwayFanSpeed()).toBe(40)
  })

  it('getBoostFanSpeed reads BOOST_SPEED register', async () => {
    const transport = makeMockTransport({ [Registers.BOOST_SPEED]: 100 })
    expect(await new ValloxClient(transport).getBoostFanSpeed()).toBe(100)
  })

  it('setHomeFanSpeed writes to HOME_SPEED register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setHomeFanSpeed(75)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.HOME_SPEED, 75)
  })

  it('setAwayFanSpeed writes to AWAY_SPEED register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setAwayFanSpeed(30)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.AWAY_SPEED, 30)
  })

  it('setBoostFanSpeed writes to BOOST_SPEED register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setBoostFanSpeed(100)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_SPEED, 100)
  })

  it('getCustomExtractFanSpeed reads CUSTOM_EXTRACT_SPEED register', async () => {
    const transport = makeMockTransport({ [Registers.CUSTOM_EXTRACT_SPEED]: 55 })
    expect(await new ValloxClient(transport).getCustomExtractFanSpeed()).toBe(55)
  })

  it('setCustomSupplyFanSpeed writes to CUSTOM_SUPPLY_SPEED register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setCustomSupplyFanSpeed(60)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_SUPPLY_SPEED, 60)
  })

  it('getCustomSupplyFanSpeed reads CUSTOM_SUPPLY_SPEED register', async () => {
    const transport = makeMockTransport({ [Registers.CUSTOM_SUPPLY_SPEED]: 65 })
    expect(await new ValloxClient(transport).getCustomSupplyFanSpeed()).toBe(65)
  })

  it('setCustomExtractFanSpeed writes to CUSTOM_EXTRACT_SPEED register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setCustomExtractFanSpeed(50)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_EXTRACT_SPEED, 50)
  })
})

// ---------------------------------------------------------------------------
// Supply temperature setpoints
// ---------------------------------------------------------------------------

describe('ValloxClient – supply temperatures', () => {
  it('getHomeSupplyTemp reads and converts from cK', async () => {
    const transport = makeMockTransport({ [Registers.HOME_SUPPLY_TEMP]: 29315 })
    expect(await new ValloxClient(transport).getHomeSupplyTemp()).toBeCloseTo(20, 1)
  })

  it('getAwaySupplyTemp reads and converts from cK', async () => {
    const transport = makeMockTransport({ [Registers.AWAY_SUPPLY_TEMP]: 28815 })
    expect(await new ValloxClient(transport).getAwaySupplyTemp()).toBeCloseTo(15, 1)
  })

  it('getBoostSupplyTemp reads and converts from cK', async () => {
    const transport = makeMockTransport({ [Registers.BOOST_SUPPLY_TEMP]: 29815 })
    expect(await new ValloxClient(transport).getBoostSupplyTemp()).toBeCloseTo(25, 1)
  })

  it('setAwaySupplyTemp converts Celsius to cK', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setAwaySupplyTemp(18)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.AWAY_SUPPLY_TEMP, 29115)
  })

  it('setBoostSupplyTemp converts Celsius to cK', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setBoostSupplyTemp(22)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.BOOST_SUPPLY_TEMP, 29515)
  })

  it('getCustomSupplyTemp reads and converts from cK', async () => {
    const transport = makeMockTransport({ [Registers.CUSTOM_SUPPLY_TEMP]: 29215 })
    expect(await new ValloxClient(transport).getCustomSupplyTemp()).toBeCloseTo(19, 1)
  })

  it('setCustomSupplyTemp converts Celsius to cK', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setCustomSupplyTemp(17)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CUSTOM_SUPPLY_TEMP, 29015)
  })
})

// ---------------------------------------------------------------------------
// RH / CO2 thresholds
// ---------------------------------------------------------------------------

describe('ValloxClient – RH and CO2 thresholds', () => {
  it('getRhThreshold reads RH_THRESHOLD register', async () => {
    const transport = makeMockTransport({ [Registers.RH_THRESHOLD]: 65 })
    expect(await new ValloxClient(transport).getRhThreshold()).toBe(65)
  })

  it('setRhThreshold writes to RH_THRESHOLD register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setRhThreshold(70)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.RH_THRESHOLD, 70)
  })

  it('getCo2Threshold reads CO2_THRESHOLD register', async () => {
    const transport = makeMockTransport({ [Registers.CO2_THRESHOLD]: 1200 })
    expect(await new ValloxClient(transport).getCo2Threshold()).toBe(1200)
  })

  it('setCo2Threshold writes to CO2_THRESHOLD register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setCo2Threshold(900)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.CO2_THRESHOLD, 900)
  })
})

// ---------------------------------------------------------------------------
// HR cell status
// ---------------------------------------------------------------------------

describe('ValloxClient – HR cell status', () => {
  const cases: Array<[number, HrCellStatus]> = [
    [0, HrCellStatus.HEAT_RECOVERY],
    [1, HrCellStatus.COOL_RECOVERY],
    [2, HrCellStatus.BYPASS],
    [3, HrCellStatus.DEFROSTING],
    [99, HrCellStatus.HEAT_RECOVERY],  // unknown → default
  ]

  for (const [raw, expected] of cases) {
    it(`maps register value ${raw} to ${expected}`, async () => {
      const transport = makeMockTransport({ [Registers.HR_CELL_STATUS]: raw })
      expect(await new ValloxClient(transport).getHrCellStatus()).toBe(expected)
    })
  }
})

// ---------------------------------------------------------------------------
// Defrost
// ---------------------------------------------------------------------------

describe('ValloxClient – defrost', () => {
  it('isDefrosting returns true when DEFROSTING register is non-zero', async () => {
    const transport = makeMockTransport({ [Registers.DEFROSTING]: 1 })
    expect(await new ValloxClient(transport).isDefrosting()).toBe(true)
  })

  it('isDefrosting returns false when DEFROSTING register is 0', async () => {
    const transport = makeMockTransport({ [Registers.DEFROSTING]: 0 })
    expect(await new ValloxClient(transport).isDefrosting()).toBe(false)
  })

  it('startDefrost writes 1 to DEFROSTING register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).startDefrost()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.DEFROSTING, 1)
  })

  it('stopDefrost writes 0 to DEFROSTING register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).stopDefrost()
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.DEFROSTING, 0)
  })
})

// ---------------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------------

describe('ValloxClient – faults', () => {
  it('getCriticalFaultActive returns true when register is non-zero', async () => {
    const transport = makeMockTransport({ [Registers.CRITICAL_FAULT_ACTIVE]: 1 })
    expect(await new ValloxClient(transport).getCriticalFaultActive()).toBe(true)
  })

  it('getCriticalFaultActive returns false when register is 0', async () => {
    const transport = makeMockTransport({ [Registers.CRITICAL_FAULT_ACTIVE]: 0 })
    expect(await new ValloxClient(transport).getCriticalFaultActive()).toBe(false)
  })

  it('getFaultCount returns count capped at 10', async () => {
    const transport = makeMockTransport({ [Registers.TOTAL_FAULT_COUNT]: 15 })
    expect(await new ValloxClient(transport).getFaultCount()).toBe(10)
  })

  it('getFaultCount returns actual count when <= 10', async () => {
    const transport = makeMockTransport({ [Registers.TOTAL_FAULT_COUNT]: 3 })
    expect(await new ValloxClient(transport).getFaultCount()).toBe(3)
  })

  it('getFaults returns empty array when count is 0', async () => {
    const transport = makeMockTransport({ [Registers.TOTAL_FAULT_COUNT]: 0 })
    expect(await new ValloxClient(transport).getFaults()).toEqual([])
  })

  it('getFaults returns correct fault entries', async () => {
    const registers: Record<number, number> = {
      [Registers.TOTAL_FAULT_COUNT]: 2,
      [faultCodeRegister(1)]: 1,      // Extract fan failure
      [faultActivityRegister(1)]: 0,  // 0 = active
      [faultCodeRegister(2)]: 5,      // Outdoor air temp sensor failure
      [faultActivityRegister(2)]: 1,  // 1 = solved
    }
    const transport = makeMockTransport(registers)
    const faults = await new ValloxClient(transport).getFaults()

    expect(faults).toHaveLength(2)

    expect(faults[0].index).toBe(0)
    expect(faults[0].code).toBe(1)
    expect(faults[0].description).toBe('Extract fan failure')
    expect(faults[0].isActive).toBe(true)   // activity=0 means active

    expect(faults[1].index).toBe(1)
    expect(faults[1].code).toBe(5)
    expect(faults[1].description).toBe('Outdoor air temp sensor failure')
    expect(faults[1].isActive).toBe(false)  // activity=1 means solved
  })

  it('getFaults uses "Unknown fault" for unrecognised fault code', async () => {
    const registers: Record<number, number> = {
      [Registers.TOTAL_FAULT_COUNT]: 1,
      [faultCodeRegister(1)]: 99,
      [faultActivityRegister(1)]: 1,
    }
    const transport = makeMockTransport(registers)
    const faults = await new ValloxClient(transport).getFaults()
    expect(faults[0].description).toBe('Unknown fault')
  })

  it('acknowledgeFault writes 1 to the correct activity register', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.acknowledgeFault(0)  // zero-based index 0 → fault 1
    expect(transport.writeRegister).toHaveBeenCalledWith(faultActivityRegister(1), 1)
  })

  it('acknowledgeFault for index 4 writes to fault 5 activity register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).acknowledgeFault(4)
    expect(transport.writeRegister).toHaveBeenCalledWith(faultActivityRegister(5), 1)
  })
})

// ---------------------------------------------------------------------------
// Filter maintenance
// ---------------------------------------------------------------------------

describe('ValloxClient – filter maintenance', () => {
  it('getFilterDaysRemaining reads REMAINING_FILTER_DAYS register', async () => {
    const transport = makeMockTransport({ [Registers.REMAINING_FILTER_DAYS]: 45 })
    expect(await new ValloxClient(transport).getFilterDaysRemaining()).toBe(45)
  })

  it('setFilterChanged writes date components to correct registers', async () => {
    const transport = makeMockTransport()
    const date = new Date(2026, 2, 15)  // 15 March 2026 (month is 0-based)
    await new ValloxClient(transport).setFilterChanged(date)
    expect(transport.writeRegisters).toHaveBeenCalledWith(Registers.FILTER_CHANGED_DAY, [15, 3, 26])  // day, month (1-based), year (2-digit offset from 2000)
  })

  it('setFilterChanged defaults to today when no date given', async () => {
    const transport = makeMockTransport()
    const before = new Date()
    await new ValloxClient(transport).setFilterChanged()
    const after = new Date()

    const calls = (transport.writeRegisters as jest.Mock).mock.calls as [number, number[]][]
    const call = calls.find((c) => c[0] === Registers.FILTER_CHANGED_DAY)
    const year = call![1][2]
    expect(year).toBeGreaterThanOrEqual(before.getFullYear() - 2000)
    expect(year).toBeLessThanOrEqual(after.getFullYear() - 2000)
  })

  it('getFilterChangeInterval reads FILTER_CHANGE_INTERVAL register', async () => {
    const transport = makeMockTransport({ [Registers.FILTER_CHANGE_INTERVAL]: 180 })
    expect(await new ValloxClient(transport).getFilterChangeInterval()).toBe(180)
  })

  it('setFilterChangeInterval writes FILTER_CHANGE_INTERVAL register', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setFilterChangeInterval(90)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.FILTER_CHANGE_INTERVAL, 90)
  })
})

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------

describe('ValloxClient – weekly schedule', () => {
  function makeScheduleBuffer(values: number[]): Record<number, number> {
    const registers: Record<number, number> = {}
    for (let i = 0; i < values.length; i++) {
      registers[Registers.WEEKLY_SCHEDULE_START + i] = values[i]
    }
    return registers
  }

  it('getWeeklySchedule reads 168 registers and maps to days', async () => {
    // All zeros (None profile)
    const transport = makeMockTransport(makeScheduleBuffer(new Array(168).fill(0)))
    const schedule = await new ValloxClient(transport).getWeeklySchedule()

    expect(schedule.monday.length).toBe(24)
    expect(schedule.sunday.length).toBe(24)
    expect(transport.readRegisters).toHaveBeenCalledWith(Registers.WEEKLY_SCHEDULE_START, 168)
  })

  it('getWeeklySchedule maps day offsets correctly', async () => {
    const values = new Array(168).fill(0)
    values[0]   = 1  // Monday 00:00 = Home
    values[24]  = 2  // Tuesday 00:00 = Away
    values[48]  = 3  // Wednesday 00:00 = Boost
    values[167] = 1  // Sunday 23:00 = Home

    const transport = makeMockTransport(makeScheduleBuffer(values))
    const schedule = await new ValloxClient(transport).getWeeklySchedule()

    expect(schedule.monday[0]).toBe(1)
    expect(schedule.tuesday[0]).toBe(2)
    expect(schedule.wednesday[0]).toBe(3)
    expect(schedule.sunday[23]).toBe(1)
  })

  it('getWeeklySchedule clamps invalid slot values to 0', async () => {
    const values = new Array(168).fill(0)
    values[5] = 99  // invalid → should become 0
    const transport = makeMockTransport(makeScheduleBuffer(values))
    const schedule = await new ValloxClient(transport).getWeeklySchedule()
    expect(schedule.monday[5]).toBe(0)
  })

  it('setWeeklySchedule writes 168 values in one call', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)

    const day = new Array(24).fill(0) as any
    const schedule = {
      monday: day, tuesday: day, wednesday: day,
      thursday: day, friday: day, saturday: day, sunday: day,
    }
    await client.setWeeklySchedule(schedule)

    expect(transport.writeRegisters).toHaveBeenCalledTimes(1)
    const [addr, values] = (transport.writeRegisters as jest.Mock).mock.calls[0]
    expect(addr).toBe(Registers.WEEKLY_SCHEDULE_START)
    expect(values).toHaveLength(168)
  })

  it('setWeeklyTimerEnabled writes 1 to PROG_TIMER_ENABLED to enable', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setWeeklyTimerEnabled(true)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_TIMER_ENABLED, 1)
  })

  it('setWeeklyTimerEnabled writes 0 to PROG_TIMER_ENABLED to disable', async () => {
    const transport = makeMockTransport()
    await new ValloxClient(transport).setWeeklyTimerEnabled(false)
    expect(transport.writeRegister).toHaveBeenCalledWith(Registers.PROG_TIMER_ENABLED, 0)
  })
})

// ---------------------------------------------------------------------------
// Device time
// ---------------------------------------------------------------------------

describe('ValloxClient – device time', () => {
  it('getDeviceTime assembles a Date from clock registers', async () => {
    const transport = makeMockTransport({
      [Registers.YEAR]:   26,   // 2-digit offset from 2000
      [Registers.MONTH]:  3,    // March (1-based)
      [Registers.DAY]:    15,
      [Registers.HOUR]:   14,
      [Registers.MINUTE]: 30,
    })
    const date = await new ValloxClient(transport).getDeviceTime()
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(2)     // 0-based: March = 2
    expect(date.getDate()).toBe(15)
    expect(date.getHours()).toBe(14)
    expect(date.getMinutes()).toBe(30)
  })

  it('setDeviceTime writes all clock registers', async () => {
    const transport = makeMockTransport()
    const date = new Date(2026, 2, 15, 14, 30)  // Sunday 15 March 2026 14:30
    await new ValloxClient(transport).setDeviceTime(date)

    // minute, hour, day, month, year (2-digit offset from 2000), weekday
    expect(transport.writeRegisters).toHaveBeenCalledWith(Registers.MINUTE, [30, 14, 15, 3, 26, 7])
  })

  it('setDeviceTime converts Sunday (JS=0) to weekday 7', async () => {
    const transport = makeMockTransport()
    // Sunday 15 March 2026
    const sunday = new Date(2026, 2, 15, 10, 0)
    expect(sunday.getDay()).toBe(0)  // sanity check: JS says 0 for Sunday
    await new ValloxClient(transport).setDeviceTime(sunday)
    const calls = (transport.writeRegisters as jest.Mock).mock.calls as [number, number[]][]
    const call = calls.find((c) => c[0] === Registers.MINUTE)
    expect(call![1][5]).toBe(7)
  })

  it('setDeviceTime converts Monday (JS=1) to weekday 1', async () => {
    const transport = makeMockTransport()
    const monday = new Date(2026, 2, 16, 10, 0)  // Monday 16 March 2026
    expect(monday.getDay()).toBe(1)  // sanity check
    await new ValloxClient(transport).setDeviceTime(monday)
    const calls = (transport.writeRegisters as jest.Mock).mock.calls as [number, number[]][]
    const call = calls.find((c) => c[0] === Registers.MINUTE)
    expect(call![1][5]).toBe(1)
  })

  it('setDeviceTime converts Saturday (JS=6) to weekday 6', async () => {
    const transport = makeMockTransport()
    const saturday = new Date(2026, 2, 14, 10, 0)  // Saturday 14 March 2026
    expect(saturday.getDay()).toBe(6)
    await new ValloxClient(transport).setDeviceTime(saturday)
    const calls = (transport.writeRegisters as jest.Mock).mock.calls as [number, number[]][]
    const call = calls.find((c) => c[0] === Registers.MINUTE)
    expect(call![1][5]).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Raw register passthrough
// ---------------------------------------------------------------------------

describe('ValloxClient – raw register access', () => {
  it('readRegister delegates to transport', async () => {
    const transport = makeMockTransport({ [1234]: 42 })
    const client = new ValloxClient(transport)
    expect(await client.readRegister(1234)).toBe(42)
    expect(transport.readRegister).toHaveBeenCalledWith(1234)
  })

  it('writeRegister delegates to transport', async () => {
    const transport = makeMockTransport()
    const client = new ValloxClient(transport)
    await client.writeRegister(1234, 99)
    expect(transport.writeRegister).toHaveBeenCalledWith(1234, 99)
  })
})

// ---------------------------------------------------------------------------
// Semantic validation (end-to-end: client method → validation.ts → thrown error)
// ---------------------------------------------------------------------------

describe('ValloxClient – semantic validation of device data', () => {
  it('getHomeFanSpeed throws when the register holds an out-of-range percentage', async () => {
    // Fan speed is a percentage; 250 is a technically-valid uint16 but not a real percentage.
    const transport = makeMockTransport({ [Registers.HOME_SPEED]: 250 })
    await expect(new ValloxClient(transport).getHomeFanSpeed()).rejects.toThrow(/home fan speed/)
  })

  it('getCo2Threshold throws when the register holds an implausible PPM value', async () => {
    const transport = makeMockTransport({ [Registers.CO2_THRESHOLD]: 65000 })
    await expect(new ValloxClient(transport).getCo2Threshold()).rejects.toThrow(/CO2 threshold/)
  })

  it('getSensorReadings throws when a temperature register decodes to an implausible value', async () => {
    // Raw register 0 → (0 - 27315) / 100 = -273.15 °C: outside plausible bounds.
    const transport = makeMockTransport({
      [Registers.EXHAUST_AIR_TEMP]: 29315,
      [Registers.OUTDOOR_AIR_TEMP]: 29315,
      [Registers.SUPPLY_CELL_AIR_TEMP]: 29315,
      [Registers.SUPPLY_AIR_TEMP]: 29315,
      // EXTRACT_AIR_TEMP left unset → defaults to raw 0
    })
    await expect(new ValloxClient(transport).getSensorReadings()).rejects.toThrow(/sensor readings/)
  })

  it('getFilterDaysRemaining throws when the register holds an implausible day count', async () => {
    const transport = makeMockTransport({ [Registers.REMAINING_FILTER_DAYS]: 60000 })
    await expect(new ValloxClient(transport).getFilterDaysRemaining()).rejects.toThrow(/filter days remaining/)
  })

  it('getUptime throws when the combined hour count is implausibly large', async () => {
    const transport = makeMockTransport({
      [Registers.TOTAL_UP_TIME_YEARS]: 65535, // garbage: ~65,535 years
      [Registers.TOTAL_UP_TIME_HOURS]: 0,
      [Registers.CURRENT_UP_TIME_HOURS]: 0,
    })
    await expect(new ValloxClient(transport).getUptime()).rejects.toThrow(/unit uptime/)
  })

  it('getDeviceTime throws when the month register is out of range', async () => {
    const transport = makeMockTransport({
      [Registers.YEAR]: 26,
      [Registers.MONTH]: 13, // invalid — would otherwise silently roll over to next year
      [Registers.DAY]: 15,
      [Registers.HOUR]: 14,
      [Registers.MINUTE]: 30,
    })
    await expect(new ValloxClient(transport).getDeviceTime()).rejects.toThrow(/device clock/)
  })

  it('getDeviceTime throws when the day register is out of range', async () => {
    const transport = makeMockTransport({
      [Registers.YEAR]: 26,
      [Registers.MONTH]: 3,
      [Registers.DAY]: 32, // invalid — no month has 32 days
      [Registers.HOUR]: 14,
      [Registers.MINUTE]: 30,
    })
    await expect(new ValloxClient(transport).getDeviceTime()).rejects.toThrow(/device clock/)
  })
})
