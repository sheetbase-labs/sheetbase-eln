import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { SignatureWire } from '#/lib/signatures'
import type { PartSummary } from '#/lib/experiment-parts'
import type { AuditVerificationStatus } from '#/lib/audit-verification-status'
import type { ReadinessBlock } from './readiness'
import type { ExperimentOverviewProps } from './overview-view'

const clients: QueryClient[] = []

const requests: { url: string; method: string; body: RequestInit['body'] }[] =
  []

const unexpected: string[] = []
const pending = new Set<Promise<Response>>()
const releases: (() => void)[] = []
let auditReply = () => Promise.resolve(Response.json(null))

// AuditCheckLine captures fetch when its module creates the production client.
// Install the controlled HTTP boundary before importing that module tree.
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : input.toString()

  requests.push({ url, method: init?.method ?? 'GET', body: init?.body })

  if (
    url !== '/api/db/rpc/audit_verification_status' ||
    init?.method !== 'POST'
  ) {
    unexpected.push(url)
  }

  const response =
    url === '/api/db/rpc/audit_verification_status' && init?.method === 'POST'
      ? auditReply()
      : Promise.resolve(new Response(null, { status: 500 }))

  pending.add(response)
  void response.finally(() => pending.delete(response))

  return response
})

const { ExperimentOverview } = await import('./overview-view')

afterEach(async () => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  releases.splice(0).forEach((release) => release())
  await Promise.all(pending)
  expect(unexpected).toEqual([])
  requests.length = 0
  auditReply = () => Promise.resolve(Response.json(null))
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function renderOverview(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })

  clients.push(client)

  const root = createRootRoute({ component: () => ui })

  const fallback = createRoute({
    getParentRoute: () => root,
    path: '$',
    validateSearch: (search) => search,
  })

  const router = createRouter({
    routeTree: root.addChildren([fallback]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    scrollRestoration: false,
    defaultHashScrollIntoView: false,
  })

  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { router, client }
}

function overviewMarkup(props: ExperimentOverviewProps) {
  const client = new QueryClient()
  clients.push(client)

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  })

  return renderToString(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <ExperimentOverview {...props} />
      </RouterContextProvider>
    </QueryClientProvider>,
  )
}

const SHEET_BLOCK = 'blk-sheet'
const OBJECTIVE_BLOCK = 'blk-objective'

const BLOCKS: ReadinessBlock[] = [
  {
    id: OBJECTIVE_BLOCK,
    payload: {
      doc: {
        content: [
          {
            type: 'paragraph',
            content: [{ text: 'Screen three depth-filter trains.' }],
          },
        ],
      },
    },
  },
  { id: SHEET_BLOCK, payload: { instanceId: 'instance-1' } },
]

function signature(): SignatureWire {
  return {
    id: 'sig-1',
    workspace_id: 'ws-1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: 'rec-1',
    signature_meaning: 'reviewed-and-approved',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'user-mei',
    signer_session_id: 'session-1',
    signer_role: 'reviewer',
    auth_method: 'session+name-confirmation',
    confirmation_phrase: 'I approve',
    signed_at: '2026-09-25T10:00:00.000Z',
    created_at: '2026-09-25T10:00:00.000Z',
    signer_name: 'Mei L.',
  }
}

