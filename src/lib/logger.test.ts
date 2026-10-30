import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger, redact } from './logger'

// Hoisted above the import, so the logger starts in JSON mode.
vi.hoisted(() => {
  process.env.LOG_FORMAT = 'json'
})

describe('redact', () => {
  it('redacts sensitive keys at the top level', () => {
    const out = redact({
      token: 'abc',
      password: 'secret',
      unrelated: 'keep',
    })
    expect(out).toEqual({
      token: '[redacted]',
      password: '[redacted]',
      unrelated: 'keep',
    })
  })

  it('redacts nested sensitive keys recursively', () => {
    const out = redact({
      user: { id: 'u1', accessToken: 'leak' },
      list: [{ cookie: 'c1' }, { name: 'keep' }],
    })
    expect(out).toEqual({
      user: { id: 'u1', accessToken: '[redacted]' },
      list: [{ cookie: '[redacted]' }, { name: 'keep' }],
    })
  })

  it('is case-insensitive on key names', () => {
    const out = redact({ Authorization: 'Bearer x', SECRET: 's' })
    expect(out).toEqual({ Authorization: '[redacted]', SECRET: '[redacted]' })
  })

  it('leaves primitives and null untouched', () => {
    expect(redact('hello')).toBe('hello')
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
  })
})

describe('logger', () => {
  // evlog writes through console: log/debug to stdout, warn/error to stderr.
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  const originalLevel = process.env.LOG_LEVEL

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    delete process.env.LOG_LEVEL
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    if (originalLevel !== undefined) process.env.LOG_LEVEL = originalLevel
  })

  it('emits a JSON line with level, message and timestamp to stdout for info', () => {
    logger.info('hello', { request_id: 'r1' })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    const line = stdoutSpy.mock.calls[0]![0] as string
    const record = JSON.parse(line)
    expect(record.level).toBe('info')
    expect(record.message).toBe('hello')
    expect(record.request_id).toBe('r1')
    expect(record.timestamp).toBeDefined()
  })

  it('routes warn and error to stderr', () => {
    logger.warn('w')
    logger.error('e')
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('redacts sensitive fields before logging', () => {
    logger.info('req', { authorization: 'Bearer secret', body: 'data' })
    const record = JSON.parse(stdoutSpy.mock.calls[0]![0] as string)
    expect(record.authorization).toBe('[redacted]')
    expect(record.body).toBe('data')
  })

  it('suppresses debug below the default info level', () => {
    logger.debug('noisy')
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
