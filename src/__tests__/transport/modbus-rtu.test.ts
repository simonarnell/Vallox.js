import { describe, it, expect } from '@jest/globals'
import { Duplex } from 'node:stream'
import { ModbusRtuTransport } from '../../transport/modbus-rtu.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes CRC-16/Modbus for a byte array (reference implementation for tests). */
function crc16(buffer: Uint8Array): number {
  let crc = 0xffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return crc
}

/** Extracts CRC from the last 2 bytes of a frame (low byte first). */
function extractCrc(frame: Uint8Array): number {
  return frame[frame.length - 2] | (frame[frame.length - 1] << 8)
}

/** Creates a fake Duplex stream that captures writes and can emit data on demand. */
function makeFakeStream() {
  const written: Buffer[] = []
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _enc: string, cb: () => void) {
      written.push(chunk)
      cb()
    },
  })

  return {
    stream,
    written,
    /** Push response bytes into the stream's readable side. */
    respond(data: Uint8Array) {
      stream.push(Buffer.from(data))
    },
  }
}

/** Builds a valid FC03 response frame for the given register values. */
function buildReadResponse(unitAddr: number, values: number[]): Uint8Array {
  const byteCount = values.length * 2
  const frame = new Uint8Array(5 + byteCount)
  frame[0] = unitAddr
  frame[1] = 0x03
  frame[2] = byteCount
  for (let i = 0; i < values.length; i++) {
    frame[3 + i * 2] = (values[i] >> 8) & 0xff
    frame[4 + i * 2] = values[i] & 0xff
  }
  const crc = crc16(frame.slice(0, frame.length - 2))
  frame[frame.length - 2] = crc & 0xff
  frame[frame.length - 1] = (crc >> 8) & 0xff
  return frame
}

/** Builds a valid FC06 echo response frame. */
function buildWriteSingleResponse(unitAddr: number, address: number, value: number): Uint8Array {
  const frame = new Uint8Array(8)
  frame[0] = unitAddr
  frame[1] = 0x06
  frame[2] = (address >> 8) & 0xff
  frame[3] = address & 0xff
  frame[4] = (value >> 8) & 0xff
  frame[5] = value & 0xff
  const crc = crc16(frame.slice(0, 6))
  frame[6] = crc & 0xff
  frame[7] = (crc >> 8) & 0xff
  return frame
}

/** Builds a valid FC16 response frame. */
function buildWriteMultipleResponse(unitAddr: number, address: number, count: number): Uint8Array {
  const frame = new Uint8Array(8)
  frame[0] = unitAddr
  frame[1] = 0x10
  frame[2] = (address >> 8) & 0xff
  frame[3] = address & 0xff
  frame[4] = (count >> 8) & 0xff
  frame[5] = count & 0xff
  const crc = crc16(frame.slice(0, 6))
  frame[6] = crc & 0xff
  frame[7] = (crc >> 8) & 0xff
  return frame
}

// ---------------------------------------------------------------------------
// Frame construction tests
// ---------------------------------------------------------------------------