function baseProps(): ExperimentOverviewProps {
  return {
    record: {
      id: 'rec-1',
      identifier: 'EXP-0142',
      title: 'Harvest clarification',
      status: 'in_progress',
      projectId: 'project-1',
      createdByUserId: 'user-gp',
      createdAt: '2026-09-21T09:00:00.000Z',
      properties: {},
    },
    blocks: BLOCKS,
    links: [
      {
        id: 'link-protocol',
        linkType: 'protocol',
        targetKind: 'protocol_template',
        targetIdentifier: 'PRT-021',
        targetRecordId: 'protocol-1',
      },
      {
        id: 'link-dataset',
        linkType: 'dataset',
        targetKind: 'dataset',
        targetIdentifier: 'DS-0311',
        targetRecordId: 'dataset-1',
      },
      {
        id: 'link-upstream',
        linkType: 'upstream',
        targetKind: 'experiment',
        targetIdentifier: 'EXP-0138',
        targetRecordId: 'exp-2',
      },
    ],
    readiness: {
      recordId: 'rec-1',
      ready: false,
      validationErrors: [
        {
          revisionId: 'rev-1',
          checkDefinitionKey: 'default',
          checkDefinitionVersion: 1,
          overallStatus: 'fail',
          blockingFailures: 1,
          warningFailures: 0,
          runAt: '2026-09-24T16:04:00.000Z',
          results: [
            {
              key: 'schema-valid-columns',
              category: 'schema',
              severity: 'blocking',
              label: 'Sheet columns valid',
              status: 'fail',
              evidence: {
                invalidColumns: [
                  {
                    tableId: SHEET_BLOCK,
                    columnId: 'col-1',
                    fieldName: 'Turbidity',
                    logicalType: 'furlong',
                  },
                ],
              },
            },
          ],
        },
      ],
      openCommentThreads: [
        {
          commentId: 'cmt-1',
          body: 'Why is turbidity 61.5?',
          authorUserId: 'user-ps',
          target: { blockId: SHEET_BLOCK },
          createdAt: '2026-09-24T12:00:00.000Z',
        },
      ],
      emptyRequiredFields: [
        {
          instanceId: 'instance-1',
          instanceName: 'Clarification',
          parameterId: 'param-1',
          parameterKey: 'decision',
          label: 'Decision',
        },
      ],
    },
    signatures: [signature()],
    followedBy: [
      {
        id: 'exp-3',
        identifier: 'EXP-0145',
        title: '50 L confirmation run',
        status: 'draft',
      },
    ],
    userLabel: (userId) =>
      userId === 'user-gp'
        ? 'Gareth P.'
        : userId === 'user-ps'
          ? 'Priya S.'
          : userId,
    projectName: 'AAV9 process transfer',
  }
}

const STEP_BLOCKS: ReadinessBlock[] = [
  ...BLOCKS,
  {
    id: 'step-1',
    type: 'procedure_step',
    payload: {
      text: 'Equilibrate the column',
      stepNumber: 1,
      completed: true,
      completedAt: '2026-09-24T09:00:00.000Z',
      completedByUserId: 'user-gp',
      note: '20 CV at 150 cm/h',
      sourceProtocolRevisionId: 'rev-1',
      sourceStepBlockId: 'src-step-1',
    },
  },
  {
    id: 'step-2',
    type: 'procedure_step',
    payload: {
      text: 'Load the clarified harvest',
      stepNumber: 2,
      completed: false,
      completedAt: null,
      completedByUserId: null,
      note: '',
      sourceProtocolRevisionId: 'rev-1',
      sourceStepBlockId: 'src-step-2',
    },
  },
]

describe('EXP-02.2 protocol progress', () => {
  it('derives each step from the notebook, with who finished it and when', async () => {
    await renderOverview(
      <ExperimentOverview {...baseProps()} blocks={STEP_BLOCKS} />,
    )
    expect(screen.getByText('Equilibrate the column')).toBeDefined()
    expect(screen.getByText('Load the clarified harvest')).toBeDefined()
    // The completed step names who finished it and when.
    expect(screen.getByText('Done')).toBeDefined()
    expect(screen.getAllByText(/Gareth P\./).length).toBeGreaterThan(0)
    expect(screen.getByText('20 CV at 150 cm/h')).toBeDefined()
    // The unfinished step is not presented as done.
    expect(screen.getByText('Not started')).toBeDefined()
  })

  it('says no progress is recorded rather than inventing steps', async () => {
    await renderOverview(<ExperimentOverview {...baseProps()} />)
    expect(
      screen.getByText('Steps appear here as you work through the protocol.'),
    ).toBeDefined()
  })
})

