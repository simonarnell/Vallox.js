/**
 * Transport abstraction interface for communicating with Vallox units.
 * Implemented by WebSocketTransport and ModbusRtuTransport.
 */
export interface Transport {
  readRegister(address: number): Promise<number>
  readRegisters(address: number, count: number): Promise<Uint16Array>
  writeRegister(address: number, value: number): Promise<void>
  writeRegisters(address: number, values: readonly number[]): Promise<void>
}

/**
 * Named history log channels, as recorded in the unit's internal per-minute log
 * buffers (WS transport only — reverse-engineered from the unit's own web UI,
 * not part of the documented Modbus RTU register map).
 *
 * Temperature channels (0–3) are in centikelvin, matching the live sensor
 * registers; the rest are raw values (ppm, %, RPM, etc.) with no conversion.
 */
export const HistoryChannel = {
  EXTRACT_AIR_TEMP: 0,
  EXHAUST_AIR_TEMP: 1,
  OUTDOOR_AIR_TEMP: 2,
  SUPPLY_AIR_TEMP: 3,
  MAX_CO2: 4,
  MAX_HUMIDITY: 5,
  SUPPLY_CELL_AIR_TEMP: 6,
  METRICS_1: 7,
  FAN_SPEED: 8,
  SUPPLY_IO: 9,
  EXTRACT_IO: 10,
  SUPPLY_RPM: 11,
  EXTRACT_RPM: 12,
  CELL_STATE: 13,
  EXTR_REFERENCE: 14,
  SUPPLY_AIRFLOW: 15,
  EXTRACT_AIRFLOW: 16,
} as const satisfies Record<string, number>
export type HistoryChannel = typeof HistoryChannel[keyof typeof HistoryChannel]

/** One logged sample from the unit's history buffers. */
export interface HistorySample {
  channel: HistoryChannel
  /** Minute-resolution timestamp reconstructed from the unit's clock at log time. */
  timestamp: Date
  /** Raw register value; see `HistoryChannel` doc for units/conversion. */
  value: number
}

/** Basic ventilation mode: Home (0) or Away (1). */
export const Mode = { HOME: 0, AWAY: 1 } as const satisfies Record<string, number>
export type Mode = typeof Mode[keyof typeof Mode]

/** Named timed override modes. */
export const TimedMode = {
  BOOST: 'boost',
  CUSTOM: 'custom',
  PROGRAMMABLE: 'programmable',
} as const satisfies Record<string, string>
export type TimedMode = typeof TimedMode[keyof typeof TimedMode]

/**
 * Profile const for backward compatibility with the original API.
 * Maps to Mode and timed modes internally.
 */
export const Profile = {
  NONE: 0,
  HOME: 1,
  AWAY: 2,
  BOOST: 3,
  FIREPLACE: 4,
  EXTRA: 5,
} as const satisfies Record<string, number>
export type Profile = typeof Profile[keyof typeof Profile]

/** Heat recovery cell operating status. */
export const HrCellStatus = {
  HEAT_RECOVERY: 0,
  COOL_RECOVERY: 1,
  BYPASS: 2,
  DEFROSTING: 3,
} as const satisfies Record<string, number>
export type HrCellStatus = typeof HrCellStatus[keyof typeof HrCellStatus]

/** Temperature control target method. */
export const TempControlMethod = {
  SUPPLY_AIR: 0,
  EXTRACT_AIR: 1,
  COOLING: 2,
  AIR_HEATING: 3,
} as const satisfies Record<string, number>
export type TempControlMethod = typeof TempControlMethod[keyof typeof TempControlMethod]

/**
 * A single schedule slot value representing the ventilation profile
 * assigned to that hour of the week.
 * 0=None, 1=Home, 2=Away, 3=Boost
 */
export type ScheduleSlot = 0 | 1 | 2 | 3

/**
 * 24 hourly schedule slots for one day.
 * Index 0 = midnight (00:00–01:00), index 23 = 23:00–00:00.
 */
export type ScheduleDay = [
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
  ScheduleSlot, ScheduleSlot, ScheduleSlot, ScheduleSlot,
]

/** Full weekly schedule, one ScheduleDay per day. */
export interface WeeklySchedule {
  monday: ScheduleDay
  tuesday: ScheduleDay
  wednesday: ScheduleDay
  thursday: ScheduleDay
  friday: ScheduleDay
  saturday: ScheduleDay
  sunday: ScheduleDay
}

/** Current sensor readings from the ventilation unit. */
export interface SensorReadings {
  /** Extract air temperature (air leaving rooms), in Celsius. */
  extractAirTemp: number
  /** Exhaust air temperature (air leaving unit outside), in Celsius. */
  exhaustAirTemp: number
  /** Outdoor air temperature (incoming fresh air), in Celsius. */
  outdoorAirTemp: number
  /** Supply air temperature at heat recovery cell output, in Celsius. */
  supplyCellAirTemp: number
  /** Supply air temperature delivered to rooms, in Celsius. */
  supplyAirTemp: number
  /** Relative humidity of extract air, in percent (%). */
  humidity: number
  /** CO2 concentration in extract air, in PPM. */
  co2: number
}

/** Cumulative and current-session runtime of the ventilation unit. */
export interface UnitUptime {
  /** Total lifetime runtime, in hours. */
  totalHours: number
  /** Runtime since the unit's most recent power-on, in hours. */
  currentSessionHours: number
}

/** A single fault entry from the unit's fault log. */
export interface FaultEntry {
  /** Zero-based fault index (0–9). */
  index: number
  /** Numeric fault code. */
  code: number
  /** Human-readable description of the fault, or 'Unknown fault' if code is unrecognised. */
  description: string
  /** True if the fault is still active; false if it has been solved/acknowledged. */
  isActive: boolean
}

/** Configuration for the WebSocket transport. */
export interface WebSocketTransportConfig {
  /** Hostname or IP address of the Vallox unit. */
  host: string
  /** TCP port (typically 80). */
  port: number
}

/**
 * Fault code to description mapping from the Vallox Modbus manual.
 * Only codes documented in the manual are listed; all others are 'Unknown fault'.
 */
export const FAULT_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: 'No fault',
  1: 'Extract fan failure',
  2: 'Supply fan failure',
  3: 'Supply airflow sensor',
  4: 'Extract air temp sensor failure',
  5: 'Outdoor air temp sensor failure',
  6: 'Supply air temp sensor failure',
  7: 'Exhaust air temp sensor failure',
  8: 'Supply air from HR cell sensor failure',
  9: 'Extract airflow sensor',
  10: 'Optional temp sensor failure',
  11: 'High supply air temperature',
  12: 'Water radiator freezing prevention',
  23: 'Low supply air temperature',
  25: 'Supply airflow not achieved',
  26: 'Extract airflow not achieved',
} as const
