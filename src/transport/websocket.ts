import WebSocket from 'ws'
import type { Transport, WebSocketTransportConfig } from '../types.js'

/** Total number of uint16 values in a READ_TABLES response. */
const WS_BUFFER_SIZE = 705

/** WebSocket command: read all register tables in one shot. */
const WS_COMMAND_READ_TABLES = 246

/** WebSocket command: write one or more register values. */
const WS_COMMAND_WRITE_DATA = 249

/**
 * Describes one contiguous block of Modbus registers within the WS response buffer.
 *
 * The unit's READ_TABLES command returns all register groups concatenated into a
 * single 705-word buffer. Each group covers a named address range and is placed at
 * a fixed position (`bufferStart`) in that buffer.
 *
 * For a register address `a` in (rangeStart, rangeEnd]:
 *   bufferIndex = a - rangeStart + bufferStart - 1
 */
interface BufferRegion {
  /** Human-readable description of the registers contained in this region. */
  readonly name: string
  /** Exclusive lower bound of the Modbus register address range. */
  readonly rangeStart: number
  /** Inclusive upper bound of the Modbus register address range. */
  readonly rangeEnd: number
  /**
   * Index in the WS buffer at which this region begins.
   * Each value equals the cumulative slot count of all preceding regions plus one,
   * matching the layout produced by the firmware's own offset table.
   *
   * Preceding slot counts: unit_info(36), panel_info(27), hw_state(43),
   * sw_state(25), clock(7), outputs(7), inputs(7), network_config(30),
   * mode_settings(76), timer_settings(23), self_test(16), faults(200), schedule(169).
   */
  readonly bufferStart: number
}

/**
 * All register groups present in the READ_TABLES response buffer, in layout order.
 */
const WS_REGIONS: ReadonlyArray<BufferRegion> = [
  // Unit identity and firmware version (addresses 1–35)
  { name: 'unit_info',       rangeStart: 0,     rangeEnd: 35,    bufferStart: 1   },
  // Control panel identity and firmware version (addresses 257–282)
  { name: 'panel_info',      rangeStart: 256,   rangeEnd: 282,   bufferStart: 37  },
  // Live sensor readings: temperatures, RH, CO2, fan RPM (addresses 4353–4394)
  { name: 'hw_state',        rangeStart: 4352,  rangeEnd: 4394,  bufferStart: 64  },
  // Operating state: mode, timers, filter, fault flag (addresses 4609–4632)
  { name: 'sw_state',        rangeStart: 4608,  rangeEnd: 4632,  bufferStart: 107 },
  // Real-time clock: minute, hour, day, month, year, weekday (addresses 4849–4854)
  { name: 'clock',           rangeStart: 4848,  rangeEnd: 4854,  bufferStart: 132 },
  // Digital/analog output states (addresses 4865–4870)
  { name: 'outputs',         rangeStart: 4864,  rangeEnd: 4870,  bufferStart: 139 },
  // Digital/analog input states (addresses 5121–5126)
  { name: 'inputs',          rangeStart: 5120,  rangeEnd: 5126,  bufferStart: 146 },
  // Network and Modbus configuration: IP, gateway, cloud (addresses 8193–8221)
  { name: 'network_config',  rangeStart: 8192,  rangeEnd: 8221,  bufferStart: 153 },
  // Per-mode settings: fan speeds, supply temps, RH/CO2 control (addresses 20481–20555)
  { name: 'mode_settings',   rangeStart: 20480, rangeEnd: 20555, bufferStart: 183 },
  // Timer enables, access level, clock format, language (addresses 21761–21782)
  { name: 'timer_settings',  rangeStart: 21760, rangeEnd: 21782, bufferStart: 259 },
  // Self-test results for fans, bypass, heater, efficiency (addresses 32769–32783)
  { name: 'self_test',       rangeStart: 32768, rangeEnd: 32783, bufferStart: 282 },
  // Fault log: total count plus up to 33 fault entries (addresses 36865–37063)
  { name: 'faults',          rangeStart: 36864, rangeEnd: 37063, bufferStart: 298 },
  // Weekly schedule: 168 hourly slots Mon 00:00 – Sun 23:00 (addresses 40961–41128)
  { name: 'schedule',        rangeStart: 40960, rangeEnd: 41128, bufferStart: 498 },
]

