import { describe, it, expect } from '@jest/globals'
import { ValidationError } from '../validation.js'

describe('ValidationError', () => {
  it('includes the given details in its message', () => {
    const err = new ValidationError('filter days remaining', '-5')
    expect(err.message).toBe('Invalid filter days remaining received from device: -5')
    expect(err.name).toBe('ValidationError')
  })

  it('falls back to a generic phrase when details is undefined', () => {
    const err = new ValidationError('sensor readings', undefined)
    expect(err.message).toBe('Invalid sensor readings received from device: unknown validation error')
  })

  it('falls back to a generic phrase when details is null', () => {
    const err = new ValidationError('sensor readings', null)
    expect(err.message).toBe('Invalid sensor readings received from device: unknown validation error')
  })
})
