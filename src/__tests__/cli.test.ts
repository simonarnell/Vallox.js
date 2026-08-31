import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { MockValloxServer } from '../testing/mock-server.js'
import { runCli } from './__testUtils__/cliHarness.js'

/** Output's last non-empty line — the CLI prints a banner line before its actual result. */
function lastLine(stdout: string): string {
  const lines = stdout.trim().split('\n')
  return lines[lines.length - 1]!.trim()
}

describe('vallox CLI — mode', () => {
  let server: MockValloxServer

  beforeEach(async () => {
    server = new MockValloxServer()
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it("mode get reports the mock unit's default (home)", async () => {
    expect(lastLine((await runCli(server, ['mode', 'get'])).stdout)).toBe('home')
  })

  it('mode set automatic is reflected by a subsequent mode get', async () => {
    expect((await runCli(server, ['mode', 'set', 'automatic'])).status).toBe(0)
    expect(lastLine((await runCli(server, ['mode', 'get'])).stdout)).toBe('automatic')
    expect(server.getRegister('HOME_AWAY')).toBe(2)
  })

  it('mode set away is reflected by a subsequent mode get', async () => {
    await runCli(server, ['mode', 'set', 'away'])
    expect(lastLine((await runCli(server, ['mode', 'get'])).stdout)).toBe('away')
  })

  it('mode set rejects an unknown mode name with a non-zero exit', async () => {
    const result = await runCli(server, ['mode', 'set', 'bogus'])
    expect(result.status).not.toBe(0)
  })
})

describe('vallox CLI — profile', () => {
  let server: MockValloxServer

  beforeEach(async () => {
    server = new MockValloxServer()
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('profile set automatic is reflected by a subsequent profile get', async () => {
    await runCli(server, ['profile', 'set', 'automatic'])
    expect(lastLine((await runCli(server, ['profile', 'get'])).stdout)).toBe('AUTOMATIC')
  })

  it('profile set custom activates the custom timer', async () => {
    await runCli(server, ['profile', 'set', 'custom'])
    expect(lastLine((await runCli(server, ['profile', 'get'])).stdout)).toBe('CUSTOM')
    expect(server.getRegister('CUSTOM_TIMER')).toBeGreaterThan(0)
  })

  it('profile set fireplace (deprecated alias) has the same effect as custom', async () => {
    await runCli(server, ['profile', 'set', 'fireplace'])
    expect(lastLine((await runCli(server, ['profile', 'get'])).stdout)).toBe('CUSTOM')
    expect(server.getRegister('CUSTOM_TIMER')).toBeGreaterThan(0)
  })
})
