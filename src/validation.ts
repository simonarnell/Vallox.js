import { Ajv, type ValidateFunction } from 'ajv'
import type { FaultEntry, SensorReadings, UnitUptime } from './types.js'

import percentageSchema from './schemas/percentage.schema.json' with { type: 'json' }
import temperatureCelsiusSchema from './schemas/temperature-celsius.schema.json' with { type: 'json' }
import co2PpmSchema from './schemas/co2-ppm.schema.json' with { type: 'json' }
import humidityPercentSchema from './schemas/humidity-percent.schema.json' with { type: 'json' }
import filterDaysSchema from './schemas/filter-days.schema.json' with { type: 'json' }
import sensorReadingsSchema from './schemas/sensor-readings.schema.json' with { type: 'json' }
import faultEntrySchema from './schemas/fault-entry.schema.json' with { type: 'json' }
import faultEntriesSchema from './schemas/fault-entries.schema.json' with { type: 'json' }
import unitUptimeSchema from './schemas/unit-uptime.schema.json' with { type: 'json' }
import deviceTimeComponentsSchema from './schemas/device-time-components.schema.json' with { type: 'json' }

/**
 * Thrown when data read from the unit fails semantic validation — i.e. it is
 * structurally well-formed (right type, right shape) but outside the range
 * of values that are physically/logically plausible for a Vallox MVHR unit.
 *
 * This catches protocol decode bugs (wrong buffer offset, endianness, a
 * corrupted response) that would otherwise silently produce a nonsensical
 * value (e.g. a 6000°C sensor reading, or a 40th day of the month).
 *
 * The validation rules themselves live in `src/schemas/*.schema.json` — kept
 * as standalone JSON Schema documents, separate from this wiring code, so
 * the semantic bounds can be read/edited/reused without touching TypeScript.
 */
export class ValidationError extends Error {
  constructor(context: string, details: string | null | undefined) {
    super(`Invalid ${context} received from device: ${details ?? 'unknown validation error'}`)
    this.name = 'ValidationError'
  }
}

const ajv = new Ajv({ allErrors: true })

// Leaf schemas are compiled (and thereby registered by $id) first, so the
// composite schemas below can $ref them.
const percentageValidator = ajv.compile(percentageSchema)
const temperatureCelsiusValidator = ajv.compile(temperatureCelsiusSchema)
const co2PpmValidator = ajv.compile(co2PpmSchema)
ajv.compile(humidityPercentSchema)
const filterDaysValidator = ajv.compile(filterDaysSchema)
ajv.compile(faultEntrySchema)

// Composite schemas, $ref-ing the leaf schemas above by $id.
const sensorReadingsValidator = ajv.compile(sensorReadingsSchema)
const faultEntriesValidator = ajv.compile(faultEntriesSchema)
const unitUptimeValidator = ajv.compile(unitUptimeSchema)
const deviceTimeComponentsValidator = ajv.compile(deviceTimeComponentsSchema)

function assertValid<T>(validateFn: ValidateFunction, data: unknown, context: string): T {
  if (!validateFn(data)) {
    throw new ValidationError(context, ajv.errorsText(validateFn.errors, { separator: '; ' }))
  }
  return data as T
}

// ---------------------------------------------------------------------------
// Public validation functions
// ---------------------------------------------------------------------------

export function validatePercentage(value: number, context: string): number {
  return assertValid(percentageValidator, value, context)
}

export function validateTemperatureCelsius(value: number, context: string): number {
  return assertValid(temperatureCelsiusValidator, value, context)
}

export function validateCo2Ppm(value: number, context: string): number {
  return assertValid(co2PpmValidator, value, context)
}

export function validateFilterDays(value: number, context: string): number {
  return assertValid(filterDaysValidator, value, context)
}

export function validateSensorReadings(data: SensorReadings): SensorReadings {
  return assertValid(sensorReadingsValidator, data, 'sensor readings')
}

export function validateFaultEntries(data: FaultEntry[]): FaultEntry[] {
  return assertValid(faultEntriesValidator, data, 'fault entries')
}

export function validateUnitUptime(data: UnitUptime): UnitUptime {
  return assertValid(unitUptimeValidator, data, 'unit uptime')
}

export interface DeviceTimeComponents {
  minute: number
  hour: number
  day: number
  month: number
  year: number
}

export function validateDeviceTimeComponents(data: DeviceTimeComponents): DeviceTimeComponents {
  return assertValid(deviceTimeComponentsValidator, data, 'device clock')
}
