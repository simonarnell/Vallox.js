import type { Duplex } from 'node:stream'
import type { Transport } from '../types.js'

// ---------------------------------------------------------------------------
// CRC-16/Modbus
// ---------------------------------------------------------------------------

/**
 * Computes the CRC-16/Modbus checksum for the given byte buffer.
 * Returns a 16-bit value where the low byte should be transmitted first.
 */
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

// ---------------------------------------------------------------------------
// ModbusRtuTransport
// ---------------------------------------------------------------------------

/**
 * Standard Modbus RTU transport over any Node.js Duplex stream (e.g. a serial port).
 *
 * Implements the Transport interface using:
 *  - FC03 (Read Holding Registers) for readRegister / readRegisters
 *  - FC06 (Write Single Register) for single-register writes
 *  - FC16 (Write Multiple Registers) for multi-register writes
 */
export class ModbusRtuTransport implements Transport {
  readonly #stream: Duplex
  readonly #unitAddress: number
  readonly #timeoutMs: number

  /**
   * @param stream        A Node.js Duplex stream connected to the RS-485 bus (e.g. a SerialPort).
   * @param unitAddress   Modbus unit/slave address of the Vallox unit (default 1).
   * @param timeoutMs     Maximum time (ms) to wait for a response (default 1000 ms).
   */
  constructor(stream: Duplex, unitAddress = 1, timeoutMs = 1000) {
    this.#stream = stream
    this.#unitAddress = unitAddress
    this.#timeoutMs = timeoutMs
  }

  // ---------------------------------------------------------------------------
  // Request builders
  // ---------------------------------------------------------------------------

  /**
   * Builds a Modbus FC03 (Read Holding Registers) request frame.
   * @param address  Starting register address, as listed in the Vallox Modbus manual.
   * @param count    Number of registers to read.
   */
  buildReadRequest(address: number, count: number): Uint8Array {
    const buf = new ArrayBuffer(6)
    const view = new DataView(buf)
    view.setUint8(0, this.#unitAddress)
    view.setUint8(1, 0x03)
    view.setUint16(2, address)
    view.setUint16(4, count)
    return this.#appendCrc(new Uint8Array(buf))
  }

  /**
   * Builds a Modbus FC06 (Write Single Register) request frame.
   */
  buildWriteSingleRequest(address: number, value: number): Uint8Array {
    const buf = new ArrayBuffer(6)
    const view = new DataView(buf)
    view.setUint8(0, this.#unitAddress)
    view.setUint8(1, 0x06)
    view.setUint16(2, address)
    view.setUint16(4, value)
    return this.#appendCrc(new Uint8Array(buf))
  }

  /**
   * Builds a Modbus FC16 (Write Multiple Registers, function code 0x10) request frame.
   */
  buildWriteMultipleRequest(address: number, values: readonly number[]): Uint8Array {
    const count = values.length
    const byteCount = count * 2
    // Header (7 bytes) + data (byteCount bytes) + CRC (2 bytes)
    const buf = new ArrayBuffer(7 + byteCount)
    const view = new DataView(buf)
    view.setUint8(0, this.#unitAddress)
    view.setUint8(1, 0x10)
    view.setUint16(2, address)
    view.setUint16(4, count)
    view.setUint8(6, byteCount)
    for (const [i, value] of values.entries()) {
      view.setUint16(7 + i * 2, value)
    }
    return this.#appendCrc(new Uint8Array(buf))
  }

  /**
   * Appends a CRC-16 (low byte first, high byte second) to a frame without CRC.
   */
  #appendCrc(frameWithoutCrc: Uint8Array): Uint8Array {
    const crc = crc16(frameWithoutCrc)
    const result = new Uint8Array(frameWithoutCrc.length + 2)
    result.set(frameWithoutCrc)
    new DataView(result.buffer).setUint16(frameWithoutCrc.length, crc, true) // little-endian
    return result
  }

  // ---------------------------------------------------------------------------
  // Low-level I/O
  // ---------------------------------------------------------------------------

  /**
   * Sends a request frame over the stream and collects exactly `expectedBytes` of response.
   * Rejects if the response does not arrive within `timeoutMs`.
   */
  sendReceive(request: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = []
      let receivedLength = 0
      let timer: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        this.#stream.removeListener('data', onData)
        this.#stream.removeListener('error', onError)
      }

      const onData = (chunk: Buffer): void => {
        chunks.push(chunk)
        receivedLength += chunk.byteLength
        if (receivedLength >= expectedBytes) {
          cleanup()
          resolve(new Uint8Array(Buffer.concat(chunks).subarray(0, expectedBytes)))
        }
      }

      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }

      this.#stream.on('data', onData)
      this.#stream.on('error', onError)

      timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Modbus RTU timeout: expected ${expectedBytes} bytes, received ${receivedLength}`
          )
        )
      }, this.#timeoutMs)

      try {
        this.#stream.write(Buffer.from(request))
      } catch (err) {
        cleanup()
        reject(err)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // CRC validation
  // ---------------------------------------------------------------------------

  /**
   * Validates that the CRC appended to a response frame is correct.
   * Throws if invalid.
   */
  #validateCrc(frame: Uint8Array): void {
    const payload = frame.subarray(0, frame.length - 2)
    const receivedCrc = new DataView(frame.buffer, frame.byteOffset + frame.length - 2).getUint16(0, true)
    const computedCrc = crc16(payload)
    if (receivedCrc !== computedCrc) {
      throw new Error(
        `Modbus RTU CRC mismatch: received 0x${receivedCrc.toString(16).padStart(4, '0')}, ` +
        `computed 0x${computedCrc.toString(16).padStart(4, '0')}`
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Transport interface implementation
  // ---------------------------------------------------------------------------

  /**
   * Reads a single holding register using FC03.
   */
  async readRegister(address: number): Promise<number> {
    const values = await this.readRegisters(address, 1)
    return values[0]
  }

  /**
   * Reads `count` consecutive holding registers using FC03.
   * The response structure is:
   *   [unitAddr, 0x03, byteCount, dataHi0, dataLo0, ..., crcLo, crcHi]
   * Expected response length = 5 + count * 2.
   */
  async readRegisters(address: number, count: number): Promise<Uint16Array> {
    const request = this.buildReadRequest(address, count)
    const expectedBytes = 5 + count * 2
    const response = await this.sendReceive(request, expectedBytes)

    // Validate unit address
    if (response[0] !== this.#unitAddress) {
      throw new Error(
        `Modbus RTU response unit address mismatch: expected ${this.#unitAddress}, got ${response[0]}`
      )
    }

