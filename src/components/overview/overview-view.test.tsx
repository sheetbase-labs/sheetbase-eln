import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SignatureWire } from '#/lib/signatures'
import type { ReadinessBlock } from './readiness'
import type { ExperimentOverviewProps } from './overview-view'
import { ExperimentOverview } from './overview-view'

const linkCalls = vi.hoisted(() => ({
  calls: [] as Array<{
    to?: string
    params?: Record<string, string>
    hash?: string
  }>,
}))

// The overview renders router links; record the invocations and interpolate
// route params + hash so the resulting href can be asserted without a router.
// The verification line reads the server on its own; these tests are about the table.
vi.mock('#/components/review/audit-check-line', () => ({
  AuditCheckLine: () => null,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    hash,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    hash?: string
    children?: React.ReactNode
  } & Record<string, unknown>) => {
    linkCalls.calls.push({ to, params, hash })
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, encodeURIComponent(value))
      }
    }
    if (hash) href += `#${hash}`
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

afterEach(() => {
  cleanup()
  linkCalls.calls = []
})

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
  it('derives each step from the notebook, with who finished it and when', () => {
    render(<ExperimentOverview {...baseProps()} blocks={STEP_BLOCKS} />)
    expect(screen.getByText('Equilibrate the column')).toBeDefined()
    expect(screen.getByText('Load the clarified harvest')).toBeDefined()
    // The completed step names who finished it and when.
    expect(screen.getByText('Done')).toBeDefined()
    expect(screen.getAllByText(/Gareth P\./).length).toBeGreaterThan(0)
    expect(screen.getByText('20 CV at 150 cm/h')).toBeDefined()
    // The unfinished step is not presented as done.
    expect(screen.getByText('Not started')).toBeDefined()
  })

  it('says no progress is recorded rather than inventing steps', () => {
    render(<ExperimentOverview {...baseProps()} />)
    expect(screen.getByText(/No step progress is recorded yet/)).toBeDefined()
  })
})

describe('EXP-02.4 ExperimentOverview', () => {
  it('deep-links every readiness item to the block that resolves it', () => {
    render(<ExperimentOverview {...baseProps()} />)

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

  it('renders linked experiments and signatures from real data', () => {
    render(<ExperimentOverview {...baseProps()} />)

    const upstream = screen.getByRole('link', { name: 'EXP-0138' })
    expect(upstream.getAttribute('href')).toBe('/experiments/exp-2')

    const next = screen.getByRole('link', { name: 'EXP-0145' })
    expect(next.getAttribute('href')).toBe('/experiments/exp-3')
    expect(screen.getByText('50 L confirmation run')).toBeDefined()
    expect(screen.getByText(/Draft/)).toBeDefined()

    expect(screen.getByText('Mei L.')).toBeDefined()
    expect(screen.getByText('Reviewed and approved')).toBeDefined()
  })

  it('counts a dataset linked by identifier, as the Datasets tab does', () => {
    render(
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

  it('names an absent fact rather than faking it', () => {
    render(
      <ExperimentOverview
        {...baseProps()}
        record={{
          ...baseProps().record,
          properties: {},
        }}
        signatures={[]}
      />,
    )

    // No reviewer / planned end / client recorded: said, not invented.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(3)
    // Protocol step progress is not modelled, and the page says so.
    expect(screen.getByText(/No step progress is recorded yet/)).toBeDefined()
    // No signatures: the honest empty state, not an empty table.
    expect(screen.getByText('No signatures yet')).toBeDefined()
  })
})