/**
 * Maps a Modbus register address to its index in the WS receive buffer.
 * Returns -1 if the address does not fall within any known region.
 */
function addressToBufferIndex(address: number): number {
  for (const { rangeStart, rangeEnd, bufferStart } of WS_REGIONS) {
    if (address > rangeStart && address <= rangeEnd) {
      return address - rangeStart + bufferStart - 1
    }
  }
  return -1
}

interface Cache {
  buffer: Uint16Array
  timestamp: number
}

/**
 * WebSocket transport for Vallox units using the proprietary binary WebSocket protocol.
 *
 * The unit exposes a WebSocket endpoint at `ws://host:port/`. Each exchange is a
 * single request/response pair over a fresh connection. READ_TABLES fetches the
 * entire register set (705 uint16 values) in one message; WRITE_DATA writes one or
 * more register/value pairs.
 */
export class WebSocketTransport implements Transport {
  readonly #host: string
  readonly #port: number
  readonly #cacheTtlMs: number
  #cache: Cache | null = null

  /**
   * @param config        Host and port of the Vallox unit.
   * @param cacheTtlMs    How long (ms) to reuse a cached READ_TABLES response (default 1000 ms).
   */
  constructor(config: WebSocketTransportConfig, cacheTtlMs = 1000) {
    this.#host = config.host
    this.#port = config.port
    this.#cacheTtlMs = cacheTtlMs
  }

  // ---------------------------------------------------------------------------
  // Frame construction
  // ---------------------------------------------------------------------------

  /**
   * Builds a binary WebSocket frame as an ArrayBuffer containing big-endian uint16 values.
   *
   * For READ_TABLES:
   *   [3, 246, 0, checksum]  (4 words)
   *
   * For WRITE_DATA with N address/value pairs:
   *   [N*2+2, 249, addr0, val0, ..., addrN, valN, checksum]
   *
   * Writes directly into a DataView in a single pass, accumulating the checksum
   * as each word is placed, then writes the checksum word last.
   */
  #buildFrame(command: number, data: readonly number[]): ArrayBuffer {
    // READ_TABLES always has exactly 4 words: [len, cmd, 0, checksum]
    // WRITE_DATA has data.length payload words + 3 mandatory: [len, cmd, ...data, checksum]
    const wordCount = command === WS_COMMAND_READ_TABLES ? 4 : data.length + 3
    const ab = new ArrayBuffer(wordCount * 2)
    const dv = new DataView(ab)

    // Payload words (everything except the trailing checksum word).
    const payload: number[] = [
      wordCount - 1,   // length field = total words minus one
      command,
      ...(command === WS_COMMAND_READ_TABLES ? [0] : data),
    ]

    let checksum = 0
    for (const [i, word] of payload.entries()) {
      dv.setUint16(i * 2, word, false /* big-endian */)
      checksum = (checksum + word) & 0xffff
    }

    // Checksum occupies the final word.
    dv.setUint16((wordCount - 1) * 2, checksum, false /* big-endian */)

