import { WebSocketServer, type WebSocket } from 'ws'
import {
  WS_BUFFER_SIZE,
  WS_COMMAND_READ_TABLES,
  WS_COMMAND_WRITE_DATA,
  WS_COMMAND_LOG_RAW,
  WS_REGIONS,
  addressToBufferIndex,
  LOG_PAGE_SIZE,
  LOG_PAGE_OFFSETS,
  LOG_RECORD_SIZE,
} from '../transport/websocket.js'
import { Registers, POWER_ON, type RegisterName } from '../registers.js'
import type { HistorySample } from '../types.js'
import { HistoryChannel } from '../types.js'

/**
 * Channels the mock server can place into its simulated history log, keyed by
 * the same page offsets `WebSocketTransport.getHistory()` reads from. Only
 * channels 0–5 (temperatures + MAX_CO2/MAX_HUMIDITY) have a well-understood
 * page mapping — see the doc comment on `LOG_PAGE_OFFSETS` in websocket.ts.
 */
const HISTORY_PAGE_CHANNELS: readonly HistoryChannel[] = [
  HistoryChannel.EXTRACT_AIR_TEMP,
  HistoryChannel.EXHAUST_AIR_TEMP,
  HistoryChannel.OUTDOOR_AIR_TEMP,
  HistoryChannel.SUPPLY_AIR_TEMP,
  HistoryChannel.MAX_CO2,
  HistoryChannel.MAX_HUMIDITY,
]

/** Centikelvin equivalent of a plausible room temperature, used for default register values. */
function celsiusToCk(celsius: number): number {
  return Math.round(celsius * 100 + 27315)
}

/**
 * Register defaults describing a healthy, running "Vallox 110 MV" unit —
 * enough for `ValloxClient`'s full read surface to resolve to plausible
 * values out of the box. Overridable per-register via the constructor or
 * `setRegister`.
 */
function defaultRegisters(): Map<number, number> {
  const map = new Map<number, number>()
  const set = (name: RegisterName, value: number): void => {
    map.set(Registers[name], value)
  }

  // Unit identity
  set('MACHINE_TYPE', 2) // '3702'
  set('MACHINE_MODEL', 2) // 'Vallox 110 MV'
  set('SERIAL_NUMBER_MSW', 0x9675)
  set('SERIAL_NUMBER_LSW', 0x2ecd)
  // APPL_SW_VERSION_START..+9, byte-swapped per-register, e.g. "3.1.6"
  const swVersionWords = [0, 0, 0, 0, 0, 0, 3, 1, 6]
  for (const [i, word] of swVersionWords.entries()) {
    map.set(Registers.APPL_SW_VERSION_START + i, ((word & 0xff) << 8) | ((word >> 8) & 0xff))
  }

  // Live sensor readings
  set('FAN_SPEED', 45)
  set('EXTRACT_AIR_TEMP', celsiusToCk(21))
  set('EXHAUST_AIR_TEMP', celsiusToCk(3))
  set('OUTDOOR_AIR_TEMP', celsiusToCk(5))
  set('SUPPLY_CELL_AIR_TEMP', celsiusToCk(17))
  set('SUPPLY_AIR_TEMP', celsiusToCk(19))
  set('EXTRACT_FAN_RPM', 1450)
  set('SUPPLY_FAN_RPM', 1420)
  set('RH_VALUE', 42)
  set('CO2_VALUE', 650)

  // Software state
  set('HOME_AWAY', 0) // Home
  set('ON_OFF', POWER_ON)
  set('DEFROSTING', 0)
  set('BOOST_TIMER', 0)
  set('CUSTOM_TIMER', 0)
  set('PROG_INPUT_TIMER', 0)
  set('HR_CELL_STATUS', 0) // heat recovery
  set('TOTAL_UP_TIME_YEARS', 1)
  set('TOTAL_UP_TIME_HOURS', 500)
  set('CURRENT_UP_TIME_HOURS', 12)
  set('REMAINING_FILTER_DAYS', 100)
  set('CRITICAL_FAULT_ACTIVE', 0)

  // Device clock
  const now = new Date()
  set('MINUTE', now.getMinutes())
  set('HOUR', now.getHours())
  set('DAY', now.getDate())
  set('MONTH', now.getMonth() + 1)
  set('YEAR', now.getFullYear() - 2000)
  set('WEEKDAY', now.getDay() === 0 ? 7 : now.getDay())

  // Settings
  set('AWAY_SPEED', 30)
  set('AWAY_SUPPLY_TEMP', celsiusToCk(16))
  set('HOME_SPEED', 50)
  set('HOME_SUPPLY_TEMP', celsiusToCk(18))
  set('BOOST_SPEED', 80)
  set('BOOST_SUPPLY_TEMP', celsiusToCk(18))
  set('CUSTOM_EXTRACT_SPEED', 30)
  set('CUSTOM_SUPPLY_SPEED', 0)
  set('CUSTOM_SUPPLY_TEMP', celsiusToCk(18))
  set('RH_THRESHOLD', 40)
  set('CO2_THRESHOLD', 900)
  set('FILTER_CHANGE_INTERVAL', 180)

  // Faults
  set('TOTAL_FAULT_COUNT', 0)

  return map
}

