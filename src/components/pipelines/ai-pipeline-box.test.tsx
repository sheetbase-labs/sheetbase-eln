import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import type { PageAi } from '#/lib/use-page-ai'
import { AiPipelineBox } from './ai-pipeline-box'

const answer = {
  summary: '<img src=x onerror=alert(1)>',
  steps: [
    { name: 'start', sql: 'select 1 as value' },
    { name: 'same', sql: 'select * from previous' },
    { name: 'same', sql: 'select * from previous' },
  ],
  output: { mode: 'create', schema: 'unknown', datasetName: 'Unmatched' },
}

function pageAi(text = JSON.stringify(answer)): PageAi {
  return {
    available: true,
    live: true,
    workspaceId: 'ws-1',
    run: async () => ({
      status: 'ok',
      text,
      model: 'test-provider',
      mode: 'provider',
      sources: [],
      usage: { tokensUsed: 1, costMicrousd: 0, latencyMs: 1 },
      generated: true,
    }),
  }
}

function view(props: Partial<React.ComponentProps<typeof AiPipelineBox>> = {}) {
  const requests: string[] = []

  const client = createDataClient(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET')
    requests.push(z.string().parse(input))

    return Response.json([])
  })

  const onApply = vi.fn<React.ComponentProps<typeof AiPipelineBox>['onApply']>(
    async () => {},
  )

  return {
    ...render(
      <AiPipelineBox
        current={{}}
        pageAi={pageAi()}
        client={client}
        onApply={onApply}
        {...props}
      />,
    ),
    onApply,
    requests,
  }
}

async function ask() {
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Describe the pipeline' }),
    'Count results',
  )
  await user.click(screen.getByTestId('pipeline-ai-draft'))

  return user
}

afterEach(cleanup)

describe('AiPipelineBox', () => {
  it('stays hidden without a real connected model', () => {
    const ai = pageAi()
    const result = view({ pageAi: { ...ai, live: false } })
    expect(result.container.innerHTML).toBe('')
    expect(result.requests).toEqual([])
    expect(result.onApply).not.toHaveBeenCalled()
  })

  it('shows a safe review card and all SQL steps without writing, then dismisses', async () => {
    const result = view({ current: { statement: 'select 2 as value' } })
    expect(
      screen
        .getByRole('button', { name: 'Revise pipeline' })
        .hasAttribute('disabled'),
    ).toBe(true)
    const user = await ask()

    const card = await screen.findByRole('group', {
      name: 'Suggested pipeline',
    })

    expect(card.textContent).toContain(answer.summary)
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelectorAll('pre')).toHaveLength(3)
    expect(card.textContent).toContain(
      'Left out because it didn’t match anything here: where to save the result.',
    )
    expect(card.textContent).toContain(
      'Applying this replaces the inputs, steps and output in the draft.',
    )
    expect(new Set(result.requests.map((url) => url.split('?')[0]))).toEqual(
      new Set([
        '/api/db/datasets',
        '/api/db/dataset_schema_versions',
        '/api/db/dataset_schema_definitions',
      ]),
    )
    expect(result.onApply).not.toHaveBeenCalled()
    expect(
      screen.getByTestId('pipeline-ai-draft').hasAttribute('disabled'),
    ).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(
      screen.queryByRole('group', { name: 'Suggested pipeline' }),
    ).toBeNull()
    expect(
      screen.getByTestId('pipeline-ai-draft').hasAttribute('disabled'),
    ).toBe(false)
    expect(result.onApply).not.toHaveBeenCalled()
  })

  it('applies only the checked draft and disables both review actions while writing', async () => {
    const finishApply = vi.fn<() => void>()

    const applied = new Promise<void>((resolve) => {
      finishApply.mockImplementation(resolve)
    })

    const onApply = vi.fn<
      React.ComponentProps<typeof AiPipelineBox>['onApply']
    >(() => applied)

    view({ onApply })
    const user = await ask()
    await user.click(
      await screen.findByRole('button', { name: 'Apply to draft' }),
    )
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0]?.[0]).toMatchObject({
      summary: answer.summary,
      config: {
        transform: { language: 'sql', statement: 'select 1 as value' },
        steps: [
          {
            name: 'same',
            language: 'sql',
            statement: 'select * from previous',
          },
          {
            name: 'same_x',
            language: 'sql',
            statement: 'select * from previous',
          },
        ],
        output: { mode: 'none' },
      },
      skipped: ['where to save the result'],
    })
    expect(
      screen
        .getByRole('button', { name: 'Applying…' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Dismiss' }).hasAttribute('disabled'),
    ).toBe(true)
    finishApply()
    await waitFor(() =>
      expect(screen.queryByTestId('pipeline-ai-card')).toBeNull(),
    )
    expect(screen.getByRole('status').textContent).toContain(
      'Applied to the draft.',
    )
    expect(
      screen.getByRole('textbox', { name: 'Describe the pipeline' }),
    ).toHaveProperty('value', '')
  })

  it.each([
    'not JSON',
    JSON.stringify({ steps: [{ sql: 'select {{undeclared}}' }] }),
  ])('refuses an unusable model answer: %s', async (text) => {
    const result = view({ pageAi: pageAi(text) })
    await ask()
    expect((await screen.findByRole('status')).textContent).toContain(
      'Couldn’t turn that into a pipeline.',
    )
    expect(screen.queryByTestId('pipeline-ai-card')).toBeNull()
    expect(result.onApply).not.toHaveBeenCalled()
  })

  it('keeps model SQL as reviewable text, never executing it while drafting', async () => {
    const result = view({
      pageAi: pageAi(
        JSON.stringify({ steps: [{ sql: 'delete from records' }] }),
      ),
    })

    await ask()

    const card = await screen.findByRole('group', {
      name: 'Suggested pipeline',
    })

    expect(card.querySelector('pre')?.textContent).toContain(
      'delete from records',
    )
    expect(result.onApply).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a rejected draft write without clearing the description', async () => {
    view({
      onApply: async () => {
        throw new Error('Revision changed')
      },
    })
    const user = await ask()
    await user.click(
      await screen.findByRole('button', { name: 'Apply to draft' }),
    )
    expect((await screen.findByRole('status')).textContent).toBe(
      'Couldn’t apply the draft. Revision changed',
    )
    expect(
      screen.getByRole('textbox', { name: 'Describe the pipeline' }),
    ).toHaveProperty('value', 'Count results')
    expect(screen.queryByTestId('pipeline-ai-card')).toBeNull()
  })
})