describe('EXP-02.4 ExperimentOverview', () => {
  it('deep-links every readiness item to the block that resolves it', async () => {
    await renderOverview(<ExperimentOverview {...baseProps()} />)

    expect(screen.getByText('Sheet columns valid')).toBeDefined()
    expect(screen.getByText('Open comment thread')).toBeDefined()
    expect(screen.getByText('Decision is empty')).toBeDefined()

    for (const action of ['Go to cell', 'Open thread', 'Fill in']) {
      const link = screen.getByRole('link', { name: action })
      expect(link.getAttribute('href')).toBe(
        '/experiments/rec-1/notebook#block-blk-sheet',
      )
    }

    // The comment is attributed and the check names the offending column.
    expect(
      screen.getByText(/Priya S\.: Why is turbidity 61\.5\?/),
    ).toBeDefined()
    expect(
      screen.getByText(/Column “Turbidity” has unsupported type/),
    ).toBeDefined()
  })

  it('renders linked experiments and signatures from real data', async () => {
    await renderOverview(<ExperimentOverview {...baseProps()} />)

    const upstream = screen.getByRole('link', { name: 'EXP-0138' })
    expect(upstream.getAttribute('href')).toBe('/experiments/exp-2')

    const next = screen.getByRole('link', { name: 'EXP-0145' })
    expect(next.getAttribute('href')).toBe('/experiments/exp-3')
    expect(screen.getByText('50 L confirmation run')).toBeDefined()
    expect(screen.getByText(/Draft/)).toBeDefined()

    expect(screen.getByText('Mei L.')).toBeDefined()
    expect(screen.getByText('Reviewed and approved')).toBeDefined()
  })

  it('counts a dataset linked by identifier, as the Datasets tab does', async () => {
    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        links={[
          ...baseProps().links,
          {
            id: 'link-dataset-unaddressable',
            linkType: 'dataset',
            targetKind: 'dataset',
            targetIdentifier: 'DS-0310',
            targetRecordId: null,
          },
        ]}
      />,
    )

    // A dataset link without a record id is still an experiment dataset.
    expect(screen.getByText('DS-0310')).toBeDefined()
    expect(
      screen.queryByText(/No datasets or analyses are linked yet/),
    ).toBeNull()
  })

  it('leads key results with the notebook metrics and conclusion', async () => {
    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        blocks={[
          ...BLOCKS,
          {
            id: 'metric-1',
            type: 'metric',
            payload: {
              label: 'Peak cell density',
              value: '43.3',
              unit: 'x 10^6/mL',
              provenance: 'mean of three replicates',
            },
          },
          {
            id: 'conclusion-1',
            type: 'conclusion',
            payload: { text: 'Doubling at 72 h.', verdict: 'supported' },
          },
        ]}
      />,
    )

    expect(screen.getByText('Peak cell density')).toBeDefined()
    expect(screen.getByText('43.3')).toBeDefined()
    expect(screen.getByText('Doubling at 72 h.')).toBeDefined()
  })

  it('names an absent fact rather than faking it', async () => {
    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        record={{
          ...baseProps().record,
          properties: {},
        }}
        signatures={[]}
      />,
    )

    // No reviewer recorded: said, not invented. Optional facts nobody
    // recorded (planned end, client, collaborators) get no row at all.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Planned end')).toBeNull()
    expect(screen.queryByText('Client')).toBeNull()
    // Protocol step progress is not modelled, and the page says so.
    expect(
      screen.getByText('Steps appear here as you work through the protocol.'),
    ).toBeDefined()
    // No signatures: the honest empty state, not an empty table.
    expect(screen.getByText('No signatures yet')).toBeDefined()
  })
})

describe('parts', () => {
  const part = (
    number: number,
    extra: Partial<PartSummary> = {},
  ): PartSummary => ({
    partId: `part-${number}`,
    number,
    title: `Stage ${number}`,
    dayOffset: number - 1,
    dueOn: null,
    assigneeUserId: null,
    status: 'later',
    completedAt: null,
    completedByUserId: null,
    stepCount: 0,
    stepsDone: 0,
    blockCount: 0,
    resultCount: 0,
    ...extra,
  })

  it('shows nothing for an experiment that is one page', async () => {
    await renderOverview(<ExperimentOverview {...baseProps()} />)
    expect(screen.queryByRole('table', { name: 'Parts' })).toBeNull()
  })

  it('lists the parts with their day, who finished them and the steps done', async () => {
    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        parts={[
          part(1, {
            status: 'done',
            completedByUserId: 'user-mei',
            completedAt: '2026-09-21T15:00:00.000Z',
            stepCount: 3,
            stepsDone: 3,
            resultCount: 2,
          }),
          part(2, { status: 'now' }),
        ]}
      />,
    )
    const table = screen.getByRole('table', { name: 'Parts' })
    expect(table.textContent).toContain('Stage 1')
    expect(table.textContent).toContain('Day 1 · Tue 22 Sep')
    expect(table.textContent).toContain('3 of 3')
    expect(screen.getByText('1 of 2 parts done')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Stage 2' }).getAttribute('href'),
    ).toBe('/experiments/rec-1/notebook/2')
  })
})