describe('ModbusRtuTransport – frame construction', () => {
  const transport = new ModbusRtuTransport(
    new Duplex({ read() {}, write(_c, _e, cb) { cb() } }),
    1
  )

  describe('buildReadRequest', () => {
    it('produces an 8-byte frame', () => {
      const frame = transport.buildReadRequest(4609, 1)
      expect(frame.length).toBe(8)
    })

    it('sets unit address as byte 0', () => {
      const frame = transport.buildReadRequest(4609, 1)
      expect(frame[0]).toBe(1)
    })

    it('sets function code 0x03', () => {
      const frame = transport.buildReadRequest(4609, 1)
      expect(frame[1]).toBe(0x03)
    })

    it('encodes register address big-endian in bytes 2–3', () => {
      const frame = transport.buildReadRequest(0x12ef, 1)
      expect(frame[2]).toBe(0x12)
      expect(frame[3]).toBe(0xef)
    })

    it('encodes register count big-endian in bytes 4–5', () => {
      const frame = transport.buildReadRequest(4609, 0x0003)
      expect(frame[4]).toBe(0x00)
      expect(frame[5]).toBe(0x03)
    })

    it('appends a valid CRC-16 in bytes 6–7 (low byte first)', () => {
      const frame = transport.buildReadRequest(4609, 1)
      const expectedCrc = crc16(frame.slice(0, 6))
      expect(extractCrc(frame)).toBe(expectedCrc)
    })

    it('uses the configured unit address', () => {
      const t = new ModbusRtuTransport(
        new Duplex({ read() {}, write(_c, _e, cb) { cb() } }),
        42
      )
      const frame = t.buildReadRequest(100, 1)
      expect(frame[0]).toBe(42)
    })
  })

  describe('buildWriteSingleRequest', () => {
    it('produces an 8-byte frame', () => {
      const frame = transport.buildWriteSingleRequest(4609, 1)
      expect(frame.length).toBe(8)
    })

    it('sets function code 0x06', () => {
      const frame = transport.buildWriteSingleRequest(4609, 1)
      expect(frame[1]).toBe(0x06)
    })

    it('encodes address big-endian in bytes 2–3', () => {
      const frame = transport.buildWriteSingleRequest(0xabcd, 0)
      expect(frame[2]).toBe(0xab)
      expect(frame[3]).toBe(0xcd)
    })

    it('encodes value big-endian in bytes 4–5', () => {
      const frame = transport.buildWriteSingleRequest(0, 0x1234)
      expect(frame[4]).toBe(0x12)
      expect(frame[5]).toBe(0x34)
    })

    it('appends a valid CRC-16', () => {
      const frame = transport.buildWriteSingleRequest(4609, 0)
      const expectedCrc = crc16(frame.slice(0, 6))
      expect(extractCrc(frame)).toBe(expectedCrc)
    })
  })

  describe('buildWriteMultipleRequest', () => {
    it('produces correct frame length for 2 values', () => {
      // 7 header bytes + 4 data bytes + 2 CRC = 13
      const frame = transport.buildWriteMultipleRequest(4609, [10, 20])
      expect(frame.length).toBe(13)
    })

    it('sets function code 0x10', () => {
      const frame = transport.buildWriteMultipleRequest(4609, [1])
      expect(frame[1]).toBe(0x10)
    })

    it('encodes register count in bytes 4–5', () => {
      const frame = transport.buildWriteMultipleRequest(4609, [10, 20, 30])
      expect(frame[4]).toBe(0x00)
      expect(frame[5]).toBe(0x03)
    })

    it('encodes byte count in byte 6', () => {
      const frame = transport.buildWriteMultipleRequest(4609, [10, 20, 30])
      expect(frame[6]).toBe(6) // 3 registers × 2 bytes
    })

    it('encodes values big-endian starting at byte 7', () => {
      const frame = transport.buildWriteMultipleRequest(4609, [0x1234, 0x5678])
      expect(frame[7]).toBe(0x12)
      expect(frame[8]).toBe(0x34)
      expect(frame[9]).toBe(0x56)
      expect(frame[10]).toBe(0x78)
    })

    it('appends a valid CRC-16', () => {
      const frame = transport.buildWriteMultipleRequest(4609, [0x0001, 0x0002])
      const payloadLen = frame.length - 2
      const expectedCrc = crc16(frame.slice(0, payloadLen))
      expect(extractCrc(frame)).toBe(expectedCrc)
    })
  })
})

// ---------------------------------------------------------------------------
// CRC-16 correctness
// ---------------------------------------------------------------------------

describe('CRC-16/Modbus', () => {
  it('known vector: [0x01, 0x03, 0x00, 0x00, 0x00, 0x01] → 0x0A84', () => {
    // CRC-16/Modbus of [01 03 00 00 00 01] = 0x0A84 (wire order: low=0x84 first, high=0x0A second)
    const payload = new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])
    expect(crc16(payload)).toBe(0x0a84)
  })

  it('empty buffer produces 0xFFFF', () => {
    expect(crc16(new Uint8Array([]))).toBe(0xffff)
  })
})

// ---------------------------------------------------------------------------
// readRegister / readRegisters
// ---------------------------------------------------------------------------

