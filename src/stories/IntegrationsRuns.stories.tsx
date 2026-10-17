import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { ConnectorCredentialsCard } from '#/components/v3/integrations/credentials-card'
import { RunHistory } from '#/components/v3/integrations/run-history'
import { connectorQueryKeys } from '#/lib/connectors/client'
import type {
  ConnectorRunLogWire,
  ConnectorRunWire,
} from '#/lib/connectors/types'
import { holdRead, screenQueryClient, withApiReads } from './screen-stories'
import type { FailedRead, ReadSeed } from './screen-stories'

/**
 * The right-hand column of a connector's detail page
 * (`src/routes/settings/integrations/$connectorId.tsx`): the run history and,
 * for an enterprise connector, the sealed credentials card.
 *
 * Both read through React Query with their own query functions, so a story
 * seeds the read it claims — and `withApiReads` answers anything a story leaves
 * unseeded, including a read that outlives its seed. Nothing here reaches the
 * network. The credentials card's write path (set/rotate/delete) is a server
 * function and is not exercised.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'
const CONNECTOR_ID = '0198d970-e266-4000-8000-0000000c0001'

const meta = {
  title: 'Integrations/Connector detail',
  decorators: [
    withApiReads('error'),
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A story's read client: what it seeds, and the read it answers with a failure. */
function provider(data: ReadSeed[], failed?: FailedRead) {
  const client = screenQueryClient({ data })
  if (failed) holdRead(client, failed.key, failed.kind, failed.message)
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

// --- Run history -----------------------------------------------------------

function run(overrides: Partial<ConnectorRunWire> = {}): ConnectorRunWire {
  return {
    id: '0198d970-e266-4000-8000-0000000e0001',
    workspace_id: WORKSPACE_ID,
    connector_id: CONNECTOR_ID,
    trigger_kind: 'manual',
    status: 'succeeded',
    attempt: 1,
    retry_of_run_id: null,
    request_digest: 'sha256:9f2c41ab77d0e5b8c1a4',
    result: {},
    error_code: null,
    error_message: null,
    started_at: '2026-10-14T08:12:00.000Z',
    finished_at: '2026-10-14T08:12:14.000Z',
    ...overrides,
  }
}

const failedRun = run({
  id: 'run-failed',
  // A retry of the run before it, which is what the attempt column states.
  attempt: 2,
  retry_of_run_id: '0198d970-e266-4000-8000-0000000e0000',
  status: 'failed',
  request_digest: 'sha256:41c0de99a0b7f3e2d5a1',
  error_code: 'row_validation_failed',
  error_message: 'Row 18: value is not a number.',
  started_at: '2026-10-14T09:40:00.000Z',
  finished_at: '2026-10-14T09:40:06.000Z',
})

const plateRun = run({
  id: 'run-succeeded',
  started_at: '2026-10-15T07:05:00.000Z',
  finished_at: '2026-10-15T07:05:11.000Z',
  result: {
    kind: 'instrument_ingest',
    rowCount: 96,
    datasetId: '0198d970-e266-4000-8000-000000000d01',
    datasetRevision: 4,
    fileRecordId: '0198d970-e266-4000-8000-00000000f001',
    fileSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  },
})

const s3Run = run({
  id: 'run-s3',
  trigger_kind: 'scheduled',
  started_at: '2026-10-16T02:00:00.000Z',
  finished_at: '2026-10-16T02:00:23.000Z',
  result: {
    kind: 's3_object_import',
    rowCount: 480,
    datasetId: '0198d970-e266-4000-8000-000000000d02',
    source: {
      kind: 's3_object',
      bucket: 'acme-lab-archive',
      key: 'ambr/2026/10/plate-3-run-2.csv',
    },
    fileSha256: 'ff00ee11dd22cc33bb44aa5599668877',
  },
})

const runningRun = run({
  id: 'run-running',
  trigger_kind: 'event',
  status: 'running',
  request_digest: null,
  started_at: '2026-10-16T09:30:00.000Z',
  finished_at: null,
})

const failedRunLogs: ConnectorRunLogWire[] = [
  {
    id: 'log-1',
    workspace_id: WORKSPACE_ID,
    run_id: failedRun.id,
    sequence: 1,
    level: 'info',
    stage: 'retain',
    message: 'Retained plate-3-run-2.csv as file record 0198d970…f001.',
    detail: {},
    at: '2026-10-14T09:40:00.000Z',
  },
  {
    id: 'log-2',
    workspace_id: WORKSPACE_ID,
    run_id: failedRun.id,
    sequence: 2,
    level: 'info',
    stage: 'parse',
    message: 'Parsed 96 rows with sheetbase.plate-reader-csv@1.',
    detail: {},
    at: '2026-10-14T09:40:02.000Z',
  },
  {
    id: 'log-3',
    workspace_id: WORKSPACE_ID,
    run_id: failedRun.id,
    sequence: 3,
    level: 'error',
    stage: 'validate',
    message: 'Row 18: value is not a number. No rows were committed.',
    detail: {},
    at: '2026-10-14T09:40:06.000Z',
  },
]

const runsKey = connectorQueryKeys.runs(CONNECTOR_ID)

/** Attempts, a bounded error and the provenance payload each run keeps. */
export const Runs: Story = {
  decorators: [
    provider([
      {
        key: runsKey,
        value: [failedRun, plateRun, s3Run, runningRun],
      },
    ]),
  ],
  render: () => <RunHistory connectorId={CONNECTOR_ID} />,
}

/** A connector that has never run: the table says so on one row. */
export const NoRunsYet: Story = {
  decorators: [provider([{ key: runsKey, value: [] }])],
  render: () => <RunHistory connectorId={CONNECTOR_ID} />,
}

/**
 * The runs read was refused (a caller who is not a member of the connector's
 * workspace): the table renders its columns and no rows. `ConnectedRunRows`
 * returns nothing without data and restates no failure, so a *pending* or
 * *failed* read renders this same table — this component has no error state of
 * its own. The refusal is reported where the write came from.
 */
export const RunsRefused: Story = {
  decorators: [provider([], { key: runsKey, kind: 'denied' })],
  render: () => <RunHistory connectorId={CONNECTOR_ID} />,
}

/**
 * Expands the failed attempt — the error line, then the run's own stage logs —
 * by clicking the row's own disclosure, so the state is the component's, not a
 * fixture. The logs read is seeded for that run and stays unread for the rest.
 */
export const FailedRunExpanded: Story = {
  decorators: [
    provider([
      { key: runsKey, value: [failedRun, plateRun] },
      { key: connectorQueryKeys.runLogs(failedRun.id), value: failedRunLogs },
    ]),
  ],
  render: () => <RunHistory connectorId={CONNECTOR_ID} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [firstShow] = await canvas.findAllByRole('button', { name: 'Show' })
    await userEvent.click(firstShow)
    await expect(
      await canvas.findByText(/row_validation_failed: Row 18/),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText(/error validate: Row 18: value is not a number/),
    ).toBeInTheDocument()
  },
}

