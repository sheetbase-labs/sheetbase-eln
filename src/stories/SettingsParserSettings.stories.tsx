import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ParserSettings } from '#/components/v3/settings/parser-settings'
import { instrumentQueryKeys } from '#/components/v3/instruments/instruments-data'
import type { InstrumentRow } from '#/components/v3/instruments/instruments-data'
import { parserSettingsQueryKeys } from '#/lib/parser-settings'
import type { ParserSettingsRow, ParserTestFile } from '#/lib/parser-settings'
import { holdRead, screenQueryClient, withApiReads } from './screen-stories'
import type { FailedRead, ReadSeed } from './screen-stories'

/**
 * Instruments and parsers (`src/routes/settings/instruments.tsx`): the
 * workspace's canonical parser versions, the retained-file validation that
 * approves one, and the draft form.
 *
 * The screen reads three things — the parser catalogue, the retained test files
 * and the instrument list — and writes only through the actions, none of which
 * a story presses. `role` is not a read: it is the capability the screen gates
 * its buttons on (see `#/lib/capability`), which is how the restricted story
 * differs from the steward ones.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-0000000000w1'

const DRAFT_VERSION_ID = 'version-tb02-4'
const APPROVED_VERSION_ID = 'version-tb02-3'
const VALIDATED_VERSION_ID = 'version-plate-1'

const TB02_FILE_ID = 'file-tb02-export'
const FAILED_FILE_ID = 'file-plate-0319'

const parsers: ParserSettingsRow[] = [
  {
    id: 'parser-tb02',
    key: 'tb02',
    name: 'TB-02 CSV firmware 4',
    format: 'csv',
    instrument_id: 'instrument-tb02',
    instruments: { id: 'instrument-tb02', name: 'Turbidimeter TB-02' },
    parser_versions: [
      {
        id: DRAFT_VERSION_ID,
        version: 4,
        status: 'draft',
        signature: { requiredHeaders: ['well', 'od600'] },
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
      {
        id: APPROVED_VERSION_ID,
        version: 3,
        status: 'approved',
        signature: { requiredHeaders: ['well', 'od600'] },
        mapping: { od600: 'a600' },
        test_result: {
          ok: true,
          rowCount: 96,
          errors: [],
          sample: [['A1', 0.412]],
        },
        validated_at: '2026-09-25T11:05:00.000Z',
        approved_at: '2026-09-25T11:15:00.000Z',
        approved_by_user_id: 'qa-reviewer',
      },
    ],
  },
  {
    id: 'parser-plate',
    key: 'plate-reading',
    name: 'Plate reader CSV',
    format: 'csv',
    instrument_id: null,
    instruments: null,
    parser_versions: [
      {
        id: VALIDATED_VERSION_ID,
        version: 1,
        status: 'validated',
        signature: { requiredHeaders: ['well'] },
        mapping: {},
        test_result: { ok: true, rowCount: 384, errors: [] },
        validated_at: '2026-10-12T08:20:00.000Z',
        approved_at: null,
        approved_by_user_id: null,
      },
    ],
  },
]

/** A workspace with a parser that has never had a version created for it. */
const parsersWithoutVersions: ParserSettingsRow[] = [
  { ...parsers[0], parser_versions: [] },
]

const files: ParserTestFile[] = [
  {
    id: TB02_FILE_ID,
    filename: 'tb02-firmware-4-export.csv',
    checksum:
      'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
    parser_failure: null,
  },
  {
    id: FAILED_FILE_ID,
    filename: 'plate-0319.csv',
    checksum:
      'ff00ee11dd22cc33bb44aa5599668877aabbccddeeff00112233445566778899',
    parser_failure: {
      message: 'Column “od600” is missing from the header row.',
      requestedAt: '2026-10-15T09:30:00.000Z',
    },
  },
  {
    id: 'file-readings',
    filename: 'readings.csv',
    checksum:
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    parser_failure: null,
  },
]