describe('ModbusRtuTransport – readRegister', () => {
  it('sends correct FC03 request and parses single register', async () => {
    const { stream, written, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegister(4609)
    // Emit valid response after a tick
    setImmediate(() => respond(buildReadResponse(1, [42])))

    const value = await responsePromise
    expect(value).toBe(42)

    const sentFrame = new Uint8Array(written[0])
    expect(sentFrame[0]).toBe(1)       // unit address
    expect(sentFrame[1]).toBe(0x03)    // FC03
    // address 4609 = 0x1201
    expect(sentFrame[2]).toBe(0x12)
    expect(sentFrame[3]).toBe(0x01)
    // count = 1
    expect(sentFrame[4]).toBe(0x00)
    expect(sentFrame[5]).toBe(0x01)
  })

  it('rejects on timeout when no response arrives', async () => {
    const { stream } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1, 50) // 50ms timeout

    await expect(transport.readRegister(4609)).rejects.toThrow(/timeout/i)
  })

  it('rejects when unit address in response does not match', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegister(4609)
    setImmediate(() => respond(buildReadResponse(2, [0]))) // wrong unit addr

    await expect(responsePromise).rejects.toThrow(/unit address mismatch/i)
  })

  it('rejects on Modbus exception response (high bit set on FC)', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // For a 1-register read, expectedBytes=7. The transport only inspects the response
    // once all expected bytes arrive, so we must send exactly 7 bytes with the error bit set.
    // The exception check precedes CRC validation, so the CRC on the padding bytes doesn't matter.
    const responsePromise = transport.readRegister(4609)
    setImmediate(() => {
      const frame = new Uint8Array(7)
      frame[0] = 1
      frame[1] = 0x83  // FC03 with error bit
      frame[2] = 0x02  // exception code 2
      // bytes 3-6: padding (transport checks exception before CRC)
      respond(frame)
    })

    await expect(responsePromise).rejects.toThrow(/exception/i)
  })

  it('rejects on CRC mismatch', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegister(4609)
    setImmediate(() => {
      const frame = buildReadResponse(1, [100])
      frame[frame.length - 1] ^= 0xff  // corrupt the CRC
      respond(frame)
    })

    await expect(responsePromise).rejects.toThrow(/CRC/i)
  })

  it('rejects on stream error', async () => {
    const { stream } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegister(4609)
    setImmediate(() => stream.emit('error', new Error('serial port disconnected')))

    await expect(responsePromise).rejects.toThrow('serial port disconnected')
  })

  it('rejects when stream.write() throws synchronously', async () => {
    const stream = new Duplex({
      read() {},
      write() {
        throw new Error('port not open')
      },
    })
    const transport = new ModbusRtuTransport(stream, 1)

    await expect(transport.readRegister(4609)).rejects.toThrow('port not open')
  })

  it('uses default unit address (1) and timeout (1000ms) when omitted', async () => {
    const { stream, written, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream) // no unitAddress/timeoutMs

    const responsePromise = transport.readRegister(4609)
    setImmediate(() => respond(buildReadResponse(1, [42])))
    expect(await responsePromise).toBe(42)

    expect(new Uint8Array(written[0])[0]).toBe(1) // default unit address
  })
})

describe('ModbusRtuTransport – readRegisters', () => {
  it('reads multiple consecutive registers', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegisters(4354, 3)
    setImmediate(() => respond(buildReadResponse(1, [0x6ac3, 0x6b00, 0x6aff])))

    const result = await responsePromise
    expect(result.length).toBe(3)
    expect(result[0]).toBe(0x6ac3)
    expect(result[1]).toBe(0x6b00)
    expect(result[2]).toBe(0x6aff)
  })

  it('rejects when byte count in response does not match', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // Request 2 registers → expectedBytes = 9. Send 9 bytes but with byteCount=2 (says 1 register, not 2).
    // The byte-count check runs before CRC, so padding bytes are fine.
    const responsePromise = transport.readRegisters(4354, 2)
    setImmediate(() => {
      const frame = new Uint8Array(9)
      frame[0] = 1
      frame[1] = 0x03
      frame[2] = 2   // claims 2 bytes (1 register) but we requested 2 registers (4 bytes expected)
      // bytes 3-8: padding
      respond(frame)
    })

    await expect(responsePromise).rejects.toThrow(/byte count mismatch/i)
  })

  it('rejects when response function code is neither FC03 nor an exception', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // 1-register read → expectedBytes = 7. FC=0x04 (no error bit, wrong function code).
    const responsePromise = transport.readRegister(4609)
    setImmediate(() => {
      const frame = new Uint8Array(7)
      frame[0] = 1
      frame[1] = 0x04
      respond(frame)
    })

    await expect(responsePromise).rejects.toThrow(/unexpected function code/i)
  })
})

// ---------------------------------------------------------------------------
// writeRegister (FC06)
// ---------------------------------------------------------------------------

