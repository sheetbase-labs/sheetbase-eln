import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { extensionQueryKeys } from '#/lib/extensions/client'
import { parseExtensionManifest } from '#/lib/extensions/manifest'
import { gateQueryKeys } from '#/lib/experiment-gates'
import type { GateCondition, RecordGate } from '#/lib/experiment-gates'
import { GateBlockView, GateDialog, GatesProvider } from './gates'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'runs checks sharing a persisted key in order and stops on refusal: %s',
  async (refused) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })

    const conditions = ['Recovery', 'Purity', 'Yield'].map(
      (column): GateCondition => ({
        kind: 'plugin_check',
        blockId: 'table-1',
        extensionKey: 'assay',
        checkId: 'limit',
        columns: { value: column },
      }),
    )

    const gate: RecordGate = {
      gateId: 'block:gate-1',
      kind: 'block',
      blockId: 'gate-1',
      partId: null,
      partNumber: null,
      label: 'Assay checks',
      mode: 'block',
      met: false,
      blocking: true,
      overridden: false,
      overriddenAt: null,
      overriddenByUserId: null,
      overrideReason: null,
      missing: ['Run assay checks'],
      conditions: conditions.map(() => ({
        kind: 'plugin_check',
        met: false,
        soft: false,
        text: 'Run assay check',
      })),
      fromTemplate: false,
    }

    const requests: unknown[] = []

    let finishFirst: (response: Response) => void = () => {
      throw new Error('First request has not started')
    }

    const firstResponse = new Promise<Response>((resolve) => {
      finishFirst = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        expect(input).toBe('/api/plugins/data')
        expect(init?.method).toBe('POST')
        requests.push(JSON.parse(z.string().parse(init?.body)))

        if (requests.length === 1) return firstResponse

        return Response.json({ status: 'pass', message: '' })
      }),
    )
    const key = gateQueryKeys.forRecord('record-1')
    const unrelatedKey = gateQueryKeys.forRecord('record-2')
    client.setQueryData(key, [gate])
    client.setQueryData(unrelatedKey, [])
    render(
      <QueryClientProvider client={client}>
        <GatesProvider
          value={{
            recordId: 'record-1',
            gates: [gate],
            held: new Map(),
            stepWaits: new Map(),
            canEdit: true,
            describeOnly: false,
            context: { blocks: [], parts: [] },
            nameOf: () => '',
            goOn: vi.fn(),
            edit: vi.fn(),
            show: vi.fn(),
            targetsFor: () => ({ tables: [], steps: [], parts: [] }),
          }}
        >
          <GateBlockView blockId="gate-1" payload={{ conditions }} />
        </GatesProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    // Settle every microtask a parallel implementation could use to start its next request.
    await act(async () => {
      await Promise.resolve()
    })
    expect(requests).toEqual([
      {
        kind: 'gate-check',
        recordId: 'record-1',
        blockId: 'table-1',
        extensionKey: 'assay',
        checkId: 'limit',
        columns: { value: 'Recovery' },
      },
    ])
    await act(async () => {
      finishFirst(
        refused
          ? Response.json({ error: 'Assay refused' }, { status: 403 })
          : Response.json({ status: 'pass', message: '' }),
      )
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run check' })).toHaveProperty(
        'disabled',
        false,
      ),
    )
    expect(requests).toHaveLength(refused ? 1 : 3)

    if (!refused) {
      expect(requests.slice(1)).toEqual(
        ['Purity', 'Yield'].map((column) => ({
          kind: 'gate-check',
          recordId: 'record-1',
          blockId: 'table-1',
          extensionKey: 'assay',
          checkId: 'limit',
          columns: { value: column },
        })),
      )
    }

    expect(client.getQueryState(key)?.isInvalidated).toBe(!refused)
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
  },
)

it('retains the focused condition when an earlier identical condition is removed', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])
  const save = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <GateDialog
        initial={{
          conditions: [
            { kind: 'date_reached', date: '2026-11-10' },
            { kind: 'date_reached', date: '2026-11-10' },
          ],
        }}
        targets={{ tables: [], steps: [], parts: [] }}
        kinds={['date_reached']}
        onSave={save}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  )
  const secondDate = screen.getAllByLabelText('Date')[1]
  secondDate.focus()
  fireEvent.change(secondDate, { target: { value: '2026-12-25' } })
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Remove condition' })[0],
  )
  expect(screen.getByLabelText('Date')).toBe(secondDate)
  expect(document.activeElement).toBe(secondDate)
  expect(secondDate).toHaveProperty('value', '2026-12-25')
  fireEvent.click(screen.getByRole('button', { name: 'Save gate' }))
  expect(save).toHaveBeenCalledWith({
    label: '',
    mode: 'warn',
    stepsInOrder: false,
    conditions: [{ kind: 'date_reached', date: '2026-12-25' }],
  })
})

it.each(['plugin_flag', 'plugin_check'] satisfies Array<
  'plugin_flag' | 'plugin_check'
>)(
  'adopts a late %s default once and keeps it across metadata refresh',
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })

    const key = [...extensionQueryKeys.extensions, 'points']
    client.setQueryData(key, [])
    const save = vi.fn()

    const condition: GateCondition =
      kind === 'plugin_flag'
        ? { kind, extensionKey: '' }
        : {
            kind,
            blockId: 'table-1',
            extensionKey: '',
            checkId: '',
            columns: {},
          }

    render(
      <QueryClientProvider client={client}>
        <GateDialog
          initial={{ conditions: [condition] }}
          targets={{
            tables: [
              {
                id: 'table-1',
                label: 'Readings',
                columns: ['Recovery', 'Group'],
              },
            ],
            steps: [],
            parts: [],
          }}
          kinds={[kind]}
          onSave={save}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    function install(name: string) {
      return {
        id: name,
        key: name,
        name,
        status: 'enabled',
        manifest: parseExtensionManifest({
          id: `lab.${name}`,
          name,
          version: '1.0.0',
          source: 'https://example.com/plugin.tgz',
          capabilities: [],
          scopes: ['projects:read'],
          contributions: {
            checks: [
              {
                id: 'recovery',
                title: 'Recovery check',
                description: 'Check recovery',
                inputs: [
                  {
                    name: 'recovery',
                    label: 'Recovery',
                    type: 'number',
                    required: true,
                  },
                ],
                runner: { kind: 'python', entry: 'checks:run' },
              },
            ],
            'record-hooks': [
              {
                id: 'hold',
                title: 'Review hold',
                description: 'Require review',
                when: ['edited'],
                timing: 'after',
                runner: { kind: 'python', entry: 'checks:hold' },
              },
            ],
          },
        }),
      }
    }

    await act(() => client.setQueryData(key, [install('recovery')]))
    const label = kind === 'plugin_flag' ? 'Plugin' : 'Check'
    const selected = kind === 'plugin_flag' ? 'recovery' : 'recovery/recovery'
    await waitFor(() =>
      expect(screen.getByLabelText(label)).toHaveProperty('value', selected),
    )
    await act(() =>
      client.setQueryData(key, [install('aaa'), install('recovery')]),
    )
    await waitFor(() =>
      expect(screen.getByLabelText(label)).toHaveProperty('value', selected),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save gate' }))
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [
          kind === 'plugin_flag'
            ? { kind, extensionKey: 'recovery', label: 'recovery' }
            : {
                kind,
                blockId: 'table-1',
                extensionKey: 'recovery',
                checkId: 'recovery',
                label: 'Recovery check',
                columns: { recovery: 'Recovery' },
              },
        ],
      }),
    )
  },
)
