import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsTwoFactor } from './settings-two-factor'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(),
  verifyTotp: vi.fn(),
  disable: vi.fn(),
}))

vi.mock('./settings-two-factor-data', () => ({
  getTwoFactorStatusFn: mocks.status,
}))
vi.mock('#/lib/auth-client', () => ({
  authClient: {
    twoFactor: {
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
      disable: mocks.disable,
    },
  },
}))
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  },
}))

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingsTwoFactor />
    </QueryClientProvider>,
  )
}

const base = {
  available: true,
  enabled: false,
  needsPassword: false,
  emailLinkEnabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue(base)
})
afterEach(cleanup)

describe('two-factor settings', () => {
  it('says plainly that an auth-free environment has nothing to protect', async () => {
    mocks.status.mockResolvedValue({ ...base, available: false })
    renderPanel()
    expect(await screen.findByText(/Sign-in isn’t set up here/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull()
  })

  it('does not count as on until a first code is accepted, then shows backup codes once', async () => {
    mocks.enable.mockResolvedValue({
      data: {
        method: 'totp',
        totpURI:
          'otpauth://totp/Sheetbase:a@b.test?secret=JBSWY3DPEHPK3PXP&issuer=Sheetbase',
        backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
      },
      error: null,
    })
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null })
    renderPanel()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up two-factor' }),
    )
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy()
    expect(screen.getByAltText(/QR code/i)).toBeTruthy()
    // Backup codes are held back until the authenticator is proven.
    expect(screen.queryByText(/aaaa-bbbb/)).toBeNull()

    mocks.status.mockResolvedValue({ ...base, enabled: true })
    fireEvent.change(screen.getByLabelText('6-digit code'), {
      target: { value: '123 456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-factor' }))
    await waitFor(() =>
      expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' }),
    )
    expect(await screen.findByText(/Save your backup codes now/)).toBeTruthy()
    expect(
      await screen.findByText('Two-factor is on for your account.'),
    ).toBeTruthy()
  })

  it('states why a wrong code was refused and stays in setup', async () => {
    mocks.enable.mockResolvedValue({
      data: {
        method: 'totp',
        totpURI: 'otpauth://totp/x?secret=ABC',
        backupCodes: ['a'],
      },
      error: null,
    })
    mocks.verifyTotp.mockResolvedValue({
      data: null,
      error: { message: 'Invalid code' },
    })
    renderPanel()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up two-factor' }),
    )
    fireEvent.change(await screen.findByLabelText('6-digit code'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on two-factor' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid code',
    )
    expect(screen.queryByText(/Two-factor is on/)).toBeNull()
  })

  it('asks for the signing password when the account has one', async () => {
    mocks.status.mockResolvedValue({ ...base, needsPassword: true })
    mocks.enable.mockResolvedValue({
      data: {
        method: 'totp',
        totpURI: 'otpauth://totp/x?secret=ABC',
        backupCodes: ['a'],
      },
      error: null,
    })
    renderPanel()
    const start = await screen.findByRole('button', {
      name: 'Set up two-factor',
    })
    expect((start as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Signing password/), {
      target: { value: 'pw' },
    })
    fireEvent.click(start)
    await waitFor(() =>
      expect(mocks.enable).toHaveBeenCalledWith({
        password: 'pw',
        method: 'totp',
      }),
    )
  })

  it('turns two-factor off when it is on', async () => {
    mocks.status.mockResolvedValue({ ...base, enabled: true })
    mocks.disable.mockResolvedValue({ data: {}, error: null })
    renderPanel()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Turn off two-factor' }),
    )
    await waitFor(() => expect(mocks.disable).toHaveBeenCalledOnce())
  })
})