describe('ModbusRtuTransport – writeRegister', () => {
  it('sends FC06 request and resolves on valid echo', async () => {
    const { stream, written, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const writePromise = transport.writeRegister(4609, 1)
    setImmediate(() => respond(buildWriteSingleResponse(1, 4609, 1)))

    await writePromise

    const sentFrame = new Uint8Array(written[0])
    expect(sentFrame[1]).toBe(0x06)  // FC06
  })

  it('rejects when write response unit address mismatches', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const writePromise = transport.writeRegister(4609, 1)
    setImmediate(() => respond(buildWriteSingleResponse(2, 4609, 1)))  // wrong addr

    await expect(writePromise).rejects.toThrow(/unit address mismatch/i)
  })

  it('rejects on exception response during write', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // writeRegister expects 8 bytes; send 8 bytes with error bit set
    const writePromise = transport.writeRegister(4609, 1)
    setImmediate(() => {
      const frame = new Uint8Array(8)
      frame[0] = 1
      frame[1] = 0x86  // FC06 with error bit
      frame[2] = 0x01  // exception code
      // bytes 3-7: padding (exception check precedes CRC)
      respond(frame)
    })

    await expect(writePromise).rejects.toThrow(/exception/i)
  })

  it('rejects on CRC mismatch in write response', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const writePromise = transport.writeRegister(4609, 1)
    setImmediate(() => {
      const frame = buildWriteSingleResponse(1, 4609, 1)
      frame[frame.length - 1] ^= 0xff  // corrupt CRC
      respond(frame)
    })

    await expect(writePromise).rejects.toThrow(/CRC/i)
  })

  it('rejects when write response function code is neither FC06 nor an exception', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // writeRegister expects 8 bytes; FC=0x07 (no error bit, wrong function code).
    const writePromise = transport.writeRegister(4609, 1)
    setImmediate(() => {
      const frame = new Uint8Array(8)
      frame[0] = 1
      frame[1] = 0x07
      respond(frame)
    })

    await expect(writePromise).rejects.toThrow(/unexpected function code/i)
  })
})

// ---------------------------------------------------------------------------
// writeRegisters
// ---------------------------------------------------------------------------

describe('ModbusRtuTransport – writeRegisters', () => {
  it('resolves immediately for empty values array', async () => {
    const { stream } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)
    await expect(transport.writeRegisters(4609, [])).resolves.toBeUndefined()
  })

  it('uses FC06 for a single value', async () => {
    const { stream, written, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const p = transport.writeRegisters(4609, [5])
    setImmediate(() => respond(buildWriteSingleResponse(1, 4609, 5)))
    await p

    const sentFrame = new Uint8Array(written[0])
    expect(sentFrame[1]).toBe(0x06)  // FC06 for single register
  })

  it('uses FC16 for multiple values', async () => {
    const { stream, written, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const p = transport.writeRegisters(4609, [1, 2, 3])
    setImmediate(() => respond(buildWriteMultipleResponse(1, 4609, 3)))
    await p

    const sentFrame = new Uint8Array(written[0])
    expect(sentFrame[1]).toBe(0x10)  // FC16 for multiple registers
  })

  it('rejects on FC16 exception response', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // FC16 response is always 8 bytes; send 8 bytes with error bit set
    const p = transport.writeRegisters(4609, [1, 2])
    setImmediate(() => {
      const frame = new Uint8Array(8)
      frame[0] = 1
      frame[1] = 0x90  // FC16 (0x10) with error bit
      frame[2] = 0x02  // exception code
      // bytes 3-7: padding (exception check precedes CRC)
      respond(frame)
    })

    await expect(p).rejects.toThrow(/exception/i)
  })

  it('rejects when FC16 response unit address mismatches', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const p = transport.writeRegisters(4609, [1, 2])
    setImmediate(() => respond(buildWriteMultipleResponse(2, 4609, 2)))  // wrong addr

    await expect(p).rejects.toThrow(/unit address mismatch/i)
  })

  it('rejects when FC16 response function code is neither FC16 nor an exception', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    // FC16 response is always 8 bytes; FC=0x11 (no error bit, wrong function code).
    const p = transport.writeRegisters(4609, [1, 2])
    setImmediate(() => {
      const frame = new Uint8Array(8)
      frame[0] = 1
      frame[1] = 0x11
      respond(frame)
    })

    await expect(p).rejects.toThrow(/unexpected function code/i)
  })

  it('handles chunked data delivery (bytes arriving in multiple events)', async () => {
    const { stream, respond } = makeFakeStream()
    const transport = new ModbusRtuTransport(stream, 1)

    const responsePromise = transport.readRegister(4609)
    const full = buildReadResponse(1, [99])

    // Send response in two chunks
    setImmediate(() => {
      respond(full.slice(0, 3))
      setImmediate(() => respond(full.slice(3)))
    })

    const value = await responsePromise
    expect(value).toBe(99)
  })
})
