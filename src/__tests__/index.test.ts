import { describe, it, expect } from '@jest/globals'
import * as valloxjs from '../index.js'
import { ValloxClient } from '../client.js'
import { WebSocketTransport } from '../transport/websocket.js'
import { ModbusRtuTransport } from '../transport/modbus-rtu.js'
import { Mode, TimedMode, Profile, HrCellStatus, TempControlMethod, FAULT_DESCRIPTIONS, HistoryChannel } from '../types.js'
import { Registers, MAX_FAULTS, POWER_ON, POWER_OFF, TIMER_INDEFINITE, SW_VERSION_WORD_COUNT } from '../registers.js'
import { MACHINE_MODELS, MACHINE_TYPES } from '../device-catalog.js'
import { ValidationError } from '../validation.js'

/**
 * Every mocked test elsewhere imports directly from relative source paths
 * (`../client.js`, `../transport/websocket.js`, ...), never from this
 * package-root barrel — which is exactly how a real consumer imports
 * (`from 'vallox.js'`). Without a test importing the barrel itself, an
 * export added to e.g. client.ts but never re-exported from here would go
 * unnoticed (and, incidentally, this file is also the only thing that
 * exercises index.ts under coverage at all).
 */
describe('package root barrel (index.ts)', () => {
  it('re-exports every value export from its source modules, unchanged', () => {
    expect(valloxjs.ValloxClient).toBe(ValloxClient)
    expect(valloxjs.WebSocketTransport).toBe(WebSocketTransport)
    expect(valloxjs.ModbusRtuTransport).toBe(ModbusRtuTransport)
    expect(valloxjs.Mode).toBe(Mode)
    expect(valloxjs.TimedMode).toBe(TimedMode)
    expect(valloxjs.Profile).toBe(Profile)
    expect(valloxjs.HrCellStatus).toBe(HrCellStatus)
    expect(valloxjs.TempControlMethod).toBe(TempControlMethod)
    expect(valloxjs.FAULT_DESCRIPTIONS).toBe(FAULT_DESCRIPTIONS)
    expect(valloxjs.HistoryChannel).toBe(HistoryChannel)
    expect(valloxjs.Registers).toBe(Registers)
    expect(valloxjs.MAX_FAULTS).toBe(MAX_FAULTS)
    expect(valloxjs.POWER_ON).toBe(POWER_ON)
    expect(valloxjs.POWER_OFF).toBe(POWER_OFF)
    expect(valloxjs.TIMER_INDEFINITE).toBe(TIMER_INDEFINITE)
    expect(valloxjs.SW_VERSION_WORD_COUNT).toBe(SW_VERSION_WORD_COUNT)
    expect(valloxjs.MACHINE_MODELS).toBe(MACHINE_MODELS)
    expect(valloxjs.MACHINE_TYPES).toBe(MACHINE_TYPES)
    expect(valloxjs.ValidationError).toBe(ValidationError)
  })
})