// --- Credentials -----------------------------------------------------------

const secretsKey = ['connectors', CONNECTOR_ID, 'secret-names'] as const
const S3_SECRETS = ['access_key_id', 'secret_access_key', 'session_token']

/** What the object-storage adapter needs, all three stored. */
export const CredentialsStored: Story = {
  decorators: [
    provider([
      {
        key: secretsKey,
        value: [
          {
            secretName: 'access_key_id',
            updatedAt: '2026-09-01T09:00:00.000Z',
          },
          {
            secretName: 'secret_access_key',
            updatedAt: '2026-09-28T14:32:00.000Z',
          },
          {
            secretName: 'session_token',
            updatedAt: '2026-10-13T06:05:00.000Z',
          },
        ],
      },
    ]),
  ],
  render: () => (
    <ConnectorCredentialsCard
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      requiredSecrets={S3_SECRETS}
      canManage
    />
  ),
}

/** One required secret is missing, so the run would fail: the card names it. */
export const CredentialsMissing: Story = {
  decorators: [
    provider([
      {
        key: secretsKey,
        value: [
          {
            secretName: 'access_key_id',
            updatedAt: '2026-10-13T06:05:00.000Z',
          },
        ],
      },
    ]),
  ],
  render: () => (
    <ConnectorCredentialsCard
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      requiredSecrets={S3_SECRETS}
      canManage
    />
  ),
}

/**
 * Nothing stored yet. While the read is still pending the card cannot tell the
 * two apart — `secretsQuery.data ?? []` is empty either way — so this story
 * stands for both; the missing line is the card's own statement about it.
 */
export const NoCredentialsStored: Story = {
  decorators: [provider([{ key: secretsKey, value: [] }])],
  render: () => (
    <ConnectorCredentialsCard
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      requiredSecrets={S3_SECRETS}
      canManage
    />
  ),
}

/**
 * Not a steward: the card returns `null` rather than an empty or disabled
 * frame, so there is no credential surface at all for a caller who cannot
 * manage one. The silence is the contract, named here so a reader sees it
 * exercised.
 */
export const NotASteward: Story = {
  decorators: [provider([{ key: secretsKey, value: [] }])],
  render: () => (
    <ConnectorCredentialsCard
      workspaceId={WORKSPACE_ID}
      connectorId={CONNECTOR_ID}
      requiredSecrets={S3_SECRETS}
      canManage={false}
    />
  ),
}
