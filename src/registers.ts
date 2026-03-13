/**
 * Modbus register addresses for Vallox ventilation units.
 * All addresses are as documented in the Vallox Modbus RTU manual.
 */

// -------------------------------------------------------------------------
// Register values
// -------------------------------------------------------------------------

/** ON_OFF register value: unit is powered on. */
export const POWER_ON = 0

/** ON_OFF register value: unit is powered off. */
export const POWER_OFF = 5

/** Timer value meaning "run indefinitely" (written to boost/custom/programmable timer registers). */
export const TIMER_INDEFINITE = 65535

// -------------------------------------------------------------------------
// Fault log
// -------------------------------------------------------------------------

/** Maximum number of fault entries stored in the unit. */
export const MAX_FAULTS = 10

/** Returns the register address of fault N's fault code (N is 1-based, 1–10). */
export function faultCodeRegister(n: number): number {
  if (n < 1 || n > MAX_FAULTS) throw new RangeError(`Fault index must be 1–${MAX_FAULTS}, got ${n}`)
  return 36866 + (n - 1) * 6
}

/** Returns the register address of fault N's activity flag (N is 1-based, 1–10). */
export function faultActivityRegister(n: number): number {
  if (n < 1 || n > MAX_FAULTS) throw new RangeError(`Fault index must be 1–${MAX_FAULTS}, got ${n}`)
  return 36871 + (n - 1) * 6
}

