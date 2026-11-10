import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { renderPipeline as wrap } from './test-support'

import { ElnActions, RunKeeps, WebhookCard } from './triggers-outputs'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WebhookCard', () => {
  it('turns the webhook on and shows the token once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          enabled: false,
          url: 'https://x/api/pipelines/webhook/d',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          url: 'https://x/api/pipelines/webhook/d',
          token: 'tok-123',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enabled: false,
          url: 'https://x/api/pipelines/webhook/d',
        }),
      )

    vi.stubGlobal('fetch', fetchMock)
    wrap(<WebhookCard definitionId="d" />)
    fireEvent.click(await screen.findByText('Turn on'))
    expect(await screen.findByText('tok-123')).toBeTruthy()
    const [, init] = fetchMock.mock.calls[1] ?? []
    expect(JSON.parse(z.string().parse(init?.body))).toEqual({
      action: 'rotate',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(screen.queryByText('tok-123')).toBeNull())
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  it('refuses malformed webhook state instead of exposing its token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json({
          enabled: 'true',
          url: 'https://x/api/pipelines/webhook/d',
          token: 'untrusted-token',
        }),
      ),
    )
    wrap(<WebhookCard definitionId="d" />)
    await screen.findByText(/expected boolean/)
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Turn on' })
          .disabled,
      ).toBe(true),
    )
    expect(screen.queryByText('untrusted-token')).toBeNull()
  })
})

describe('RunKeeps', () => {
  it('marks the version’s output mode as selected', () => {
    wrap(
      <RunKeeps
        pipelineId="p"
        config={{ output: { mode: 'none', datasetLabel: 'x' } }}
      />,
    )

    const selected = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true')

    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toContain('Keep nothing')
  })
})

describe('ElnActions', () => {
  it('says when a person must accept an action', () => {
    wrap(
      <ElnActions
        config={{
          actions: [
            {
              name: 'a',
              operation: 'insert_block',
              mode: 'propose',
              arguments: { p_record_id: 'r' },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('Yes, accepts or rejects')).toBeTruthy()
  })
  it('says when an action repeats for each row of an import', () => {
    wrap(
      <ElnActions
        config={{
          actions: [
            {
              name: 'prices',
              operation: 'set_reagent_order_price',
              forEach: { $ref: 'previous' },
              arguments: { p_order_id: { $ref: 'row.order_id' } },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('Each row it receives')).toBeTruthy()
  })
})
