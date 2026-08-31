import { describe, it, expect } from '@jest/globals'
import * as transportBarrel from '../../transport/index.js'
import { WebSocketTransport } from '../../transport/websocket.js'
import { ModbusRtuTransport } from '../../transport/modbus-rtu.js'

/** See src/__tests__/index.test.ts's doc comment — same rationale, for the transport-only barrel. */
describe('transport barrel (transport/index.ts)', () => {
  it('re-exports WebSocketTransport and ModbusRtuTransport unchanged', () => {
    expect(transportBarrel.WebSocketTransport).toBe(WebSocketTransport)
    expect(transportBarrel.ModbusRtuTransport).toBe(ModbusRtuTransport)
  })
})