const instruments: InstrumentRow[] = [
  {
    id: 'instrument-tb02',
    displayId: 'INST-2026-0003',
    name: 'Turbidimeter TB-02',
    instrumentType: 'turbidimeter',
    model: 'TB-02',
    serialNumber: 'TB02-9931',
    vendor: 'Vendor',
    location: 'Bench 2',
    ownerId: 'user-1',
    retiredAt: null,
    intakeMethod: 'automated',
    position: 1,
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
]

const meta = {
  title: 'Settings/Instruments and parsers',
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

const fileKey = (fileId?: string) => [
  ...parserSettingsQueryKeys.files(WORKSPACE_ID),
  fileId,
]

/**
 * A story's read client. `useInstruments` carries a 15s `staleTime` of its own,
 * which outranks the harness's client-level `Infinity`, so its seed is stamped
 * an hour ahead — the static snapshot is then the only answer that read can
 * give while the story is open.
 */
function provider(data: ReadSeed[], failed: FailedRead[] = []) {
  const client = screenQueryClient({ data })
  for (const read of failed) holdRead(client, read.key, read.kind, read.message)
  client.setQueryData(instrumentQueryKeys.list, instruments, {
    updatedAt: Date.now() + 60 * 60 * 1000,
  })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const catalogue: ReadSeed = {
  key: parserSettingsQueryKeys.list(WORKSPACE_ID),
  value: parsers,
}

/**
 * A new draft, selected: it has been created but never tested, so the version
 * list shows its status and the section below it offers the retained-file
 * validation. Approve is unavailable until that validation has run and passed,
 * and the draft form at the foot is where a version starts.
 */
export const DraftVersion: Story = {
  decorators: [
    provider([catalogue, { key: fileKey(TB02_FILE_ID), value: files }]),
  ],
  render: () => (
    <ParserSettings
      workspaceId={WORKSPACE_ID}
      role="owner"
      versionId={DRAFT_VERSION_ID}
      fileId={TB02_FILE_ID}
    />
  ),
}

/**
 * An approved version: the validation it passed, its evidence, and the QA
 * approval it carries. Neither action can change it — an approved definition is
 * not edited in place — so both buttons are unavailable.
 */
export const ApprovedVersion: Story = {
  decorators: [
    provider([catalogue, { key: fileKey(TB02_FILE_ID), value: files }]),
  ],
  render: () => (
    <ParserSettings
      workspaceId={WORKSPACE_ID}
      role="owner"
      versionId={APPROVED_VERSION_ID}
      fileId={TB02_FILE_ID}
    />
  ),
}

/**
 * A retained file the parser refused: the screen reports it on the file's own
 * row, with the admin update the refusal asked for. This version is validated,
 * so both Validate and Approve are available — the point being that approving
 * this version is a decision, not something the screen blocks.
 */
export const RetainedFileRefused: Story = {
  decorators: [
    provider([catalogue, { key: fileKey(FAILED_FILE_ID), value: files }]),
  ],
  render: () => (
    <ParserSettings
      workspaceId={WORKSPACE_ID}
      role="owner"
      versionId={VALIDATED_VERSION_ID}
      fileId={FAILED_FILE_ID}
    />
  ),
}

/**
 * No parser version has been created in this workspace: the list says so and
 * the draft form is the next step.
 */
export const NoVersionsYet: Story = {
  decorators: [
    provider([
      {
        key: parserSettingsQueryKeys.list(WORKSPACE_ID),
        value: parsersWithoutVersions,
      },
      { key: fileKey(), value: files },
    ]),
  ],
  render: () => <ParserSettings workspaceId={WORKSPACE_ID} role="owner" />,
}

/**
 * The screen was handed no workspace, so neither read is enabled and neither
 * runs — which is also the only reachable way to see what this screen does
 * *before* its catalogue answers. It states the empty case rather than a loading
 * one, and offers no draft form, because `isSuccess` is what gates the form.
 */
export const NoActiveWorkspace: Story = {
  decorators: [provider([])],
  render: () => <ParserSettings workspaceId="" role="owner" />,
}

/**
 * The catalogue read was refused: the screen states the message and offers no
 * draft form — it will not offer an action whose write the same refusal would
 * reject. The versions list renders empty rather than wrong.
 */
export const ReadRefused: Story = {
  decorators: [
    provider(
      [],
      [
        { key: parserSettingsQueryKeys.list(WORKSPACE_ID), kind: 'denied' },
        { key: fileKey(), kind: 'denied' },
      ],
    ),
  ],
  render: () => <ParserSettings workspaceId={WORKSPACE_ID} role="owner" />,
}

/**
 * A member without the governed-schema capabilities (`schema.edit`,
 * `schema.publish`): the catalogue and its versions are readable, and every
 * action that would change them is absent rather than disabled. This is the
 * screen's restricted state, and it is decided by the role, not by the read.
 */
export const WithoutSchemaAuthority: Story = {
  decorators: [
    provider([catalogue, { key: fileKey(TB02_FILE_ID), value: files }]),
  ],
  render: () => (
    <ParserSettings
      workspaceId={WORKSPACE_ID}
      role="scientist"
      versionId={DRAFT_VERSION_ID}
      fileId={TB02_FILE_ID}
    />
  ),
}
