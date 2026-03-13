import { describe, it, expect } from '@jest/globals'
import { Registers, MAX_FAULTS, faultCodeRegister, faultActivityRegister } from '../registers.js'

describe('MAX_FAULTS', () => {
  it('is 10', () => {
    expect(MAX_FAULTS).toBe(10)
  })
})

describe('faultCodeRegister', () => {
  it('returns 36866 for fault 1', () => {
    expect(faultCodeRegister(1)).toBe(36866)
  })

  it('returns 36872 for fault 2 (6 apart)', () => {
    expect(faultCodeRegister(2)).toBe(36872)
  })

  it('returns correct address for fault 10', () => {
    expect(faultCodeRegister(10)).toBe(36866 + 9 * 6)
  })

  it('each consecutive fault is 6 registers apart', () => {
    for (let n = 1; n < MAX_FAULTS; n++) {
      expect(faultCodeRegister(n + 1) - faultCodeRegister(n)).toBe(6)
    }
  })

  it('throws RangeError for index 0', () => {
    expect(() => faultCodeRegister(0)).toThrow(RangeError)
  })

  it('throws RangeError for index 11', () => {
    expect(() => faultCodeRegister(11)).toThrow(RangeError)
  })

  it('throws RangeError for negative index', () => {
    expect(() => faultCodeRegister(-1)).toThrow(RangeError)
  })
})

describe('faultActivityRegister', () => {
  it('returns 36871 for fault 1', () => {
    expect(faultActivityRegister(1)).toBe(36871)
  })

  it('returns 36877 for fault 2 (6 apart)', () => {
    expect(faultActivityRegister(2)).toBe(36877)
  })

  it('returns correct address for fault 10', () => {
    expect(faultActivityRegister(10)).toBe(36871 + 9 * 6)
  })

  it('is always 5 more than the corresponding faultCodeRegister', () => {
    for (let n = 1; n <= MAX_FAULTS; n++) {
      expect(faultActivityRegister(n) - faultCodeRegister(n)).toBe(5)
    }
  })

  it('throws RangeError for index 0', () => {
    expect(() => faultActivityRegister(0)).toThrow(RangeError)
  })

  it('throws RangeError for index 11', () => {
    expect(() => faultActivityRegister(11)).toThrow(RangeError)
  })
})

describe('Registers', () => {
  it('has expected sensor register addresses', () => {
    expect(Registers.FAN_SPEED).toBe(4353)
    expect(Registers.EXTRACT_AIR_TEMP).toBe(4354)
    expect(Registers.EXHAUST_AIR_TEMP).toBe(4355)
    expect(Registers.OUTDOOR_AIR_TEMP).toBe(4356)
    expect(Registers.SUPPLY_CELL_AIR_TEMP).toBe(4357)
    expect(Registers.SUPPLY_AIR_TEMP).toBe(4358)
    expect(Registers.RH_VALUE).toBe(4363)
    expect(Registers.CO2_VALUE).toBe(4364)
  })

  it('has expected sw_state register addresses', () => {
    expect(Registers.HOME_AWAY).toBe(4609)
    expect(Registers.ON_OFF).toBe(4610)
    expect(Registers.DEFROSTING).toBe(4611)
    expect(Registers.BOOST_TIMER).toBe(4612)
    expect(Registers.CUSTOM_TIMER).toBe(4613)
    expect(Registers.PROG_INPUT_TIMER).toBe(4614)
    expect(Registers.HR_CELL_STATUS).toBe(4616)
    expect(Registers.REMAINING_FILTER_DAYS).toBe(4620)
    expect(Registers.CRITICAL_FAULT_ACTIVE).toBe(4621)
  })

  it('has expected clock register addresses', () => {
    expect(Registers.MINUTE).toBe(4849)
    expect(Registers.HOUR).toBe(4850)
    expect(Registers.DAY).toBe(4851)
    expect(Registers.MONTH).toBe(4852)
    expect(Registers.YEAR).toBe(4853)
    expect(Registers.WEEKDAY).toBe(4854)
  })

  it('has expected mode settings register addresses', () => {
    expect(Registers.AWAY_SPEED).toBe(20501)
    expect(Registers.HOME_SPEED).toBe(20507)
    expect(Registers.BOOST_SPEED).toBe(20513)
    expect(Registers.AWAY_SUPPLY_TEMP).toBe(20502)
    expect(Registers.HOME_SUPPLY_TEMP).toBe(20508)
    expect(Registers.BOOST_SUPPLY_TEMP).toBe(20514)
  })

  it('has expected fault register addresses', () => {
    expect(Registers.TOTAL_FAULT_COUNT).toBe(36865)
    expect(Registers.FAULT_1_CODE).toBe(36866)
    expect(Registers.FAULT_1_ACTIVITY).toBe(36871)
  })

  it('FAULT_1_CODE matches faultCodeRegister(1)', () => {
    expect(Registers.FAULT_1_CODE).toBe(faultCodeRegister(1))
  })

  it('FAULT_1_ACTIVITY matches faultActivityRegister(1)', () => {
    expect(Registers.FAULT_1_ACTIVITY).toBe(faultActivityRegister(1))
  })

  it('has expected weekly schedule start address', () => {
    expect(Registers.WEEKLY_SCHEDULE_START).toBe(40961)
  })

  it('has timer-enable register addresses', () => {
    expect(Registers.BOOST_TIMER_ENABLED).toBe(21766)
    expect(Registers.CUSTOM_TIMER_ENABLED).toBe(21767)
    expect(Registers.PROG_TIMER_ENABLED).toBe(21772)
  })
})
