import type { Transport, SensorReadings, FaultEntry, WeeklySchedule, ScheduleDay, UnitUptime } from './types.js'
import { Mode, TimedMode, Profile, HrCellStatus, FAULT_DESCRIPTIONS } from './types.js'
import {
  Registers,
  MAX_FAULTS,
  POWER_ON,
  POWER_OFF,
  TIMER_INDEFINITE,
  SW_VERSION_WORD_COUNT,
  faultCodeRegister,
  faultActivityRegister,
} from './registers.js'
import { MACHINE_MODELS, MACHINE_TYPES } from './device-catalog.js'
import {
  validatePercentage,
  validateTemperatureCelsius,
  validateCo2Ppm,
  validateFilterDays,
  validateSensorReadings,
  validateFaultEntries,
  validateUnitUptime,
  validateDeviceTimeComponents,
} from './validation.js'

// Re-export TimedMode so callers can import it from this module too.
export { TimedMode }

/** Number of hours in a day (registers per day in the weekly schedule). */
const HOURS_PER_DAY = 24

/** Number of hours in a year, used to combine TOTAL_UP_TIME_YEARS/HOURS into a single hour count. */
const HOURS_PER_YEAR = 8760

/**
 * Returns true when a register value is a non-zero ScheduleSlot (1, 2, or 3).
 * TypeScript 5.5 infers the return type as `v is 1 | 2 | 3`, eliminating
 * the need for explicit casts when mapping raw register data to ScheduleSlot.
 */
const isNonZeroSlot = (v: number) => v === 1 || v === 2 || v === 3

/**
 * High-level API client for Vallox ventilation units.
 *
 * Accepts any Transport implementation (WebSocketTransport or ModbusRtuTransport)
 * and provides typed methods for all documented Modbus registers.
 */
export class ValloxClient {
  readonly #transport: Transport

  constructor(transport: Transport) {
    this.#transport = transport
  }

  // ---------------------------------------------------------------------------
  // Temperature conversion helpers
  // ---------------------------------------------------------------------------

