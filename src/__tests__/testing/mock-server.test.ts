import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
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
})
