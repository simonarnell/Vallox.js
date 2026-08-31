import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { ValloxClient, WebSocketTransport, Mode, Profile, Registers } from '../../index.js'

/**
 * Runs the real protocol against a physical unit — the one thing
 * `MockValloxServer` can never prove, since it's just our own model of the
 * protocol. Opt-in only: set `VALLOX_HOST` (and optionally `VALLOX_PORT`,
 * default 80) to a unit reachable from wherever this runs, then
 * `npm run test:hardware`. Never run in CI — the unit is only reachable on
 * its own LAN.
 *
 * The "write + restore" suite actually changes the unit's live state for a
 * few seconds per test, then restores whatever was active before the suite
 * ran (captured in `beforeAll`, restored in `afterAll` and after each
 * individual write test via try/finally, so a failed assertion still
 * restores state). The power test briefly stops the unit's real
 * ventilation — deliberately opted into, not run by default; see
 * `describeIfPowerTestsOpted`.
 */
const HOST = process.env.VALLOX_HOST
const PORT = process.env.VALLOX_PORT ? Number(process.env.VALLOX_PORT) : 80
const ALLOW_POWER_TEST = process.env.VALLOX_ALLOW_POWER_TEST === '1'

if (!HOST) {
  console.warn(
    'Skipping hardware tests: set VALLOX_HOST (and optionally VALLOX_PORT) to run them against a real unit.',
  )
} else if (!ALLOW_POWER_TEST) {
  console.warn('Skipping the power on/off test: set VALLOX_ALLOW_POWER_TEST=1 to opt in (it briefly stops real ventilation).')
}

const describeIfConfigured = HOST ? describe : describe.skip
const describeIfPowerTestsOpted = HOST && ALLOW_POWER_TEST ? describe : describe.skip

