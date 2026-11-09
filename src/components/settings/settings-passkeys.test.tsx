import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPasskeys } from './settings-passkeys'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}))

vi.mock('#/lib/auth-client', () => ({
  authClient: {
    passkey: {
      listUserPasskeys: mocks.list,
      addPasskey: mocks.add,
      deletePasskey: mocks.remove,
      updatePasskey: mocks.update,
    },
  },
}))

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <SettingsPasskeys />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'PublicKeyCredential', {
    value: function PublicKeyCredential() {},
    configurable: true,
  })
  mocks.list.mockResolvedValue({ data: [], error: null })
  mocks.add.mockResolvedValue({ data: {}, error: null })
  mocks.remove.mockResolvedValue({ data: {}, error: null })
})

afterEach(cleanup)

describe('SettingsPasskeys', () => {
  it('says so when there are no passkeys yet', async () => {
    renderPanel()
    expect(
      await screen.findByText('You have not added a passkey yet.'),
    ).toBeTruthy()
  })

  it('adds a passkey under the name the person chose', async () => {
    renderPanel()
    const name = await screen.findByPlaceholderText('For example, Work laptop')
    fireEvent.change(name, { target: { value: 'Work laptop' } })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add a passkey' }),
    )
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({ name: 'Work laptop' }),
    )
  })

  it('lists passkeys and removes one', async () => {
    mocks.list.mockResolvedValue({
      data: [
        {
          id: 'pk1',
          name: 'Phone',
          backedUp: true,
          createdAt: '2026-11-01T09:00:00Z',
        },
      ],
      error: null,
    })
    renderPanel()
    expect(await screen.findByText('Phone')).toBeTruthy()
    expect(screen.getByText('Synced across your devices')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ id: 'pk1' }),
    )
  })
})
