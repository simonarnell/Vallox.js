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
} from './types.js'
export type {
  SensorReadings,
  FaultEntry,
  WeeklySchedule,
  ScheduleDay,
  ScheduleSlot,
  WebSocketTransportConfig,
} from './types.js'
export { Registers, MAX_FAULTS, POWER_ON, POWER_OFF, TIMER_INDEFINITE } from './registers.js'
