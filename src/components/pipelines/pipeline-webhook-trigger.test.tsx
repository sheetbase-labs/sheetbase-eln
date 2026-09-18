import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineWebhookTrigger } from './pipeline-webhook-trigger'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('incoming webhook controls', () => {
  it('shows a newly issued token once and removes it on disable', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ enabled: false, url: 'https://app.test/hook' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          url: 'https://app.test/hook',
          token: 'issued-secret',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ enabled: false, url: 'https://app.test/hook' }),
      )
    vi.stubGlobal('fetch', fetcher)
    render(<PipelineWebhookTrigger definitionId="test" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable webhook' }),
    )
    expect(await screen.findByDisplayValue('issued-secret')).toBeTruthy()
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: '{"action":"rotate"}',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Disable webhook' }))
    await waitFor(() =>
      expect(screen.queryByDisplayValue('issued-secret')).toBeNull(),
    )
  })
  it('does not fetch credentials without management permission', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<PipelineWebhookTrigger definitionId="test" canManage={false} />)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reports a failed update and preserves the current settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ enabled: false, url: 'https://app.test/hook' }),
        )
        .mockResolvedValueOnce(new Response('', { status: 403 })),
    )
    render(<PipelineWebhookTrigger definitionId="test" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable webhook' }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be saved',
    )
    expect(screen.getByText('Webhook disabled')).toBeTruthy()
  })
})
