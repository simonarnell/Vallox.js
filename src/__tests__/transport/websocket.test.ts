import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type WsType from 'ws'

jest.unstable_mockModule('ws', () => ({
  default: jest.fn(),
}))

const { WebSocketTransport } = await import('../../transport/websocket.js')
const { default: WebSocket } = await import('ws')
const MockWebSocket = WebSocket as unknown as jest.MockedClass<typeof WsType>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes the 16-bit checksum used in WS frames (sum of all words except last). */
function wsChecksum(words: number[]): number {
  return words.reduce((s, w) => s + w, 0) & 0xffff
}

/**
 * Builds a READ_TABLES response ArrayBuffer with 705 big-endian uint16 values.
 * All values default to 0 unless overridden via `overrides` ({ index: value }).
 */
function buildReadTablesResponse(overrides: Record<number, number> = {}): ArrayBuffer {
  const words = new Array(705).fill(0)
  for (const [idx, val] of Object.entries(overrides)) {
    words[parseInt(idx)] = val
  }
  const ab = new ArrayBuffer(705 * 2)
  const dv = new DataView(ab)
  for (let i = 0; i < 705; i++) {
    dv.setUint16(i * 2, words[i], false)
  }
  return ab
}

/**
 * Parses a request frame built by `#buildFrame` into an array of uint16 words.
 * Every word in a request frame is little-endian (see `#buildFrame`).
 */
function parseFrame(data: Buffer): number[] {
  const wordCount = data.length / 2
  const words: number[] = []
  for (let i = 0; i < wordCount; i++) {
    words.push(data.readUInt16LE(i * 2))
  }
  return words
}

/**
 * Sets up MockWebSocket so that when a connection is opened:
 * - 'open' fires immediately
 * - 'message' fires with the given response when send() is called
 */
function setupMockWs(responseData: ArrayBuffer | Buffer | null = null, errorToEmit?: Error) {
  let wsInstance: any

  MockWebSocket.mockImplementation(function (this: any) {
    wsInstance = this
    this.binaryType = 'arraybuffer'
    this.listeners = new Map<string, Function[]>()

    this.on = (event: string, cb: Function) => {
      if (!this.listeners.has(event)) this.listeners.set(event, [])
      this.listeners.get(event)!.push(cb)
    }

    this.send = (_buf: Buffer) => {
      if (errorToEmit) {
        setImmediate(() => {
          for (const cb of this.listeners.get('error') ?? []) cb(errorToEmit)
        })
        return
      }
      if (responseData !== null) {
        setImmediate(() => {
          for (const cb of this.listeners.get('message') ?? []) cb(responseData)
        })
      }
    }

    this.close = jest.fn()

    // Fire 'open' on next tick
    setImmediate(() => {
      for (const cb of this.listeners.get('open') ?? []) cb()
    })
  } as any)

  return () => wsInstance
}

// ---------------------------------------------------------------------------
// Buffer index mapping (WS_REGIONS logic)
// Register address → expected buffer index for known registers
// ---------------------------------------------------------------------------