/** Parses a little-endian request frame into an array of uint16 words. */
function parseFrame(data: Buffer): number[] {
  const words: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) {
    words.push(data.readUInt16LE(i))
  }
  return words
}

export interface MockValloxServerOptions {
  /** Port to listen on. Defaults to 0 (OS-assigned ephemeral port). */
  port?: number
  /**
   * Address to bind to. Defaults to '127.0.0.1' (host-only — the common
   * case for same-process/same-machine tests). Pass '0.0.0.0' to accept
   * connections from other hosts — e.g. a Docker container reaching this
   * process via `host.docker.internal` in an integration test.
   */
  host?: string
  /** Register values to seed on top of {@link defaultRegisters}, keyed by name (see `Registers`). */
  initialRegisters?: Partial<Record<RegisterName, number>>
  /** History samples returned by a LOG_RAW request. Defaults to none. */
  history?: readonly HistorySample[]
}

/**
 * A minimal, real WebSocket server that speaks the same binary protocol as a
 * physical Vallox unit's built-in web server (READ_TABLES / WRITE_DATA /
 * LOG_RAW — see `WebSocketTransport`), for integration-testing consumers of
 * this library against a real socket instead of a hand-mocked `ws` client.
 *
 * Holds register state as a `Map<address, value>` rather than the unit's own
 * 705-word buffer layout; `#buildReadTablesResponse` projects that map into
 * the buffer layout `WebSocketTransport` expects on every READ_TABLES
 * request, so `setRegister` never needs to know about buffer indices.
 */
export class MockValloxServer {
  #wss: WebSocketServer | undefined
  #requestedPort: number
  #bindHost: string
  #registers: Map<number, number>
  #history: readonly HistorySample[]

  constructor(options: MockValloxServerOptions = {}) {
    this.#requestedPort = options.port ?? 0
    this.#bindHost = options.host ?? '127.0.0.1'
    this.#registers = defaultRegisters()
    this.#history = options.history ?? []

    for (const [name, value] of Object.entries(options.initialRegisters ?? {})) {
      this.#registers.set(Registers[name as RegisterName], value as number)
    }
  }