describe('readiness presentation', () => {
  it.each([
    {
      status: 'in_review',
      loading: true,
      error: 'Unavailable',
      message: 'Submitted for review. Nothing to close until it comes back.',
    },
    {
      status: 'in_progress',
      loading: true,
      error: 'Unavailable',
      message: 'Checking readiness…',
    },
    {
      status: 'in_progress',
      loading: false,
      error: 'Unavailable',
      message: 'Couldn’t check readiness: Unavailable',
    },
    {
      status: 'in_progress',
      loading: false,
      error: null,
      message: 'Nothing open. The record is ready for submission',
    },
  ])(
    'prefers $message over stale blockers',
    async ({ status, loading, error, message }) => {
      const props = baseProps()

      await renderOverview(
        <ExperimentOverview
          {...props}
          record={{ ...props.record, status }}
          readiness={
            loading || error || status === 'in_review'
              ? props.readiness
              : {
                  recordId: props.record.id,
                  ready: true,
                  validationErrors: [],
                  openCommentThreads: [],
                  emptyRequiredFields: [],
                }
          }
          readinessIsLoading={loading}
          readinessError={error}
        />,
      )
      expect(screen.getByText(message)).toBeDefined()
      expect(screen.queryByRole('link', { name: 'Go to cell' })).toBeNull()

      if (status === 'in_review') {
        expect(
          screen.queryByRole('button', { name: 'Submit for review' }),
        ).toBeNull()
      }
    },
  )

  it('opens the real notebook submit location', async () => {
    const { router } = await renderOverview(
      <ExperimentOverview {...baseProps()} />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/experiments/rec-1/notebook')
      expect(router.state.location.search).toEqual({ reopen: 'submit' })
      expect(router.state.location.href).toBe(
        '/experiments/rec-1/notebook?reopen=submit',
      )
    })
  })
})

describe('audit verification over the production data client', () => {
  it('makes no audit claim while pending, then exposes a failed check', async () => {
    const status: AuditVerificationStatus = {
      ok: false,
      checkedAt: '2026-09-25T10:00:00.000Z',
      entriesChecked: 10,
      signaturesChecked: 1,
      firstBadRevisionId: 'rev-1',
    }

    let release: () => void = () => {
      throw new Error('The audit response gate is not initialized')
    }

    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    releases.push(release)
    auditReply = async () => {
      await gate

      return Response.json(status)
    }

    await renderOverview(<ExperimentOverview {...baseProps()} />)
    await userEvent.hover(
      screen.getByRole('button', { name: 'About these signatures' }),
    )
    expect(
      await screen.findByText(/bound to the frozen revision it attests/),
    ).toBeDefined()
    expect(
      screen.queryByText(/verified intact|haven’t been checked yet/),
    ).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(requests).toEqual([
      {
        url: '/api/db/rpc/audit_verification_status',
        method: 'POST',
        body: '{}',
      },
    ])

    release()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The latest check of the signatures and audit trail failed',
    )
  })

  it.each([false, true])(
    'distinguishes an unchecked audit from HTTP refusal: refused=%s',
    async (refused) => {
      auditReply = () =>
        Promise.resolve(
          refused
            ? Response.json(
                { error: { code: 'refused', message: 'Not available' } },
                { status: 403 },
              )
            : Response.json(null),
        )

      const { client } = await renderOverview(
        <ExperimentOverview {...baseProps()} />,
      )

      await waitFor(() => {
        expect(client.isFetching()).toBe(0)
        expect(client.getQueryState(['audit-verification'])?.status).toBe(
          refused ? 'error' : 'success',
        )
      })
      await userEvent.hover(
        screen.getByRole('button', { name: 'About these signatures' }),
      )
      expect(
        await screen.findByText(/bound to the frozen revision it attests/),
      ).toBeDefined()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByText(/verified intact/)).toBeNull()

      if (refused) {
        expect(
          screen.queryByText(
            'The signatures and audit trail haven’t been checked yet.',
          ),
        ).toBeNull()
      } else {
        expect(
          screen.getByText(
            'The signatures and audit trail haven’t been checked yet.',
          ),
        ).toBeDefined()
      }
    },
  )
})

