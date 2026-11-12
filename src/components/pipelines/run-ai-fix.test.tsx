import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDataClient } from '#/lib/data-client'
import type { PageAi } from '#/lib/use-page-ai'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { pipelineVersion, renderPipeline } from './test-support'

import { RunAiFix } from './run-ai-fix'
import type { PipelineConfig } from '#/lib/pipelines/config'

const writes: Array<{
  name: string
  args: z.infer<typeof pipelineJsonObjectSchema>
}> = []

const runConfig: PipelineConfig = {
  configVersion: 2,
  mode: 'standard',
  parameters: [],
  inputs: [{ name: 'readings', required: true }],
  steps: [
    { name: 'analysis', kind: 'sql', statement: 'select * from readingz' },
  ],
  output: { mode: 'none', datasetLabel: 'x' },
}

const reply = JSON.stringify({
  explanation: 'The table name has a typo.',
  fix: {
    target: 'analysis',
    language: 'sql',
    statement: 'select * from readings',
  },
})

function ai(overrides: Partial<PageAi> = {}): PageAi {
  return {
    available: true,
    live: true,
    workspaceId: 'ws-1',
    run: async () => ({
      status: 'ok',
      text: reply,
      model: 'test-provider',
      mode: 'provider',
      sources: [],
      usage: { tokensUsed: 1, costMicrousd: 0, latencyMs: 1 },
      generated: true,
    }),
    ...overrides,
  }
}

function view(draft?: PipelineDefinitionVersionWire, pageAi = ai()) {
  const client = createDataClient(async (input, init) => {
    writes.push({
      name: z.string().parse(input).split('/').at(-1) ?? '',
      args: pipelineJsonObjectSchema.parse(
        JSON.parse(z.string().parse(init?.body)),
      ),
    })

    return Response.json(pipelineVersion())
  })

  return renderPipeline(
    <RunAiFix
      pipelineId="p-1"
      errorCode="transform_failed"
      errorMessage="relation does not exist"
      logLines={['relation "readingz" does not exist']}
      failedStep="analysis"
      runConfig={runConfig}
      draft={draft}
      pageAi={pageAi}
      client={client}
    />,
  )
}

afterEach(() => {
  cleanup()
  writes.length = 0
})

describe('RunAiFix', () => {
  it('renders nothing when AI is off or only the built-in model is connected', () => {
    expect(
      view(undefined, ai({ available: false, live: false })).container
        .innerHTML,
    ).toBe('')
    cleanup()
    expect(view(undefined, ai({ live: false })).container.innerHTML).toBe('')
  })

  it('explains, then Apply creates a draft when none exists', async () => {
    view()
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    expect(await screen.findByText('The table name has a typo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      name: 'create_pipeline_definition_version',
      args: {
        p_definition_id: 'p-1',
        p_configuration: {
          steps: [{ name: 'analysis', statement: 'select * from readings' }],
        },
      },
    })
    expect(await screen.findByText(/nothing is published/i)).toBeTruthy()
  })

  it('Apply repairs an unfinished draft statement and uses its revision', async () => {
    view({
      ...pipelineVersion({
        ...pipelineJsonObjectSchema.parse(runConfig),
        steps: [{ name: 'analysis', kind: 'sql', statement: '' }],
      }),
      id: 'd-1',
      revision: 3,
    })
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    await screen.findByText('The table name has a typo.')
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      name: 'update_pipeline_definition_version_draft',
      args: {
        p_version_id: 'd-1',
        p_expected_revision: 3,
        p_configuration: {
          steps: [{ name: 'analysis', statement: 'select * from readings' }],
        },
      },
    })
  })

  it('Dismiss removes the card without writing', async () => {
    const { container } = view()
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    await screen.findByText('The table name has a typo.')
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container.innerHTML).toBe('')
    expect(writes).toHaveLength(0)
  })

  it('refuses an invalid draft before sending a configuration write', async () => {
    view(
      pipelineVersion({
        configVersion: 2,
        mode: 'standard',
        inputs: [],
        parameters: [],
        steps: [{ name: 'analysis', kind: 'sql', statement: 'select 1' }],
        output: { mode: 'invalid' },
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    await screen.findByText('The table name has a typo.')
    fireEvent.click(screen.getByRole('button', { name: /apply to draft/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(writes).toHaveLength(0)
  })

  it('shows a failure and lets the person ask again', async () => {
    view(
      undefined,
      ai({
        run: async () => ({
          status: 'error',
          code: 'provider_error',
          message: 'down',
        }),
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: /explain and suggest/i }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('down')
    expect(screen.getByRole('button', { name: /ask again/i })).toBeTruthy()
  })
})