export const Registers = {
  // -------------------------------------------------------------------------
  // Sensor readings (hardware state region, 4352–4394)
  // -------------------------------------------------------------------------

  /** Fan speed as a percentage (read-only). */
  FAN_SPEED: 4353,

  /** Extract air temperature in centikelvins (air leaving rooms, read-only). */
  EXTRACT_AIR_TEMP: 4354,

  /** Exhaust air temperature in centikelvins (air expelled outdoors, read-only). */
  EXHAUST_AIR_TEMP: 4355,

  /** Outdoor air temperature in centikelvins (fresh incoming air, read-only). */
  OUTDOOR_AIR_TEMP: 4356,

  /** Supply air temperature at HR cell output in centikelvins (read-only). */
  SUPPLY_CELL_AIR_TEMP: 4357,

  /** Supply air temperature delivered to rooms in centikelvins (read-only). */
  SUPPLY_AIR_TEMP: 4358,

  /** Extract fan speed in RPM (read-only). */
  EXTRACT_FAN_RPM: 4361,

  /** Supply fan speed in RPM (read-only). */
  SUPPLY_FAN_RPM: 4362,

  /** Relative humidity of extract air in percent (read-only). */
  RH_VALUE: 4363,

  /** CO2 concentration in extract air in PPM (read-only). */
  CO2_VALUE: 4364,

  // -------------------------------------------------------------------------
  // Software state (sw_state region, 4608–4632)
  // -------------------------------------------------------------------------

  /**
   * Home/Away mode register.
   * 0 = Home, 1 = Away.
   */
  HOME_AWAY: 4609,

  /**
   * Power on/off register.
   * 0 = on, 5 = off.
   */
  ON_OFF: 4610,

  /**
   * Defrosting active register (read/write).
   * 0 = not defrosting, 1 = defrosting.
   */
  DEFROSTING: 4611,

  /**
   * Boost timer remaining minutes.
   * 0 = not active, 65535 = indefinite.
   */
  BOOST_TIMER: 4612,

  /**
   * Custom (fireplace) timer remaining minutes.
   * 0 = not active, 65535 = indefinite.
   */
  CUSTOM_TIMER: 4613,

  /**
   * Programmable (extra) timer remaining minutes.
   * 0 = not active, 65535 = indefinite.
   */
  PROG_INPUT_TIMER: 4614,

  /**
   * Heat recovery cell status (read-only).
   * 0 = heat recovery, 1 = cool recovery, 2 = bypass, 3 = defrost.
   */
  HR_CELL_STATUS: 4616,

  /** Remaining days until filter change required (read-only). */
  REMAINING_FILTER_DAYS: 4620,

  /** Non-zero when a critical fault is active (read-only). */
  CRITICAL_FAULT_ACTIVE: 4621,

  // -------------------------------------------------------------------------
  // Device clock (time region, 4848–4854)
  // -------------------------------------------------------------------------

  /** Current minute (0–59). */
  MINUTE: 4849,

  /** Current hour (0–23). */
  HOUR: 4850,

  /** Current day of month (1–31). */
  DAY: 4851,

  /** Current month (1–12). */
  MONTH: 4852,

  /** Current year (e.g. 2024). */
  YEAR: 4853,

  /** Current weekday (1=Monday, 7=Sunday). */
  WEEKDAY: 4854,

  // -------------------------------------------------------------------------
  // Settings (settings region, 20480–20555)
  // -------------------------------------------------------------------------

  /** Modbus unit address (read/write). */
  MODBUS_ADDRESS: 20482,

  /** Modbus baud rate divided by 100 (read/write). */
  MODBUS_BAUD_DIV100: 20483,

  /** Away fan speed as a percentage. */
  AWAY_SPEED: 20501,

  /** Away supply air temperature setpoint in centikelvins. */
  AWAY_SUPPLY_TEMP: 20502,

  /** Away mode RH-based control enabled (0=off, 1=on). */
  AWAY_RH_CTRL: 20499,

  /** Away mode CO2-based control enabled (0=off, 1=on). */
  AWAY_CO2_CTRL: 20500,

  /** Home fan speed as a percentage. */
  HOME_SPEED: 20507,

  /** Home supply air temperature setpoint in centikelvins. */
  HOME_SUPPLY_TEMP: 20508,

  /** Home mode RH-based control enabled (0=off, 1=on). */
  HOME_RH_CTRL: 20505,

  /** Home mode CO2-based control enabled (0=off, 1=on). */
  HOME_CO2_CTRL: 20506,

  /** Boost fan speed as a percentage. */
  BOOST_SPEED: 20513,

  /** Boost supply air temperature setpoint in centikelvins. */
  BOOST_SUPPLY_TEMP: 20514,

  /** Boost mode RH-based control enabled (0=off, 1=on). */
  BOOST_RH_CTRL: 20511,

  /** Boost mode CO2-based control enabled (0=off, 1=on). */
  BOOST_CO2_CTRL: 20512,

  /** Custom mode extract fan speed as a percentage. */
  CUSTOM_EXTRACT_SPEED: 20487,

  /** Custom mode supply fan speed as a percentage. */
  CUSTOM_SUPPLY_SPEED: 20488,

  /** Custom mode supply air temperature setpoint in centikelvins. */
  CUSTOM_SUPPLY_TEMP: 20497,

  /** RH threshold for automatic speed boost (percent). */
  RH_THRESHOLD: 20490,

  /** CO2 threshold for automatic speed boost (PPM). */
  CO2_THRESHOLD: 20491,

  /**
   * Programmable timer current duration setting (minutes).
   * Written when activating programmable timer mode with a duration.
   */
  PROG_TIME_CURRENT: 20496,

  /**
   * Custom timer current duration setting (minutes).
   * Written when activating custom timer mode with a duration.
   */
  CUSTOM_TIME_CURRENT: 20545,

  /**
   * Boost timer current duration setting (minutes).
   * Written when activating boost timer mode with a duration.
   */
  BOOST_TIME_CURRENT: 20544,

  /**
   * Temperature control method.
   * 0 = supply air, 1 = extract air, 2 = cooling, 3 = air heating.
   */
  TEMP_CONTROL_METHOD: 20549,

  /** Filter changed day of month. */
  FILTER_CHANGED_DAY: 20546,

  /** Filter changed month (1–12). */
  FILTER_CHANGED_MONTH: 20547,

  /** Filter changed year. */
  FILTER_CHANGED_YEAR: 20548,

  /** Boost timer enabled (0=disabled, 1=enabled). */
  BOOST_TIMER_ENABLED: 21766,

  /** Custom timer enabled (0=disabled, 1=enabled). */
  CUSTOM_TIMER_ENABLED: 21767,

  /** Programmable timer enabled (0=disabled, 1=enabled). */
  PROG_TIMER_ENABLED: 21772,

  // -------------------------------------------------------------------------
  // Faults (faults region, 36864–37063)
  // -------------------------------------------------------------------------

  /** Total number of stored fault entries (read-only). */
  TOTAL_FAULT_COUNT: 36865,

  /**
   * Fault 1 code register (read-only).
   * Subsequent faults are 6 registers apart: fault_n_code = 36866 + (n-1)*6
   * Use faultCodeRegister(n) helper for n=1..10.
   */
  FAULT_1_CODE: 36866,

  /**
   * Fault 1 activity register (read/write).
   * 0 = active, 1 = solved/acknowledged.
   * Subsequent faults: fault_n_activity = 36871 + (n-1)*6
   * Use faultActivityRegister(n) helper for n=1..10.
   */
  FAULT_1_ACTIVITY: 36871,

  // -------------------------------------------------------------------------
  // Weekly schedule (schedule region, 40960–41128)
  // -------------------------------------------------------------------------

  /**
   * First register of the 168-register weekly schedule block.
   * Registers 40961–41128 (168 values, one per hour Mon–Sun 00:00–23:00).
   * Values: 0=None, 1=Home, 2=Away, 3=Boost.
   */
  WEEKLY_SCHEDULE_START: 40961,

  // -------------------------------------------------------------------------
  // CFi airflow (read-only)
  // -------------------------------------------------------------------------

  /** CFi supply airflow (read-only). */
  CFI_SUPPLY_AIRFLOW: 46003,

  /** CFi extract airflow (read-only). */
  CFI_EXTRACT_AIRFLOW: 46004,

  // -------------------------------------------------------------------------
  // CFi limits (read/write)
  // -------------------------------------------------------------------------

  /** CFi limiter register (read/write). */
  CFI_LIMITER: 32779,

  /** CFi maximum airflow (read/write). */
  CFI_MAX_AIRFLOW: 46031,

  /** CFi minimum airflow (read/write). */
  CFI_MIN_AIRFLOW: 46032,
} as const satisfies Record<string, number>

export type RegisterName = keyof typeof Registers