describe('native overview prose and properties', () => {
  it('reads readiness status before resolving the owner label', () => {
    let statusReads = 0
    let label = 'native-before'
    const props = baseProps()
    props.blocks = []
    props.links = []
    props.readiness = null
    props.signatures = []
    props.record = {
      ...props.record,
      get status() {
        statusReads += 1

        if (statusReads === 3) label = 'native-after'

        return 'in_progress'
      },
    }
    props.userLabel = () => label

    expect(overviewMarkup(props)).toContain('native-after')
    expect(statusReads).toBe(3)
  })

  it('constructs the submit action before a stateful owner callback changes status', () => {
    const props = baseProps()
    props.blocks = []
    props.links = []
    props.readiness = null
    props.signatures = []
    props.userLabel = () => {
      props.record.status = 'approved'

      return 'Native owner'
    }

    expect(overviewMarkup(props)).toContain('Submit for review')
    expect(props.record.status).toBe('approved')
  })

  it('propagates the readiness getter throw before calling the owner callback', () => {
    const failure = new Error('third status read')
    let statusReads = 0
    const labels: string[] = []
    const props = baseProps()
    props.blocks = []
    props.links = []
    props.readiness = null
    props.signatures = []
    props.record = {
      ...props.record,
      get status() {
        statusReads += 1

        if (statusReads === 3) throw failure

        return 'in_progress'
      },
    }
    props.userLabel = (id) => {
      labels.push(id)

      return id
    }

    expect(() => overviewMarkup(props)).toThrow(failure)
    expect(labels).toEqual([])
  })

  it('reads inherited array prose, preferring text without reading unrelated getters', async () => {
    class Prose extends Array<never> {
      get text() {
        return 'Inherited objective text'
      }

      get content(): never {
        throw new Error('Text takes precedence over content')
      }
    }

    class Document {
      get content() {
        return [new Prose()]
      }

      get unrelated(): never {
        throw new Error('Unrelated document metadata must remain unread')
      }
    }

    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        blocks={[{ id: 'native-prose', payload: { doc: new Document() } }]}
      />,
    )
    expect(screen.getByText('Inherited objective text')).toBeDefined()
  })

  it.each([false, true])(
    'preserves Objective-heading fallback, empty=%s',
    async (empty) => {
      await renderOverview(
        <ExperimentOverview
          {...baseProps()}
          blocks={[
            {
              id: 'other-prose',
              payload: { doc: { content: [{ text: 'Context' }] } },
            },
            {
              id: 'objective',
              payload: {
                doc: {
                  content: [
                    { type: 'heading', text: 'Objective' },
                    { text: empty ? '' : 'Specific objective' },
                  ],
                },
              },
            },
          ]}
        />,
      )
      expect(
        screen.getByText(empty ? 'Context Objective' : 'Specific objective'),
      ).toBeDefined()
      expect(
        screen.queryByText(empty ? 'Specific objective' : 'Context'),
      ).toBeNull()
    },
  )

  it('captures each primitive property value once and ignores unrelated metadata', async () => {
    let reviewerReads = 0
    let collaboratorReads = 0

    const properties: ExperimentOverviewProps['record']['properties'] = {
      get reviewerId() {
        reviewerReads += 1

        return reviewerReads === 1 ? 'user-ps' : null
      },
      get collaboratorIds() {
        collaboratorReads += 1

        return collaboratorReads === 1 ? ['user-gp'] : null
      },
      get unrelated(): never {
        throw new Error('Unrelated native metadata must remain unread')
      },
    }

    await renderOverview(
      <ExperimentOverview
        {...baseProps()}
        record={{ ...baseProps().record, properties }}
      />,
    )
    expect(screen.getByText('Priya S.')).toBeDefined()
    expect(screen.getAllByText('Gareth P.')).toHaveLength(2)
    expect(reviewerReads).toBe(1)
    expect(collaboratorReads).toBe(1)
  })

  it.each(['prose', 'property'])(
    'propagates native %s getter errors during rendering',
    (source) => {
      const failure = new Error('Native accessor refused the read')
      const props = baseProps()

      if (source === 'prose') {
        props.blocks = [
          {
            id: 'throwing-prose',
            payload: {
              doc: {
                content: [
                  {
                    get text(): never {
                      throw failure
                    },
                  },
                ],
              },
            },
          },
        ]
      } else {
        props.record.properties = {
          get reviewerId(): never {
            throw failure
          },
        }
      }

      const client = new QueryClient()

      clients.push(client)

      const router = createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })

      expect(() =>
        renderToString(
          <QueryClientProvider client={client}>
            <RouterContextProvider router={router}>
              <ExperimentOverview {...props} />
            </RouterContextProvider>
          </QueryClientProvider>,
        ),
      ).toThrow(failure)
    },
  )
})