  /** Starts listening. Resolves once the underlying server is ready to accept connections. */
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.#requestedPort, host: this.#bindHost })
      wss.once('listening', () => {
        this.#wss = wss
        resolve()
      })
      wss.once('error', reject)
      wss.on('connection', (ws) => this.#handleConnection(ws))
    })
  }

  /** Stops the server and closes any open connections. */
  async stop(): Promise<void> {
    const wss = this.#wss
    if (!wss) return
    await new Promise<void>((resolve, reject) => {
      wss.close((err) =>
        /* istanbul ignore next -- ws's Server.close() doesn't error for any reachable
           usage of this class (verified: even concurrent stop() calls both resolve
           cleanly); this is a defensive handler for an error path ws's own types
           allow but this class can't actually trigger. */
        err ? reject(err) : resolve(),
      )
      for (const client of wss.clients) client.terminate()
    })
    this.#wss = undefined
  }

  /** The port actually bound (useful when constructed with `port: 0`). */
  get port(): number {
    const address = this.#wss?.address()
    if (!address || typeof address === 'string') {
      throw new Error('MockValloxServer is not listening')
    }
    return address.port
  }

  readonly host = '127.0.0.1'

  /** Sets a single register's value by name (see `Registers`). */
  setRegister(name: RegisterName, value: number): void {
    this.#registers.set(Registers[name], value)
  }

  /** Reads a single register's current value by name (see `Registers`). */
  getRegister(name: RegisterName): number {
    return this.#registers.get(Registers[name]) ?? 0
  }

  /** Replaces the samples returned by a subsequent LOG_RAW (history) request. */
  setHistory(samples: readonly HistorySample[]): void {
    this.#history = samples
  }

  // ---------------------------------------------------------------------
  // Protocol handling
  // ---------------------------------------------------------------------

  #handleConnection(ws: WebSocket): void {
    ws.on('message', (data: Buffer) => {
      // istanbul ignore next -- the `ws` server always hands binary messages to this
      // handler as a Buffer, never a raw ArrayBuffer; this class never sets
      // `ws.binaryType` on a connection, which is the only thing that would change
      // that. Kept as a type-safe fallback for `WebSocket.RawData`'s wider type, not
      // because the else branch is reachable in practice.
      const words = parseFrame(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
      const command = words[1]

      switch (command) {
        case WS_COMMAND_READ_TABLES:
          ws.send(this.#buildReadTablesResponse())
          break
        case WS_COMMAND_WRITE_DATA:
          this.#applyWrite(words)
          ws.send(new ArrayBuffer(0))
          break
        case WS_COMMAND_LOG_RAW:
          ws.send(new ArrayBuffer(8)) // ack
          ws.send(this.#buildLogRawResponse())
          break
        default:
          // Unknown command — ignore, matching a real unit's silent behavior for garbage frames.
          break
      }
    })
  }

  /** Address/value pairs occupy words[2..length-2] (words[0]=length, words[1]=cmd, last word=checksum). */
  #applyWrite(words: number[]): void {
    for (let i = 2; i + 1 < words.length - 1; i += 2) {
      this.#registers.set(words[i], words[i + 1])
    }
  }

  #buildReadTablesResponse(): ArrayBuffer {
    const buffer = new Uint16Array(WS_BUFFER_SIZE)
    for (const region of WS_REGIONS) {
      for (let addr = region.rangeStart + 1; addr <= region.rangeEnd; addr++) {
        const idx = addressToBufferIndex(addr)
        // istanbul ignore else -- addr is drawn from `region`'s own (rangeStart,
        // rangeEnd] by this loop, so addressToBufferIndex(addr) always resolves
        // within that same region; idx < 0 can't happen given this call site,
        // even though the function's own signature allows it generally.
        if (idx >= 0) buffer[idx] = this.#registers.get(addr) ?? 0
      }
    }

    const ab = new ArrayBuffer(WS_BUFFER_SIZE * 2)
    const dv = new DataView(ab)
    for (let i = 0; i < WS_BUFFER_SIZE; i++) {
      // istanbul ignore next -- i is always a valid index into this fixed-size,
      // just-allocated `buffer` (0..WS_BUFFER_SIZE-1), so it's always defined;
      // the `?? 0` is a type-level safety net, not a reachable runtime path.
      dv.setUint16(i * 2, buffer[i] ?? 0, false /* big-endian, matching a real response */)
    }
    return ab
  }

  #buildLogRawResponse(): ArrayBuffer {
    const totalSize = Math.max(...LOG_PAGE_OFFSETS) + LOG_PAGE_SIZE
    const bytes = new Uint8Array(totalSize).fill(255)

    const nextOffsetByChannel = new Map<HistoryChannel, number>()
    for (const sample of this.#history) {
      const pageIndex = HISTORY_PAGE_CHANNELS.indexOf(sample.channel)
      if (pageIndex < 0) continue // no known page for this channel; skip rather than corrupt another page

      const pageOffset = LOG_PAGE_OFFSETS[pageIndex]!
      const cursor = nextOffsetByChannel.get(sample.channel) ?? pageOffset
      if (cursor + LOG_RECORD_SIZE > pageOffset + LOG_PAGE_SIZE) continue // page full

      const year = sample.timestamp.getFullYear() - 2000
      bytes.set(
        [
          sample.channel,
          sample.timestamp.getMinutes(),
          sample.timestamp.getHours(),
          sample.timestamp.getDate(),
          sample.timestamp.getMonth() + 1,
          year,
          sample.value & 0xff,
          (sample.value >> 8) & 0xff,
        ],
        cursor,
      )
      nextOffsetByChannel.set(sample.channel, cursor + LOG_RECORD_SIZE)
    }

    return bytes.buffer
  }
}
