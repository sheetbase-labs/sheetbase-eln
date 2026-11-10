import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { ReleaseRulesPanel } from './release-rules-panel'
import { SampleWorkflowsPanel } from './sample-workflows-panel'

afterEach(() => {
  cleanup()
  dropSharedReads()
})

function policyClient() {
  const schema = z.json()
  const writes: z.infer<typeof schema>[] = []
  const unexpected: string[] = []

  const client = createDataClient(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    const method = init?.method ?? 'GET'
    const resource = url.pathname.replace('/api/db/', '')

    if (method === 'GET' && resource === 'records') return Response.json([])

    if (method === 'GET' && resource === 'sample_release_rules')
      return Response.json([
        {
          sample_type: 'Plasma',
          updated_at: '2026-10-01T09:00:00Z',
          rules: [
            { kind: 'no_result', result: 'fail', label: 'First' },
            { kind: 'no_result', result: 'warning', label: 'Survivor' },
          ],
        },
      ])

    if (
      method === 'POST' &&
      ['rpc/set_sample_release_rules', 'rpc/save_sample_workflow'].includes(
        resource,
      )
    ) {
      writes.push(schema.parse(await new Response(init?.body).json()))

      return Response.json(
        resource === 'rpc/save_sample_workflow' ? 'saved-workflow' : null,
      )
    }

    unexpected.push(`${method} ${url}`)
    throw new Error(`Unexpected policy request: ${method} ${url}`)
  })

  return { client, writes, unexpected }
}

it('keeps a surviving release check input mounted and saves only its rule after deleting its predecessor', async () => {
  const user = userEvent.setup()
  const fixture = policyClient()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReleaseRulesPanel workspaceId="ws" canManage client={fixture.client} />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByText('Plasma'))
  const survivor = screen.getByDisplayValue('Survivor')
  await user.click(screen.getAllByRole('button', { name: 'Remove check' })[0])
  expect(screen.getByDisplayValue('Survivor')).toBe(survivor)
  await user.type(survivor, ' edited')
  await user.click(screen.getByRole('button', { name: 'Save checks' }))
  await waitFor(() =>
    expect(fixture.writes).toEqual([
      {
        p_workspace_id: 'ws',
        p_sample_type: 'Plasma',
        p_rules: [
          { kind: 'no_result', result: 'warning', label: 'Survivor edited' },
        ],
      },
    ]),
  )
  expect(fixture.unexpected).toEqual([])
})

it('keeps surviving automation inputs mounted and restores stage-specific drafts without leaking row ids into writes', async () => {
  const user = userEvent.setup()
  const fixture = policyClient()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SampleWorkflowsPanel
        workspaceId="ws"
        canManage
        editing="new"
        onEdit={() => {}}
        client={fixture.client}
      />
    </QueryClientProvider>,
  )
  await user.type(
    await screen.findByRole('textbox', { name: 'Name' }),
    'Plasma workflow',
  )
  await user.click(screen.getByRole('button', { name: 'Add automation' }))
  await user.click(screen.getByRole('button', { name: 'Add automation' }))

  const messages = screen.getAllByRole('textbox', {
    name: 'Message (optional)',
  })

  await user.type(messages[0], 'First')
  await user.type(messages[1], 'Survivor')
  await user.click(screen.getAllByRole('button', { name: 'Remove' })[0])
  expect(screen.getByDisplayValue('Survivor')).toBe(messages[1])
  await user.type(messages[1], ' edited')
  await user.click(screen.getByRole('row', { name: /^Done/ }))
  expect(
    screen.queryByRole('textbox', { name: 'Message (optional)' }),
  ).toBeNull()
  await user.click(screen.getByRole('row', { name: /^Received/ }))
  expect(screen.getByDisplayValue('Survivor edited')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(fixture.writes).toHaveLength(1))
  expect(fixture.writes[0]).toMatchObject({
    p_workflow_id: null,
    p_definition: {
      name: 'Plasma workflow',
      stages: [
        {
          actions: [
            { kind: 'notify', to: 'owner', message: 'Survivor edited' },
          ],
        },
        { actions: [] },
      ],
    },
  })

  const payload = z
    .object({
      p_definition: z.object({
        stages: z.array(z.object({ actions: z.array(z.json()) })),
      }),
    })
    .parse(fixture.writes[0])

  expect(payload.p_definition.stages.map((stage) => stage.actions)).toEqual([
    [{ kind: 'notify', to: 'owner', message: 'Survivor edited' }],
    [],
  ])
  expect(fixture.unexpected).toEqual([])
})