describe('WebSocketTransport – buffer index mapping', () => {
  // These expected indices are derived from the WS_REGIONS table:
  // bufferIndex = address - rangeStart + bufferStart - 1

  const cases: Array<{ name: string; address: number; expectedIdx: number }> = [
    // unit_info: rangeStart=0, bufferStart=1 → idx = address - 0 + 1 - 1 = address
    { name: 'unit_info register 1',  address: 1,     expectedIdx: 1   },
    { name: 'unit_info register 35', address: 35,    expectedIdx: 35  },

    // panel_info: rangeStart=256, bufferStart=37 → idx = address - 256 + 37 - 1
    { name: 'panel_info register 257', address: 257,  expectedIdx: 37  },
    { name: 'panel_info register 282', address: 282,  expectedIdx: 62  },

    // hw_state: rangeStart=4352, bufferStart=64 → idx = address - 4352 + 64 - 1
    { name: 'FAN_SPEED (4353)',           address: 4353,  expectedIdx: 64  },
    { name: 'EXTRACT_AIR_TEMP (4354)',    address: 4354,  expectedIdx: 65  },
    { name: 'RH_VALUE (4363)',            address: 4363,  expectedIdx: 74  },
    { name: 'CO2_VALUE (4364)',           address: 4364,  expectedIdx: 75  },

    // sw_state: rangeStart=4608, bufferStart=107 → idx = address - 4608 + 107 - 1
    { name: 'HOME_AWAY (4609)',           address: 4609,  expectedIdx: 107 },
    { name: 'ON_OFF (4610)',              address: 4610,  expectedIdx: 108 },
    { name: 'BOOST_TIMER (4612)',         address: 4612,  expectedIdx: 110 },
    { name: 'HR_CELL_STATUS (4616)',      address: 4616,  expectedIdx: 114 },

    // clock: rangeStart=4848, bufferStart=132 → idx = address - 4848 + 132 - 1
    { name: 'MINUTE (4849)',   address: 4849,  expectedIdx: 132 },
    { name: 'YEAR (4853)',     address: 4853,  expectedIdx: 136 },

    // mode_settings: rangeStart=20480, bufferStart=183 → idx = address - 20480 + 183 - 1
    { name: 'AWAY_SPEED (20501)',  address: 20501, expectedIdx: 203 },
    { name: 'HOME_SPEED (20507)', address: 20507, expectedIdx: 209 },
    { name: 'BOOST_SPEED (20513)', address: 20513, expectedIdx: 215 },

    // faults: rangeStart=36864, bufferStart=298 → idx = address - 36864 + 298 - 1
    { name: 'TOTAL_FAULT_COUNT (36865)', address: 36865, expectedIdx: 298 },
    { name: 'FAULT_1_CODE (36866)',      address: 36866, expectedIdx: 299 },

    // schedule: rangeStart=40960, bufferStart=498 → idx = address - 40960 + 498 - 1
    { name: 'WEEKLY_SCHEDULE_START (40961)', address: 40961, expectedIdx: 498 },
  ]

  for (const { name, address, expectedIdx } of cases) {
    it(`maps ${name} to buffer index ${expectedIdx}`, async () => {
      const response = buildReadTablesResponse({ [expectedIdx]: 0xbeef })
      setupMockWs(Buffer.from(response))

      const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
      const value = await transport.readRegister(address)
      expect(value).toBe(0xbeef)
    })
  }

  it('throws for an address not in any region', async () => {
    setupMockWs(buildReadTablesResponse())
    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await expect(transport.readRegister(99999)).rejects.toThrow(/not in any known WS buffer region/)
  })

  it('throws for address 0 (below all ranges)', async () => {
    setupMockWs(buildReadTablesResponse())
    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await expect(transport.readRegister(0)).rejects.toThrow(/not in any known WS buffer region/)
  })
})

// ---------------------------------------------------------------------------
// READ_TABLES frame construction
// ---------------------------------------------------------------------------

describe('WebSocketTransport – READ_TABLES frame', () => {
  it('sends a 4-word (8-byte) frame', async () => {
    let capturedBuf: Buffer | undefined
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') {
          this._msgCb = cb
        }
      }
      this.send = (buf: Buffer) => {
        capturedBuf = buf
        setImmediate(() => this._msgCb?.(buildReadTablesResponse()))
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await transport.readRegister(4609)

    expect(capturedBuf).toBeDefined()
    expect(capturedBuf!.length).toBe(8)  // 4 words × 2 bytes
  })

  it('sends command code 246 (READ_TABLES) as second word', async () => {
    let capturedBuf: Buffer | undefined
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = (buf: Buffer) => {
        capturedBuf = buf
        setImmediate(() => this._msgCb?.(buildReadTablesResponse()))
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await transport.readRegister(4609)

    const words = parseFrame(capturedBuf!)
    expect(words[0]).toBe(3)    // length word (frame length - 1)
    expect(words[1]).toBe(246)  // READ_TABLES command
    expect(words[2]).toBe(0)    // unused data word
    // words[3] is the checksum
    const expectedChecksum = wsChecksum([words[0], words[1], words[2]])
    expect(words[3]).toBe(expectedChecksum)
  })
})

