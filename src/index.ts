export { ValloxClient } from './client.js'
export { WebSocketTransport } from './transport/websocket.js'
export { ModbusRtuTransport } from './transport/modbus-rtu.js'
export type { Transport } from './types.js'
export {
  Mode,
  TimedMode,
  Profile,
  HrCellStatus,
  TempControlMethod,
  FAULT_DESCRIPTIONS,
  HistoryChannel,
} from './types.js'
export type {
  SensorReadings,
  FaultEntry,
  WeeklySchedule,
  ScheduleDay,
  ScheduleSlot,
  WebSocketTransportConfig,
  HistorySample,
  UnitUptime,
} from './types.js'
export { Registers, MAX_FAULTS, POWER_ON, POWER_OFF, TIMER_INDEFINITE, SW_VERSION_WORD_COUNT } from './registers.js'
export { MACHINE_MODELS, MACHINE_TYPES } from './device-catalog.js'
export { ValidationError } from './validation.js'
