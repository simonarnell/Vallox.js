import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { MockValloxServer } from '../../testing/mock-server.js'

const execFileAsync = promisify(execFile)

/** Path to the built CLI entry point. Requires `npm run build` to have run first (see the `pretest` script). */
const CLI_PATH = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'dist', 'cli.js')

export interface CliResult {
  stdout: string
  status: number
}

/**
 * Runs the built `vallox` CLI against a {@link MockValloxServer} and returns
 * its stdout/exit status. Spawns the real compiled binary as a subprocess —
 * this is an end-to-end check of argument parsing, output formatting, and
 * exit codes, not a unit test of any single function.
 *
 * Deliberately async (`execFile`, not `execFileSync`): a synchronous spawn
 * would block this process's event loop while waiting for the child, but
 * `MockValloxServer` runs its WebSocket server on that same event loop — the
 * spawned CLI's connection back to it would then never get serviced,
 * deadlocking until the child's own timeout fires.
 */
export async function runCli(server: Pick<MockValloxServer, 'host' | 'port'>, args: string[]): Promise<CliResult> {
  try {
    const { stdout } = await execFileAsync(
      'node',
      [CLI_PATH, '-H', server.host, '-p', String(server.port), ...args],
      { encoding: 'utf8', timeout: 10_000 },
    )
    return { stdout, status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; code?: number }
    return { stdout: e.stdout ?? '', status: e.code ?? 1 }
  }
}
