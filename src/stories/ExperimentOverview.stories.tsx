import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExperimentOverview } from '#/components/overview/overview-view'
import type { OverviewExperimentRecord } from '#/components/overview/overview-view'
import { auditVerificationKeys } from '#/lib/audit-verification-status'
import type { SignatureWire } from '#/lib/signatures'
import { screenQueryClient, screenRoutes } from './screen-stories'

const client = screenQueryClient({
  data: [
    {
      key: auditVerificationKeys.status,
      value: {
        ok: true,
        checkedAt: '2026-11-05T02:00:00.000Z',
        entriesChecked: 412,
        signaturesChecked: 9,
        firstBadRevisionId: null,
      },
    },
  ],
})

/**
 * The experiment Overview: the objective, protocol progress, what is still open
 * before submission (each row deep-links to the notebook block that resolves
 * it), key results and properties, with linked experiments and signatures in
 * the inspector. The component is presentational: the route supplies fetched
 * facts, so the stories hand it static ones.
 */
const RECORD: OverviewExperimentRecord = {
  id: 'exp-1',
  identifier: 'EXP-2026-0042',
  title: 'Virus stability at 25 °C',
  status: 'in_progress',
  projectId: 'p1',
  createdByUserId: 'user-1',
  createdAt: '2026-10-01T09:00:00.000Z',
  properties: { plannedEnd: '2026-11-20', reviewerId: 'user-2' },
}

const heading = (text: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] },
  ],
})

const BLOCKS = [
  {
    id: 'b-objective',
    type: 'rich_text',
    payload: {
      type: 'doc',
      content: [
        ...heading('Objective').content,
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Track infectious titre over four weeks at 25 °C to set the shelf-life claim.',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'b-step-1',
    type: 'procedure_step',
    payload: {
      text: 'Thaw the virus stock on ice.',
      stepNumber: 1,
      completed: true,
      completedAt: '2026-10-02T09:00:00.000Z',
      completedByUserId: 'user-1',
    },
  },
  {
    id: 'b-step-2',
    type: 'procedure_step',
    payload: { text: 'Dilute to 1e6 PFU/mL in assay buffer.', stepNumber: 2 },
  },
]

const SIGNATURES: SignatureWire[] = [
  {
    id: 'sig-1',
    workspace_id: 'w1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: 'exp-1',
    signature_meaning: 'authored',
    assurance_level: 'standard',
    revision_integrity_digest: '4c9620bbd4f931955d4d42820a77fa9d',
    signer_user_id: 'user-1',
    signer_session_id: 'session-1',
    signer_role: 'member',
    auth_method: 'password',
    confirmation_phrase: 'I confirm this record is accurate',
    signed_at: '2026-10-20T09:00:00.000Z',
    created_at: '2026-10-20T09:00:00.000Z',
    signer_name: 'Dana Whitfield',
  },
]

const NAMES: Record<string, string> = {
  'user-1': 'Dana Whitfield',
  'user-2': 'Tom Ellis',
}

const meta = {
  title: 'Experiments/Overview',
  component: ExperimentOverview,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/', ['/protocols/$protocolId']),
        path: '/',
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    record: RECORD,
    blocks: BLOCKS,
    links: [
      {
        id: 'l1',
        linkType: 'protocol',
        targetKind: 'protocol',
        targetIdentifier: 'PRT-2026-0012',
        targetRecordId: 'prt-1',
      },
      {
        id: 'l2',
        linkType: 'produced',
        targetKind: 'dataset',
        targetIdentifier: 'DS-0107',
        targetRecordId: null,
      },
    ],
    readiness: {
      recordId: 'exp-1',
      ready: false,
      validationErrors: [],
      openCommentThreads: [
        {
          commentId: 'c1',
          body: 'Is the incubation temperature right?',
          authorUserId: 'user-2',
          target: { blockId: 'b-step-2' },
          createdAt: '2026-10-21T09:00:00.000Z',
        },
      ],
      emptyRequiredFields: [],
    },
    signatures: SIGNATURES,
    followedBy: [
      {
        id: 'exp-2',
        identifier: 'EXP-2026-0043',
        title: 'Buffer exchange optimisation',
        status: 'draft',
      },
    ],
    userLabel: (id: string) => NAMES[id] ?? 'Someone',
    projectName: 'TB-02 stability',
  },
} satisfies Meta<typeof ExperimentOverview>

export default meta

type Story = StoryObj<typeof meta>

/** In progress, with one open comment before submission. */
export const InProgress: Story = {}

/** Nothing open: the record is ready to submit. */
export const Ready: Story = {
  args: {
    readiness: {
      recordId: 'exp-1',
      ready: true,
      validationErrors: [],
      openCommentThreads: [],
      emptyRequiredFields: [],
    },
  },
}

export const LoadingReadiness: Story = {
  args: {
    readiness: null,
    readinessIsLoading: true,
    signaturesIsLoading: true,
  },
}

export const ReadinessFailed: Story = {
  args: {
    readiness: null,
    readinessError: 'The readiness check could not be read.',
    signaturesIsError: true,
  },
}

/** A notebook with no objective, protocol, links or signatures yet. */
export const Bare: Story = {
  args: {
    blocks: [],
    links: [],
    signatures: [],
    followedBy: [],
    projectName: null,
    record: { ...RECORD, properties: {} },
  },
}

/** Submitted: the review is what the page is about, so the to-do list is gone. */
export const InReview: Story = {
  args: { record: { ...RECORD, status: 'in_review' }, reviewerIds: ['user-2'] },
}