    // Check for exception response (high bit set on function code)
    if ((response[1] & 0x80) !== 0) {
      const exceptionCode = response[2]
      throw new Error(`Modbus RTU exception response: FC=0x${(response[1] & 0x7f).toString(16)}, exception code ${exceptionCode}`)
    }

    if (response[1] !== 0x03) {
      throw new Error(`Modbus RTU unexpected function code in response: 0x${response[1].toString(16)}`)
    }

    const byteCount = response[2]
    if (byteCount !== count * 2) {
      throw new Error(`Modbus RTU FC03 byte count mismatch: expected ${count * 2}, got ${byteCount}`)
    }

    this.#validateCrc(response)

    const dataView = new DataView(response.buffer, response.byteOffset + 3)
    return Uint16Array.from({ length: count }, (_, i) => dataView.getUint16(i * 2))
  }

  /**
   * Writes a single register using FC06.
   * The unit echoes the full request as its response (8 bytes).
   */
  async writeRegister(address: number, value: number): Promise<void> {
    const request = this.buildWriteSingleRequest(address, value)
    const expectedBytes = 8
    const response = await this.sendReceive(request, expectedBytes)

    if (response[0] !== this.#unitAddress) {
      throw new Error(
        `Modbus RTU write response unit address mismatch: expected ${this.#unitAddress}, got ${response[0]}`
      )
    }

    if ((response[1] & 0x80) !== 0) {
      const exceptionCode = response[2]
      throw new Error(`Modbus RTU exception response on write: FC=0x${(response[1] & 0x7f).toString(16)}, exception code ${exceptionCode}`)
    }

    if (response[1] !== 0x06) {
      throw new Error(`Modbus RTU unexpected function code in write response: 0x${response[1].toString(16)}`)
    }

    this.#validateCrc(response)
  }

  /**
   * Writes multiple registers.
   * Uses FC06 for a single register, FC16 for multiple registers.
   */
  async writeRegisters(address: number, values: readonly number[]): Promise<void> {
    if (values.length === 0) return

    if (values.length === 1) {
      await this.writeRegister(address, values[0])
      return
    }

    // FC16 response: [unitAddr, 0x10, addrHi, addrLo, countHi, countLo, crcLo, crcHi] = 8 bytes
    const request = this.buildWriteMultipleRequest(address, values)
    const expectedBytes = 8
    const response = await this.sendReceive(request, expectedBytes)

    if (response[0] !== this.#unitAddress) {
      throw new Error(
        `Modbus RTU FC16 response unit address mismatch: expected ${this.#unitAddress}, got ${response[0]}`
      )
    }

    if ((response[1] & 0x80) !== 0) {
      const exceptionCode = response[2]
      throw new Error(`Modbus RTU exception response on FC16 write: exception code ${exceptionCode}`)
    }

    if (response[1] !== 0x10) {
      throw new Error(`Modbus RTU unexpected function code in FC16 response: 0x${response[1].toString(16)}`)
    }

    this.#validateCrc(response)
  }
}