// ---------------------------------------------------------------------------
// WRITE_DATA frame construction
// ---------------------------------------------------------------------------

describe('WebSocketTransport – WRITE_DATA frame', () => {
  beforeEach(() => { MockWebSocket.mockClear() })

  it('sends correct frame for writeRegister', async () => {
    let capturedBuf: Buffer | undefined
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = (buf: Buffer) => {
        capturedBuf = buf
        setImmediate(() => this._msgCb?.(new ArrayBuffer(0)))
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await transport.writeRegister(4609, 1)

    const words = parseFrame(capturedBuf!)
    // WRITE_DATA frame for 1 pair: [len=4, cmd=249, addr, val, checksum] = 5 words
    expect(words.length).toBe(5)
    expect(words[1]).toBe(249)  // WRITE_DATA command
    expect(words[2]).toBe(4609) // address
    expect(words[3]).toBe(1)    // value
    const expectedChecksum = wsChecksum([words[0], words[1], words[2], words[3]])
    expect(words[4]).toBe(expectedChecksum)
  })

  it('sends interleaved address/value pairs for writeRegisters', async () => {
    let capturedBuf: Buffer | undefined
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = (buf: Buffer) => {
        capturedBuf = buf
        setImmediate(() => this._msgCb?.(new ArrayBuffer(0)))
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await transport.writeRegisters(4609, [10, 20])  // addr 4609→10, addr 4610→20

    const words = parseFrame(capturedBuf!)
    // [len=6, cmd=249, 4609, 10, 4610, 20, checksum] = 7 words
    expect(words.length).toBe(7)
    expect(words[2]).toBe(4609)
    expect(words[3]).toBe(10)
    expect(words[4]).toBe(4610)
    expect(words[5]).toBe(20)
  })

  it('resolves immediately for empty writeRegisters', async () => {
    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await expect(transport.writeRegisters(4609, [])).resolves.toBeUndefined()
    expect(MockWebSocket).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LOG_RAW / history
// ---------------------------------------------------------------------------

describe('WebSocketTransport – getHistory', () => {
  beforeEach(() => { MockWebSocket.mockClear() })

  /** Builds one 8-byte LOG_RAW record: [channel, minute, hour, day, month, year, valueLo, valueHi]. */
  function buildRecord(channel: number, minute: number, hour: number, day: number, month: number, year: number, value: number): number[] {
    return [channel, minute, hour, day, month, year, value & 0xff, (value >> 8) & 0xff]
  }

  /** Builds a LOG_RAW bulk-data buffer: `records` bytes, padded to `totalLength` with the 0xFF end marker. */
  function buildLogBuffer(records: number[][], totalLength: number): ArrayBuffer {
    const bytes = new Uint8Array(totalLength).fill(255)
    bytes.set(records.flat(), 0)
    return bytes.buffer
  }

  it('sends a 3-word (6-byte) LOG_RAW request frame', async () => {
    let capturedBuf: Buffer | undefined
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = (buf: Buffer) => {
        capturedBuf = buf
        setImmediate(() => {
          this._msgCb?.(new ArrayBuffer(8))  // small ack
          this._msgCb?.(buildLogBuffer([], 0))  // empty bulk data
        })
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await transport.getHistory()

    const words = parseFrame(capturedBuf!)
    expect(words.length).toBe(3)
    expect(words[0]).toBe(2)    // length word (frame length - 1)
    expect(words[1]).toBe(243)  // LOG_RAW command
    const expectedChecksum = wsChecksum([words[0], words[1]])
    expect(words[2]).toBe(expectedChecksum)
  })

  it('waits for the second message (bulk data), ignoring the first (ack)', async () => {
    const record = buildRecord(0, 30, 14, 15, 3, 26, 29815)
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = () => {
        setImmediate(() => {
          this._msgCb?.(new ArrayBuffer(8))  // ack — must be ignored
          this._msgCb?.(buildLogBuffer([record], 65536))
        })
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    const samples = await transport.getHistory()

    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual({
      channel: 0,
      timestamp: new Date(2026, 2, 15, 14, 30),
      value: 29815,
    })
  })

  it('decodes records from multiple channel pages', async () => {
    const rec0 = buildRecord(0, 0, 12, 1, 1, 26, 29815)   // channel 0, page offset 0
    const rec1 = buildRecord(1, 0, 12, 1, 1, 26, 100)     // channel 1, page offset 65536
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = () => {
        setImmediate(() => {
          this._msgCb?.(new ArrayBuffer(8))
          const bytes = new Uint8Array(2 * 65536).fill(255)
          bytes.set(rec0, 0)
          bytes.set(rec1, 65536)
          this._msgCb?.(bytes.buffer)
        })
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    const samples = await transport.getHistory()

    expect(samples).toHaveLength(2)
    expect(samples.map((s) => s.channel).sort()).toEqual([0, 1])
    expect(samples.find((s) => s.channel === 1)?.value).toBe(100)
  })

  it('stops at the 0xFF end marker within a page, ignoring records after it', async () => {
    const rec = buildRecord(0, 0, 12, 1, 1, 26, 1)
    MockWebSocket.mockImplementation(function (this: any) {
      this.binaryType = 'arraybuffer'
      this.on = (ev: string, cb: Function) => {
        if (ev === 'open') setImmediate(() => cb())
        if (ev === 'message') this._msgCb = cb
      }
      this.send = () => {
        setImmediate(() => {
          this._msgCb?.(new ArrayBuffer(8))
          const bytes = new Uint8Array(65536).fill(255)
          bytes.set(rec, 0)  // one real record, then the rest of the page is 0xFF padding
          // A record placed after the padding should never be reached.
          bytes.set(buildRecord(0, 10, 12, 1, 1, 26, 2), 64)
          this._msgCb?.(bytes.buffer)
        })
      }
      this.close = jest.fn()
    } as any)

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    const samples = await transport.getHistory()
    expect(samples).toHaveLength(1)
    expect(samples[0].value).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe('WebSocketTransport – cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reuses cached response within TTL for consecutive reads', async () => {
    const response = buildReadTablesResponse({ 107: 0x0001 })
    setupMockWs(Buffer.from(response))

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 }, 5000)

    await transport.readRegister(4609)
    await transport.readRegister(4610)  // same buffer, no second WS connection

    expect(MockWebSocket).toHaveBeenCalledTimes(1)
  })

  it('opens a new connection after TTL expires', async () => {
    const response = buildReadTablesResponse()
    setupMockWs(Buffer.from(response))

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 }, 0)  // 0ms TTL

    await transport.readRegister(4609)
    await transport.readRegister(4609)  // TTL=0 → always expired

    expect(MockWebSocket).toHaveBeenCalledTimes(2)
  })

  it('invalidates cache after a write', async () => {
    const readResponse = buildReadTablesResponse()
    setupMockWs(Buffer.from(readResponse))

    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 }, 5000)

    await transport.readRegister(4609)          // populates cache
    await transport.writeRegister(4610, 0)      // invalidates cache
    await transport.readRegister(4609)          // must re-fetch

    // 2 reads + 1 write = 3 WS connections
    expect(MockWebSocket).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('WebSocketTransport – error handling', () => {
  it('rejects readRegister on WebSocket error', async () => {
    setupMockWs(null, new Error('connection refused'))
    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await expect(transport.readRegister(4609)).rejects.toThrow('connection refused')
  })

  it('rejects writeRegister on WebSocket error', async () => {
    setupMockWs(null, new Error('connection refused'))
    const transport = new WebSocketTransport({ host: '192.168.1.1', port: 80 })
    await expect(transport.writeRegister(4609, 1)).rejects.toThrow('connection refused')
  })
})
