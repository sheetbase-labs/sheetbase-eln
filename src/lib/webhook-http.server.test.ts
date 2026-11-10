// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  isPublicWebhookAddress,
  resolveWebhookHost,
} from './webhook-http.server'

const dns = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (
        hostname: string,
        options: { all: true; verbatim: true },
      ) => Promise<Array<{ address: string; family: number }>>
    >(),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The destination policy resolves through Node's built-in DNS module, which takes no resolver seam; this stands in for it so each case presents fixed answers.
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))

describe('webhook socket destination policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.0.1',
    '172.16.0.2',
    '192.168.1.1',
    '224.0.0.1',
    '240.1.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    '2001:db8::1',
  ])('rejects %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public %s',
    (address) => {
      expect(isPublicWebhookAddress(address)).toBe(true)
    },
  )
  it('rejects mixed DNS answers, rather than trusting the first address', async () => {
    dns.lookup.mockResolvedValueOnce([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(resolveWebhookHost('receiver.example')).rejects.toThrow(
      'non-public',
    )
  })
  it('returns the exact validated address for the socket lookup', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
    await expect(resolveWebhookHost('receiver.example')).resolves.toEqual({
      address: '1.1.1.1',
      family: 4,
    })
  })
})
