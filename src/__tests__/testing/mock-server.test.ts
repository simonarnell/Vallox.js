import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import WebSocket from 'ws'
import { MockValloxServer } from '../../testing/mock-server.js'
import { WebSocketTransport } from '../../transport/websocket.js'
import { ValloxClient } from '../../client.js'
import { HistoryChannel, Profile } from '../../types.js'

describe('MockValloxServer', () => {
  let server: MockValloxServer

  beforeEach(async () => {
    server = new MockValloxServer()
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  function client(): ValloxClient {
    return new ValloxClient(new WebSocketTransport({ host: server.host, port: server.port }))
  }

  it('serves plausible defaults for a real client to read', async () => {
    const c = client()
    expect(await c.isPoweredOn()).toBe(true)
    expect(await c.getModel()).toBe('Vallox 110 MV')
    expect(await c.getSoftwareVersion()).toBe('3.1.6')
    expect(await c.getProfile()).toBe(Profile.HOME)

    const readings = await c.getSensorReadings()
    expect(readings.extractAirTemp).toBeCloseTo(21, 1)
    expect(readings.humidity).toBe(42)
    expect(readings.co2).toBe(650)
  })

  it('round-trips a write through readRegister/writeRegister', async () => {
    const c = client()
    await c.setHomeFanSpeed(77)
    expect(await c.getHomeFanSpeed()).toBe(77)
  })

  it('reflects setRegister() in subsequent client reads', async () => {
    server.setRegister('REMAINING_FILTER_DAYS', 3)
    expect(await client().getFilterDaysRemaining()).toBe(3)
  })

  it('reflects a client write in getRegister()', async () => {
    await client().setAwayFanSpeed(15)
    expect(server.getRegister('AWAY_SPEED')).toBe(15)
  })

  it('honors initialRegisters passed to the constructor', async () => {
    await server.stop()
    server = new MockValloxServer({ initialRegisters: { REMAINING_FILTER_DAYS: 1 } })
    await server.start()
    expect(await client().getFilterDaysRemaining()).toBe(1)
  })

  it('serves history samples set via setHistory()', async () => {
    const timestamp = new Date(2026, 2, 15, 8, 30)
    server.setHistory([
      { channel: HistoryChannel.EXTRACT_AIR_TEMP, timestamp, value: 29815 },
      { channel: HistoryChannel.MAX_HUMIDITY, timestamp, value: 55 },
    ])

    const transport = new WebSocketTransport({ host: server.host, port: server.port })
    const samples = await transport.getHistory()

    expect(samples).toHaveLength(2)
    const extract = samples.find((s) => s.channel === HistoryChannel.EXTRACT_AIR_TEMP)
    expect(extract?.value).toBe(29815)
    expect(extract?.timestamp).toEqual(timestamp)
  })

  it('starts on an OS-assigned port when none is given', async () => {
    expect(server.port).toBeGreaterThan(0)
  })

  it('port getter throws if the server has not been started', () => {
    const notStarted = new MockValloxServer()
    expect(() => notStarted.port).toThrow('MockValloxServer is not listening')
  })

  it('silently ignores an unrecognized command byte, matching a real unit', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${server.host}:${server.port}/`)
      ws.binaryType = 'arraybuffer'
      ws.on('open', () => {
        // [length=2, unknownCommand=0xEE, checksum] — well-formed envelope, bogus command.
        const frame = new ArrayBuffer(6)
        const dv = new DataView(frame)
        dv.setUint16(0, 2, true)
        dv.setUint16(2, 0xee, true)
        dv.setUint16(4, (2 + 0xee) & 0xffff, true)
        ws.send(Buffer.from(frame))
      })
      // No response is expected for a garbage command; if the server crashed instead of
      // ignoring it, the connection would close/error rather than idle quietly.
      ws.on('message', () => reject(new Error('expected no response to an unrecognized command')))
      ws.on('error', reject)
      setTimeout(() => {
        ws.close()
        resolve()
      }, 200)
    })

    // The server itself is still alive and correctly serving normal requests afterward.
    expect(await client().isPoweredOn()).toBe(true)
  })

  it('defaults WEEKDAY to 7 (Sunday) when constructed on a Sunday', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    jest.setSystemTime(new Date(2023, 0, 1)) // a Sunday
    try {
      const sundayServer = new MockValloxServer()
      expect(sundayServer.getRegister('WEEKDAY')).toBe(7)
    } finally {
      jest.useRealTimers()
    }
  })

  it('stop() is a no-op when the server was never started', async () => {
    const neverStarted = new MockValloxServer()
    await expect(neverStarted.stop()).resolves.toBeUndefined()
  })

  it('getRegister falls back to 0 for a register with no seeded default', () => {
    // MODBUS_ADDRESS isn't one of defaultRegisters()'s seeded values.
    expect(server.getRegister('MODBUS_ADDRESS')).toBe(0)
  })

  it('setHistory samples on a channel with no known history page are silently skipped', async () => {
    const timestamp = new Date(2026, 2, 15, 8, 30)
    server.setHistory([{ channel: HistoryChannel.FAN_SPEED, timestamp, value: 42 }])

    const transport = new WebSocketTransport({ host: server.host, port: server.port })
    const samples = await transport.getHistory()

    expect(samples).toHaveLength(0)
  })

  it('drops samples once a history channel page is full rather than overflowing into the next one', async () => {
    // One page holds LOG_PAGE_SIZE(65536) / LOG_RECORD_SIZE(8) = 8192 records.
    const timestamp = new Date(2026, 2, 15, 8, 30)
    const samples = Array.from({ length: 8193 }, (_, i) => ({
      channel: HistoryChannel.EXTRACT_AIR_TEMP,
      timestamp,
      value: i,
    }))
    server.setHistory(samples)

    const transport = new WebSocketTransport({ host: server.host, port: server.port })
    const readBack = await transport.getHistory()

    // The 8193rd sample has nowhere left to go on that channel's page and is dropped.
    expect(readBack).toHaveLength(8192)
  }, 20_000)
})
