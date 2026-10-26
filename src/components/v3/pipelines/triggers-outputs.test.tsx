import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ElnActions, RunKeeps, WebhookCard } from './triggers-outputs'

import type * as router from '@tanstack/react-router'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof router>()),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

describe('WebhookCard', () => {
  it('turns the webhook on and shows the token once', async () => {
    const fetchMock = vi
      .fn()
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
    vi.stubGlobal('fetch', fetchMock)
    wrap(<WebhookCard definitionId="d" />)
    fireEvent.click(await screen.findByText('Turn on'))
    expect(await screen.findByText('tok-123')).toBeTruthy()
    const [, init] = fetchMock.mock.calls[1] ?? []
    expect(JSON.parse(init.body)).toEqual({ action: 'rotate' })
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
            } as never,
          ],
        }}
      />,
    )
    expect(screen.getByText('Yes, accepts or rejects')).toBeTruthy()
  })
})