  /** Converts centikelvins (as stored in registers) to degrees Celsius. */
  #cKToCelsius(cK: number): number {
    return (cK - 27315) / 100
  }

  /** Converts degrees Celsius to centikelvins for register storage. */
  #celsiusToCK(celsius: number): number {
    return Math.round(celsius * 100 + 27315)
  }

  /** Swaps the high and low bytes of a 16-bit register value. */
  #swap16(word: number): number {
    return ((word & 0xff) << 8) | ((word >> 8) & 0xff)
  }

  // ---------------------------------------------------------------------------
  // Power
  // ---------------------------------------------------------------------------

  /** Returns true if the unit is currently powered on. */
  async isPoweredOn(): Promise<boolean> {
    const value = await this.#transport.readRegister(Registers.ON_OFF)
    return value !== POWER_OFF
  }

  /** Powers the unit off. */
  async powerOff(): Promise<void> {
    await this.#transport.writeRegister(Registers.ON_OFF, POWER_OFF)
  }

  /** Powers the unit on. */
  async powerOn(): Promise<void> {
    await this.#transport.writeRegister(Registers.ON_OFF, POWER_ON)
  }

  // ---------------------------------------------------------------------------
  // Basic mode (Home / Away)
  // ---------------------------------------------------------------------------

  /** Returns the current basic mode (Home or Away). */
  async getMode(): Promise<Mode> {
    const value = await this.#transport.readRegister(Registers.HOME_AWAY)
    return value === Mode.AWAY ? Mode.AWAY : Mode.HOME
  }

  /** Sets the basic ventilation mode to Home or Away. Does not clear timed overrides. */
  async setMode(mode: Mode): Promise<void> {
    await this.#transport.writeRegister(Registers.HOME_AWAY, mode)
  }

  // ---------------------------------------------------------------------------
  // Timed modes
  // ---------------------------------------------------------------------------

  /**
   * Returns remaining boost timer minutes.
   * 0 = not active, 65535 = running indefinitely.
   */
  async getBoostTimer(): Promise<number> {
    return this.#transport.readRegister(Registers.BOOST_TIMER)
  }

  /**
   * Returns remaining custom (fireplace) timer minutes.
   * 0 = not active, 65535 = running indefinitely.
   */
  async getCustomTimer(): Promise<number> {
    return this.#transport.readRegister(Registers.CUSTOM_TIMER)
  }

  /**
   * Returns remaining programmable (extra) timer minutes.
   * 0 = not active, 65535 = running indefinitely.
   */
  async getProgrammableTimer(): Promise<number> {
    return this.#transport.readRegister(Registers.PROG_INPUT_TIMER)
  }

  /**
   * Activates boost mode.
   * @param durationMinutes  Duration in minutes (1–65534). Omit for indefinite (65535).
   */
  async setBoostMode(durationMinutes?: number): Promise<void> {
    const duration = durationMinutes ?? TIMER_INDEFINITE
    await this.#transport.writeRegisters(Registers.BOOST_TIME_CURRENT, [duration])
    await this.#transport.writeRegister(Registers.BOOST_TIMER, duration)
  }

  /**
   * Activates custom (fireplace) mode.
   * @param durationMinutes  Duration in minutes (1–65534). Omit for indefinite (65535).
   */
  async setCustomMode(durationMinutes?: number): Promise<void> {
    const duration = durationMinutes ?? TIMER_INDEFINITE
    await this.#transport.writeRegisters(Registers.CUSTOM_TIME_CURRENT, [duration])
    await this.#transport.writeRegister(Registers.CUSTOM_TIMER, duration)
  }

  /**
   * Activates programmable (extra) mode.
   * @param durationMinutes  Duration in minutes (1–65534). Omit for indefinite (65535).
   */
  async setProgrammableMode(durationMinutes?: number): Promise<void> {
    const duration = durationMinutes ?? TIMER_INDEFINITE
    await this.#transport.writeRegisters(Registers.PROG_TIME_CURRENT, [duration])
    await this.#transport.writeRegister(Registers.PROG_INPUT_TIMER, duration)
  }

  /**
   * Clears all timed mode overrides (boost, custom, programmable).
   * The unit returns to its base Home/Away mode.
   */
  async clearTimedModes(): Promise<void> {
    await this.#transport.writeRegister(Registers.BOOST_TIMER, 0)
    await this.#transport.writeRegister(Registers.CUSTOM_TIMER, 0)
    await this.#transport.writeRegister(Registers.PROG_INPUT_TIMER, 0)
  }

  // ---------------------------------------------------------------------------
  // Profile (backward-compatible API)
  // ---------------------------------------------------------------------------

  /**
   * Returns the current Profile, matching the semantics of the original JS API.
   *
   * Priority order:
   *  1. BOOST  – if boost timer > 0
   *  2. FIREPLACE – if custom timer > 0
   *  3. EXTRA  – if programmable timer > 0
   *  4. AWAY   – if mode register is Away
   *  5. HOME   – if mode register is Home
   *  6. NONE   – fallback
   */
  async getProfile(): Promise<Profile> {
    const [state, boostTimer, customTimer, extraTimer] = await Promise.all([
      this.#transport.readRegister(Registers.HOME_AWAY),
      this.#transport.readRegister(Registers.BOOST_TIMER),
      this.#transport.readRegister(Registers.CUSTOM_TIMER),
      this.#transport.readRegister(Registers.PROG_INPUT_TIMER),
    ])

    if (boostTimer > 0) return Profile.BOOST
    if (customTimer > 0) return Profile.FIREPLACE
    if (extraTimer > 0) return Profile.EXTRA
    if (state === Mode.AWAY) return Profile.AWAY
    if (state === Mode.HOME) return Profile.HOME
    return Profile.NONE
  }

  /**
   * Sets the ventilation profile.
   *
   * For HOME/AWAY: clears all timed overrides and sets the base mode.
   * For BOOST/FIREPLACE/EXTRA: activates the corresponding timed mode.
   *
   * @param profile         The desired Profile.
   * @param durationMinutes Optional duration in minutes for timed profiles.
   */
  async setProfile(profile: Profile, durationMinutes?: number): Promise<void> {
    switch (profile) {
      case Profile.HOME:
        await this.clearTimedModes()
        await this.setMode(Mode.HOME)
        break

      case Profile.AWAY:
        await this.clearTimedModes()
        await this.setMode(Mode.AWAY)
        break

      case Profile.BOOST:
        await this.setBoostMode(durationMinutes)
        break

      case Profile.FIREPLACE:
        await this.setCustomMode(durationMinutes)
        break

      case Profile.EXTRA:
        await this.setProgrammableMode(durationMinutes)
        break

      default:
        throw new TypeError(`"${profile}" is not a valid Profile value`)
    }
  }

  // ---------------------------------------------------------------------------
  // Unit identity
  // ---------------------------------------------------------------------------

  /**
   * Returns the unit's serial number as a hex string (e.g. "0x96752ecd"),
   * assembled from the SERIAL_NUMBER_MSW/LSW register pair.
   */
  async getSerialNumber(): Promise<string> {
    const [msw, lsw] = await Promise.all([
      this.#transport.readRegister(Registers.SERIAL_NUMBER_MSW),
      this.#transport.readRegister(Registers.SERIAL_NUMBER_LSW),
    ])
    return `0x${msw.toString(16).padStart(4, '0')}${lsw.toString(16).padStart(4, '0')}`
  }

  /**
   * Returns the unit's model name (e.g. "Vallox 110 MV"), looked up from the
   * raw MACHINE_MODEL register code via `MACHINE_MODELS`. Returns undefined
   * if the code is not in the lookup table.
   */
  async getModel(): Promise<string | undefined> {
    const code = await this.#transport.readRegister(Registers.MACHINE_MODEL)
    return MACHINE_MODELS[code]
  }

  /**
   * Returns the unit's type designation (e.g. "A3702"), looked up from the
   * raw MACHINE_TYPE register code via `MACHINE_TYPES`. Returns undefined
   * if the code is not in the lookup table.
   */
  async getMachineType(): Promise<string | undefined> {
    const code = await this.#transport.readRegister(Registers.MACHINE_TYPE)
    return MACHINE_TYPES[code]
  }

  /**
   * Returns the unit's application software version (e.g. "3.1.6"), read
   * from the APPL_SW_VERSION_START register block. Returns undefined if the
   * unit reports the block as uninitialized (all words 0xFFFF).
   */
  async getSoftwareVersion(): Promise<string | undefined> {
    const raw = await this.#transport.readRegisters(Registers.APPL_SW_VERSION_START, SW_VERSION_WORD_COUNT)
    const words = Array.from(raw, (word) => this.#swap16(word))

    if (words.every((word) => word === 0xffff)) return undefined

    const firstNonZero = words.findIndex((word) => word !== 0)
    const components = firstNonZero === -1 ? words : words.slice(firstNonZero)
    return components.join('.')
  }

  /** Returns the unit's cumulative and current-session runtime, in hours. */
  async getUptime(): Promise<UnitUptime> {
    const [years, hours, currentHours] = await Promise.all([
      this.#transport.readRegister(Registers.TOTAL_UP_TIME_YEARS),
      this.#transport.readRegister(Registers.TOTAL_UP_TIME_HOURS),
      this.#transport.readRegister(Registers.CURRENT_UP_TIME_HOURS),
    ])
    return validateUnitUptime({
      totalHours: years * HOURS_PER_YEAR + hours,
      currentSessionHours: currentHours,
    })
  }

  // ---------------------------------------------------------------------------
  // Sensor readings
  // ---------------------------------------------------------------------------

  /**
   * Returns all available sensor readings in one call.
   * Temperatures are in degrees Celsius, humidity in %, CO2 in PPM.
   */
  async getSensorReadings(): Promise<SensorReadings> {
    const [
      extractRaw,
      exhaustRaw,
      outdoorRaw,
      supplyCellRaw,
      supplyRaw,
      humidity,
      co2,
    ] = await Promise.all([
      this.#transport.readRegister(Registers.EXTRACT_AIR_TEMP),
      this.#transport.readRegister(Registers.EXHAUST_AIR_TEMP),
      this.#transport.readRegister(Registers.OUTDOOR_AIR_TEMP),
      this.#transport.readRegister(Registers.SUPPLY_CELL_AIR_TEMP),
      this.#transport.readRegister(Registers.SUPPLY_AIR_TEMP),
      this.#transport.readRegister(Registers.RH_VALUE),
      this.#transport.readRegister(Registers.CO2_VALUE),
    ])

    return validateSensorReadings({
      extractAirTemp: this.#cKToCelsius(extractRaw),
      exhaustAirTemp: this.#cKToCelsius(exhaustRaw),
      outdoorAirTemp: this.#cKToCelsius(outdoorRaw),
      supplyCellAirTemp: this.#cKToCelsius(supplyCellRaw),
      supplyAirTemp: this.#cKToCelsius(supplyRaw),
      humidity,
      co2,
    })
  }

  // ---------------------------------------------------------------------------
  // Fan speeds
  // ---------------------------------------------------------------------------

  /** Returns the Home profile fan speed as a percentage (0–100). */
  async getHomeFanSpeed(): Promise<number> {
    return validatePercentage(await this.#transport.readRegister(Registers.HOME_SPEED), 'home fan speed')
  }

  /** Returns the Away profile fan speed as a percentage (0–100). */
  async getAwayFanSpeed(): Promise<number> {
    return validatePercentage(await this.#transport.readRegister(Registers.AWAY_SPEED), 'away fan speed')
  }

  /** Returns the Boost profile fan speed as a percentage (0–100). */
  async getBoostFanSpeed(): Promise<number> {
    return validatePercentage(await this.#transport.readRegister(Registers.BOOST_SPEED), 'boost fan speed')
  }

  /** Returns the Custom mode extract fan speed as a percentage (0–100). */
  async getCustomExtractFanSpeed(): Promise<number> {
    return validatePercentage(
      await this.#transport.readRegister(Registers.CUSTOM_EXTRACT_SPEED),
      'custom extract fan speed',
    )
  }

  /** Returns the Custom mode supply fan speed as a percentage (0–100). */
  async getCustomSupplyFanSpeed(): Promise<number> {
    return validatePercentage(
      await this.#transport.readRegister(Registers.CUSTOM_SUPPLY_SPEED),
      'custom supply fan speed',
    )
  }

  /** Sets the Home profile fan speed. @param percent 0–100. */
  async setHomeFanSpeed(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.HOME_SPEED, percent)
  }

  /** Sets the Away profile fan speed. @param percent 0–100. */
  async setAwayFanSpeed(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.AWAY_SPEED, percent)
  }

  /** Sets the Boost profile fan speed. @param percent 0–100. */
  async setBoostFanSpeed(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.BOOST_SPEED, percent)
  }

  /** Sets the Custom mode extract fan speed. @param percent 0–100. */
  async setCustomExtractFanSpeed(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.CUSTOM_EXTRACT_SPEED, percent)
  }

  /** Sets the Custom mode supply fan speed. @param percent 0–100. */
  async setCustomSupplyFanSpeed(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.CUSTOM_SUPPLY_SPEED, percent)
  }

  // ---------------------------------------------------------------------------
  // Supply air temperature setpoints
  // ---------------------------------------------------------------------------

  /** Returns the Home profile supply air temperature setpoint in Celsius. */
  async getHomeSupplyTemp(): Promise<number> {
    const raw = await this.#transport.readRegister(Registers.HOME_SUPPLY_TEMP)
    return validateTemperatureCelsius(this.#cKToCelsius(raw), 'home supply temperature setpoint')
  }

  /** Returns the Away profile supply air temperature setpoint in Celsius. */
  async getAwaySupplyTemp(): Promise<number> {
    const raw = await this.#transport.readRegister(Registers.AWAY_SUPPLY_TEMP)
    return validateTemperatureCelsius(this.#cKToCelsius(raw), 'away supply temperature setpoint')
  }

  /** Returns the Boost profile supply air temperature setpoint in Celsius. */
  async getBoostSupplyTemp(): Promise<number> {
    const raw = await this.#transport.readRegister(Registers.BOOST_SUPPLY_TEMP)
    return validateTemperatureCelsius(this.#cKToCelsius(raw), 'boost supply temperature setpoint')
  }

  /** Returns the Custom mode supply air temperature setpoint in Celsius. */
  async getCustomSupplyTemp(): Promise<number> {
    const raw = await this.#transport.readRegister(Registers.CUSTOM_SUPPLY_TEMP)
    return validateTemperatureCelsius(this.#cKToCelsius(raw), 'custom supply temperature setpoint')
  }

  /** Sets the Home profile supply air temperature setpoint. @param celsius Target temperature. */
  async setHomeSupplyTemp(celsius: number): Promise<void> {
    await this.#transport.writeRegister(Registers.HOME_SUPPLY_TEMP, this.#celsiusToCK(celsius))
  }

  /** Sets the Away profile supply air temperature setpoint. @param celsius Target temperature. */
  async setAwaySupplyTemp(celsius: number): Promise<void> {
    await this.#transport.writeRegister(Registers.AWAY_SUPPLY_TEMP, this.#celsiusToCK(celsius))
  }

  /** Sets the Boost profile supply air temperature setpoint. @param celsius Target temperature. */
  async setBoostSupplyTemp(celsius: number): Promise<void> {
    await this.#transport.writeRegister(Registers.BOOST_SUPPLY_TEMP, this.#celsiusToCK(celsius))
  }

  /** Sets the Custom mode supply air temperature setpoint. @param celsius Target temperature. */
  async setCustomSupplyTemp(celsius: number): Promise<void> {
    await this.#transport.writeRegister(Registers.CUSTOM_SUPPLY_TEMP, this.#celsiusToCK(celsius))
  }

  // ---------------------------------------------------------------------------
  // RH / CO2 thresholds
  // ---------------------------------------------------------------------------

  /** Returns the RH threshold for automatic fan speed boost (percent). */
  async getRhThreshold(): Promise<number> {
    return validatePercentage(await this.#transport.readRegister(Registers.RH_THRESHOLD), 'RH threshold')
  }

  /** Sets the RH threshold for automatic fan speed boost. @param percent 0–100. */
  async setRhThreshold(percent: number): Promise<void> {
    await this.#transport.writeRegister(Registers.RH_THRESHOLD, percent)
  }

  /** Returns the CO2 threshold for automatic fan speed boost (PPM). */
  async getCo2Threshold(): Promise<number> {
    return validateCo2Ppm(await this.#transport.readRegister(Registers.CO2_THRESHOLD), 'CO2 threshold')
  }

  /** Sets the CO2 threshold for automatic fan speed boost. @param ppm CO2 level in PPM. */
  async setCo2Threshold(ppm: number): Promise<void> {
    await this.#transport.writeRegister(Registers.CO2_THRESHOLD, ppm)
  }

  // ---------------------------------------------------------------------------
  // HR cell status
  // ---------------------------------------------------------------------------

  /** Returns the current heat recovery cell operating status. */
  async getHrCellStatus(): Promise<HrCellStatus> {
    const value = await this.#transport.readRegister(Registers.HR_CELL_STATUS)
    switch (value) {
      case HrCellStatus.COOL_RECOVERY: return HrCellStatus.COOL_RECOVERY
      case HrCellStatus.BYPASS:        return HrCellStatus.BYPASS
      case HrCellStatus.DEFROSTING:    return HrCellStatus.DEFROSTING
      default:                         return HrCellStatus.HEAT_RECOVERY
    }
  }

  // ---------------------------------------------------------------------------
  // Defrost
  // ---------------------------------------------------------------------------

  /** Returns true if the unit is currently in defrost mode. */
  async isDefrosting(): Promise<boolean> {
    const value = await this.#transport.readRegister(Registers.DEFROSTING)
    return value !== 0
  }

  /** Activates defrost mode. */
  async startDefrost(): Promise<void> {
    await this.#transport.writeRegister(Registers.DEFROSTING, 1)
  }

  /** Deactivates defrost mode. */
  async stopDefrost(): Promise<void> {
    await this.#transport.writeRegister(Registers.DEFROSTING, 0)
  }

  // ---------------------------------------------------------------------------
  // Faults
  // ---------------------------------------------------------------------------

  /** Returns true if a critical fault is currently active. */
  async getCriticalFaultActive(): Promise<boolean> {
    const value = await this.#transport.readRegister(Registers.CRITICAL_FAULT_ACTIVE)
    return value !== 0
  }

  /**
   * Returns the total number of stored fault entries (capped at MAX_FAULTS = 10).
   */
  async getFaultCount(): Promise<number> {
    const count = await this.#transport.readRegister(Registers.TOTAL_FAULT_COUNT)
    return Math.min(count, MAX_FAULTS)
  }

  /**
   * Reads all stored fault entries from the unit.
   * Returns an array of up to MAX_FAULTS (10) FaultEntry objects.
   */
  async getFaults(): Promise<FaultEntry[]> {
    const count = await this.getFaultCount()
    if (count === 0) return []

    const faults: FaultEntry[] = []

    for (let i = 1; i <= count; i++) {
      const codeAddr = faultCodeRegister(i)
      const activityAddr = faultActivityRegister(i)

      const [code, activity] = await Promise.all([
        this.#transport.readRegister(codeAddr),
        this.#transport.readRegister(activityAddr),
      ])

      faults.push({
        index: i - 1,
        code,
        description: FAULT_DESCRIPTIONS[code] ?? 'Unknown fault',
        isActive: activity === 0, // 0 = active, 1 = solved
      })
    }

    return validateFaultEntries(faults)
  }

  /**
   * Acknowledges (marks as solved) a fault entry.
   * @param index  Zero-based fault index (0–9), as returned in FaultEntry.index.
   */
  async acknowledgeFault(index: number): Promise<void> {
    const activityAddr = faultActivityRegister(index + 1) // convert to 1-based
    await this.#transport.writeRegister(activityAddr, 1) // 1 = solved
  }

  // ---------------------------------------------------------------------------
  // Filter maintenance
  // ---------------------------------------------------------------------------

  /** Returns the number of days remaining until the filter needs changing. */
  async getFilterDaysRemaining(): Promise<number> {
    return validateFilterDays(
      await this.#transport.readRegister(Registers.REMAINING_FILTER_DAYS),
      'filter days remaining',
    )
  }

  /** Returns the configured filter change interval, in days. */
  async getFilterChangeInterval(): Promise<number> {
    return validateFilterDays(
      await this.#transport.readRegister(Registers.FILTER_CHANGE_INTERVAL),
      'filter change interval',
    )
  }

  /** Sets the filter change interval. @param days Interval in days. */
  async setFilterChangeInterval(days: number): Promise<void> {
    await this.#transport.writeRegister(Registers.FILTER_CHANGE_INTERVAL, days)
  }

  /**
   * Records that the filter has been changed.
   * @param date  The date on which the filter was changed (defaults to today).
   */
  async setFilterChanged(date?: Date): Promise<void> {
    const d = date ?? new Date()
    // FILTER_CHANGED_DAY, _MONTH, _YEAR are contiguous; write them in one frame
    // so the unit sees a single atomic update instead of racing connections.
    await this.#transport.writeRegisters(Registers.FILTER_CHANGED_DAY, [
      d.getDate(),
      d.getMonth() + 1,
      d.getFullYear() - 2000,
    ])
  }

  // ---------------------------------------------------------------------------
  // Weekly schedule
  // ---------------------------------------------------------------------------

  /**
   * Reads the full weekly schedule from the unit.
   * The 168 schedule registers (one per hour, Monday 00:00 through Sunday 23:00)
   * are fetched in a single readRegisters call.
   */
  async getWeeklySchedule(): Promise<WeeklySchedule> {
    const raw = await this.#transport.readRegisters(Registers.WEEKLY_SCHEDULE_START, 168)

    const toDay = (offset: number): ScheduleDay =>
      Array.from({ length: HOURS_PER_DAY }, (_, h) => {
        const v = raw[offset + h]
        // isNonZeroSlot is inferred as `v is 1 | 2 | 3` (TS 5.5), so the
        // ternary resolves to ScheduleSlot (0|1|2|3) without an explicit cast.
        return isNonZeroSlot(v) ? v : 0
      }) as ScheduleDay

    return {
      monday:    toDay(0),
      tuesday:   toDay(24),
      wednesday: toDay(48),
      thursday:  toDay(72),
      friday:    toDay(96),
      saturday:  toDay(120),
      sunday:    toDay(144),
    }
  }

  /**
   * Writes the full weekly schedule to the unit in a single call.
   */
  async setWeeklySchedule(schedule: WeeklySchedule): Promise<void> {
    const days: ScheduleDay[] = [
      schedule.monday,
      schedule.tuesday,
      schedule.wednesday,
      schedule.thursday,
      schedule.friday,
      schedule.saturday,
      schedule.sunday,
    ]

    const values: number[] = []
    for (const day of days) {
      for (const slot of day) {
        values.push(slot)
      }
    }

    await this.#transport.writeRegisters(Registers.WEEKLY_SCHEDULE_START, values)
  }

  /**
   * Enables or disables the weekly schedule (programmable timer).
   * @param enabled  True to enable the weekly schedule, false to disable.
   */
  async setWeeklyTimerEnabled(enabled: boolean): Promise<void> {
    await this.#transport.writeRegister(Registers.PROG_TIMER_ENABLED, enabled ? 1 : 0)
  }

  // ---------------------------------------------------------------------------
  // Device time
  // ---------------------------------------------------------------------------

  /**
   * Reads the current date/time from the unit's internal clock.
   * Note: the unit does not store timezone information; the returned Date is
   * constructed using local-time values from the unit.
   */
  async getDeviceTime(): Promise<Date> {
    const [minute, hour, day, month, year] = await Promise.all([
      this.#transport.readRegister(Registers.MINUTE),
      this.#transport.readRegister(Registers.HOUR),
      this.#transport.readRegister(Registers.DAY),
      this.#transport.readRegister(Registers.MONTH),
      this.#transport.readRegister(Registers.YEAR),
    ])

    // Validate the raw components before constructing a Date: an out-of-range
    // value (e.g. month=13) would otherwise silently roll over into a
    // wrong-but-plausible-looking date instead of surfacing the bad read.
    validateDeviceTimeComponents({ minute, hour, day, month, year })

    // month is 1-based from unit, Date constructor expects 0-based
    // year is stored as a 2-digit offset from 2000 (e.g. 26 for 2026)
    return new Date(2000 + year, month - 1, day, hour, minute)
  }

  /**
   * Sets the unit's internal clock to the given date/time.
   * Seconds are not supported; only minute-level precision is available.
   * @param date  The date/time to set (local time is used).
   */
  async setDeviceTime(date: Date): Promise<void> {
    // Weekday: unit expects 1=Monday, 7=Sunday; JS getDay() gives 0=Sunday, 1=Monday, ..., 6=Saturday
    const jsDay = date.getDay() // 0=Sun, 6=Sat
    const unitDay = jsDay === 0 ? 7 : jsDay // 1=Mon, 7=Sun

    // MINUTE..WEEKDAY are contiguous (4849-4854); write them in one frame so the
    // unit sees a single atomic update instead of six racing connections.
    await this.#transport.writeRegisters(Registers.MINUTE, [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getFullYear() - 2000,
      unitDay,
    ])
  }

  // ---------------------------------------------------------------------------
  // Raw register access
  // ---------------------------------------------------------------------------

  /**
   * Reads a raw register value directly from the transport.
   * Useful for registers not covered by the high-level API.
   */
  async readRegister(address: number): Promise<number> {
    return this.#transport.readRegister(address)
  }

  /**
   * Writes a raw register value directly via the transport.
   * Useful for registers not covered by the high-level API.
   */
  async writeRegister(address: number, value: number): Promise<void> {
    await this.#transport.writeRegister(address, value)
  }
}