describeIfConfigured('ValloxClient against real hardware', () => {
  let client: ValloxClient
  let transport: WebSocketTransport
  let originalProfile: Profile

  beforeAll(async () => {
    transport = new WebSocketTransport({ host: HOST!, port: PORT })
    client = new ValloxClient(transport)
    originalProfile = await client.getProfile()
  })

  afterAll(async () => {
    if (originalProfile !== Profile.NONE) {
      await client.setProfile(originalProfile)
    }
  })

  describe('read-only', () => {
    it('isPoweredOn returns a boolean', async () => {
      expect(typeof (await client.isPoweredOn())).toBe('boolean')
    })

    it('getModel/getMachineType/getSoftwareVersion return plausible identity info', async () => {
      const [model, machineType, softwareVersion] = await Promise.all([
        client.getModel(),
        client.getMachineType(),
        client.getSoftwareVersion(),
      ])
      if (model !== undefined) expect(model).toEqual(expect.stringContaining('Vallox'))
      if (machineType !== undefined) expect(machineType.length).toBeGreaterThan(0)
      if (softwareVersion !== undefined) expect(softwareVersion).toMatch(/^\d+(\.\d+)*$/)
    })

    it('getSerialNumber hex and decimal forms encode the same underlying number', async () => {
      const [hex, decimal] = await Promise.all([client.getSerialNumber('hex'), client.getSerialNumber('decimal')])
      expect(parseInt(hex, 16)).toBe(Number(decimal))
    })

    it('getUptime returns non-negative hour counts', async () => {
      const uptime = await client.getUptime()
      expect(uptime.totalHours).toBeGreaterThanOrEqual(0)
      expect(uptime.currentSessionHours).toBeGreaterThanOrEqual(0)
    })

    it('getSensorReadings returns physically plausible values', async () => {
      const readings = await client.getSensorReadings()
      for (const temp of [
        readings.extractAirTemp,
        readings.exhaustAirTemp,
        readings.outdoorAirTemp,
        readings.supplyCellAirTemp,
        readings.supplyAirTemp,
      ]) {
        expect(temp).toBeGreaterThan(-40)
        expect(temp).toBeLessThan(60)
      }
      expect(readings.humidity).toBeGreaterThanOrEqual(0)
      expect(readings.humidity).toBeLessThanOrEqual(100)
      expect(readings.co2).toBeGreaterThanOrEqual(0)
    })

    it('getProfile returns one of the known Profile values', async () => {
      expect(Object.values(Profile)).toContain(await client.getProfile())
    })

    it('getFilterDaysRemaining returns a non-negative number', async () => {
      expect(await client.getFilterDaysRemaining()).toBeGreaterThanOrEqual(0)
    })

    it('getFaults returns an array', async () => {
      expect(Array.isArray(await client.getFaults())).toBe(true)
    })

    it('getFaultCount returns a non-negative number capped at MAX_FAULTS (10)', async () => {
      const count = await client.getFaultCount()
      expect(count).toBeGreaterThanOrEqual(0)
      expect(count).toBeLessThanOrEqual(10)
    })

    it('getHrCellStatus returns one of the known statuses', async () => {
      const status = await client.getHrCellStatus()
      expect([0, 1, 2, 3]).toContain(status)
    })

    it('isDefrosting returns a boolean', async () => {
      expect(typeof (await client.isDefrosting())).toBe('boolean')
    })

    it('getFilterChangeInterval returns a positive number of days', async () => {
      expect(await client.getFilterChangeInterval()).toBeGreaterThan(0)
    })

    it('getRhThreshold/getCo2Threshold return plausible values', async () => {
      const [rh, co2] = await Promise.all([client.getRhThreshold(), client.getCo2Threshold()])
      expect(rh).toBeGreaterThanOrEqual(0)
      expect(rh).toBeLessThanOrEqual(100)
      expect(co2).toBeGreaterThan(0)
    })

    it('getBoostTimer/getCustomTimer/getProgrammableTimer return non-negative minute counts', async () => {
      const [boost, custom, programmable] = await Promise.all([
        client.getBoostTimer(),
        client.getCustomTimer(),
        client.getProgrammableTimer(),
      ])
      for (const timer of [boost, custom, programmable]) expect(timer).toBeGreaterThanOrEqual(0)
    })

    it('per-profile fan speeds are all valid percentages', async () => {
      const speeds = await Promise.all([
        client.getHomeFanSpeed(),
        client.getAwayFanSpeed(),
        client.getBoostFanSpeed(),
        client.getCustomExtractFanSpeed(),
        client.getCustomSupplyFanSpeed(),
      ])
      for (const speed of speeds) {
        expect(speed).toBeGreaterThanOrEqual(0)
        expect(speed).toBeLessThanOrEqual(100)
      }
    })

    it('per-profile supply temperature setpoints are physically plausible', async () => {
      const temps = await Promise.all([
        client.getHomeSupplyTemp(),
        client.getAwaySupplyTemp(),
        client.getBoostSupplyTemp(),
        client.getCustomSupplyTemp(),
      ])
      for (const temp of temps) {
        expect(temp).toBeGreaterThan(-40)
        expect(temp).toBeLessThan(60)
      }
    })

    it('getWeeklySchedule returns all seven days with 24 hourly slots each', async () => {
      const schedule = await client.getWeeklySchedule()
      for (const day of Object.values(schedule)) {
        expect(day).toHaveLength(24)
        for (const slot of day) expect([0, 1, 2, 3]).toContain(slot)
      }
    })

    it('getDeviceTime returns a plausible Date', async () => {
      const deviceTime = await client.getDeviceTime()
      const driftMs = Math.abs(deviceTime.getTime() - Date.now())
      // Unit clock isn't NTP-synced against this machine; just sanity-check
      // it's not wildly wrong (e.g. an unset/garbage clock), not exact.
      expect(driftMs).toBeLessThan(365 * 24 * 60 * 60 * 1000)
    })

    it('readRegister/readRegisters agree on FAN_SPEED', async () => {
      const [single, range] = await Promise.all([
        client.readRegister(Registers.FAN_SPEED),
        transport.readRegisters(Registers.FAN_SPEED, 1),
      ])
      expect(range[0]).toBe(single)
    })

    it("getHistory returns the unit's own log samples", async () => {
      const samples = await transport.getHistory()
      expect(Array.isArray(samples)).toBe(true)
      for (const sample of samples.slice(0, 20)) {
        expect(sample.timestamp).toBeInstanceOf(Date)
        expect(typeof sample.value).toBe('number')
      }
    }, 60_000) // a real unit's full multi-week log is much larger than the mock server's
  })

  describe('write + restore', () => {
    // A `finally` that writes a restore value but never reads it back is
    // trusting the write silently succeeded — exactly the assumption that
    // turned out false once in practice (a powerOn() restore that the test
    // itself reported as passing left the unit off; see the fix here and in
    // the power test below). Every restore in this file now re-reads
    // afterward and asserts it matches, so a failed restore fails loudly
    // instead of leaving real hardware in the wrong state unnoticed.
    it('setProfile(AUTOMATIC) is reflected by getProfile/getMode', async () => {
      const before = await client.getProfile()
      try {
        await client.setProfile(Profile.AUTOMATIC)
        expect(await client.getProfile()).toBe(Profile.AUTOMATIC)
        expect(await client.getMode()).toBe(Mode.AUTOMATIC)
      } finally {
        if (before !== Profile.NONE) {
          await client.setProfile(before)
          expect(await client.getProfile()).toBe(before)
        }
      }
    })

    it('setProfile(HOME) then setProfile(AWAY) each take effect', async () => {
      const before = await client.getProfile()
      try {
        await client.setProfile(Profile.HOME)
        expect(await client.getProfile()).toBe(Profile.HOME)

        await client.setProfile(Profile.AWAY)
        expect(await client.getProfile()).toBe(Profile.AWAY)
      } finally {
        if (before !== Profile.NONE) {
          await client.setProfile(before)
          expect(await client.getProfile()).toBe(before)
        }
      }
    })
  })

  // Gated separately from the rest of the write+restore suite — set
  // VALLOX_ALLOW_POWER_TEST=1 to opt in, since this briefly stops real
  // ventilation rather than just changing a profile/config value.
  describeIfPowerTestsOpted('power (opt-in via VALLOX_ALLOW_POWER_TEST=1)', () => {
    it('powerOff then powerOn are each reflected by isPoweredOn', async () => {
      const before = await client.isPoweredOn()
      try {
        await client.powerOff()
        expect(await client.isPoweredOn()).toBe(false)

        await client.powerOn()
        expect(await client.isPoweredOn()).toBe(true)
      } finally {
        if (before) await client.powerOn()
        else await client.powerOff()
        expect(await client.isPoweredOn()).toBe(before)
      }
    }, 60_000) // six real round-trips (read, write, verify, write, verify, restore+verify); the unit responds slower mid-power-transition
  })
})