    return ab
  }

  // ---------------------------------------------------------------------------
  // Low-level I/O
  // ---------------------------------------------------------------------------

  /**
   * Sends a frame to the unit and resolves with the raw response ArrayBuffer.
   *
   * The WebSocket connection is closed automatically via a `using` declaration
   * (TS 5.2 / ES2025 Symbol.dispose) once the awaited response promise settles,
   * keeping resource cleanup declarative and separate from message handling.
   */
  async #sendFrame(frame: ArrayBuffer): Promise<ArrayBuffer> {
    const url = `ws://${this.#host}:${this.#port}/`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    // Declared here; ws.close() is called automatically when this scope exits
    // (i.e. after `return await` below resolves or rejects).
    using _ws = { [Symbol.dispose](): void { ws.close() } } satisfies Disposable

    return await new Promise<ArrayBuffer>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(Buffer.from(frame))
      })

      ws.on('message', (data: WebSocket.RawData) => {
        if (data instanceof ArrayBuffer) {
          resolve(data)
        } else if (Buffer.isBuffer(data)) {
          resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        } else {
          reject(new Error('Unexpected WebSocket message type'))
        }
      })

      ws.on('error', (err: Error) => {
        reject(err)
      })
    })
  }

  /**
   * Fetches the full register table from the unit (READ_TABLES command).
   * Parses the response into a Uint16Array of WS_BUFFER_SIZE big-endian uint16 values.
   */
  async #fetchAllRegisters(): Promise<Uint16Array> {
    const frame = this.#buildFrame(WS_COMMAND_READ_TABLES, [])
    const dv = new DataView(await this.#sendFrame(frame))
    const wordsAvailable = Math.min(dv.byteLength / 2, WS_BUFFER_SIZE)

    const result = new Uint16Array(WS_BUFFER_SIZE)
    result.set(Uint16Array.from({ length: wordsAvailable }, (_, i) => dv.getUint16(i * 2, false /* big-endian */)))
    return result
  }

  /**
   * Returns a fresh or cached copy of the register buffer.
   */
  async #getCachedBuffer(): Promise<Uint16Array> {
    const now = Date.now()
    if (this.#cache !== null && now - this.#cache.timestamp < this.#cacheTtlMs) {
      return this.#cache.buffer
    }
    const buffer = await this.#fetchAllRegisters()
    this.#cache = { buffer, timestamp: now }
    return buffer
  }

  /** Invalidates the register cache, forcing the next read to re-fetch. */
  #invalidateCache(): void {
    this.#cache = null
  }

  // ---------------------------------------------------------------------------
  // Transport interface implementation
  // ---------------------------------------------------------------------------

  /**
   * Reads a single register value.
   * Uses the cached READ_TABLES buffer if available and the address is in a known region.
   */
  async readRegister(address: number): Promise<number> {
    const idx = addressToBufferIndex(address)
    if (idx < 0) {
      throw new Error(`Register address ${address} is not in any known WS buffer region`)
    }
    const buf = await this.#getCachedBuffer()
    return buf[idx]
  }

  /**
   * Reads `count` consecutive registers starting at `address`.
   * All requested addresses must fall within the same WS buffer region.
   */
  async readRegisters(address: number, count: number): Promise<Uint16Array> {
    const buf = await this.#getCachedBuffer()
    return Uint16Array.from({ length: count }, (_, i) => {
      const idx = addressToBufferIndex(address + i)
      if (idx < 0) throw new Error(`Register address ${address + i} is not in any known WS buffer region`)
      return buf[idx]
    })
  }

  /**
   * Writes a single register value.
   * Sends a WRITE_DATA frame and invalidates the local cache.
   */
  async writeRegister(address: number, value: number): Promise<void> {
    const frame = this.#buildFrame(WS_COMMAND_WRITE_DATA, [address, value])
    await this.#sendFrame(frame)
    this.#invalidateCache()
  }

  /**
   * Writes multiple register values starting at `address`.
   * All values are sent in a single WRITE_DATA frame.
   * `address` is used as the base; each value corresponds to address, address+1, …
   */
  async writeRegisters(address: number, values: readonly number[]): Promise<void> {
    if (values.length === 0) return

    // Build interleaved [addr0, val0, addr1, val1, ...] array
    const pairs = values.flatMap((value, i) => [address + i, value])
    const frame = this.#buildFrame(WS_COMMAND_WRITE_DATA, pairs)
    await this.#sendFrame(frame)
    this.#invalidateCache()
  }
}
