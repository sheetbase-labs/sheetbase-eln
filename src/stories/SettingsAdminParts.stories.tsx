import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { instrumentQueryKeys } from '#/components/instruments/instruments-data'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { ApiExample } from '#/components/settings/api-example'
import {
  AuditIntegrityLine,
  CheckNowButton,
  RetentionDialog,
} from '#/components/settings/audit-retention'
import { BoxOccupancy } from '#/components/settings/box-occupancy'
import { DataAccessRoles } from '#/components/settings/data-access-roles'
import { InstrumentParserTable } from '#/components/settings/instrument-parser-table'
import { HandoverDialog } from '#/components/settings/handover-dialog'
import { JoinDomainsSection } from '#/components/settings/join-domains'
import { DirectorySyncSection } from '#/components/settings/directory-sync'
import { directorySyncKeys } from '#/lib/directory-sync'
import { SignInGroupsSection } from '#/components/settings/sign-in-groups'
import {
  SettingsPasskeys,
  passkeysQueryKey,
} from '#/components/settings/settings-passkeys'
import { MemberSessionsDialog } from '#/components/settings/member-sessions-dialog'
import { MemberUsernameDialog } from '#/components/settings/member-username-dialog'
import { ParserVersions } from '#/components/settings/parser-versions'
import { PhoneAlerts } from '#/components/settings/phone-alerts'
import { SettingsSampleData } from '#/components/settings/settings-sample-data'
import {
  SettingsTwoFactor,
  twoFactorQueryKey,
} from '#/components/settings/settings-two-factor'
import { SqlLogins } from '#/components/settings/sql-logins'
import { WorkspaceAdminsLine } from '#/components/settings/workspace-admins-line'
import { auditVerificationKeys } from '#/lib/audit-verification-status'
import { dataAccessKeys } from '#/lib/data-access'
import { groupRoleKeys } from '#/lib/group-roles'
import { handoverKeys } from '#/lib/handover'
import { joinDomainKeys } from '#/lib/join-domains'
import type { ParserSettingsRow } from '#/lib/parser-settings'
import { pushQueryKeys } from '#/lib/push-client'
import { sampleDataQueryKey } from '#/lib/sample-data'
import { sqlConnectionQueryKey } from '#/lib/sql-access'
import { positionKeys } from '#/lib/storage-positions'
import { adminQueryKeys } from '#/lib/workspace-admin'
import { workspaceAdminsKey } from '#/lib/workspace-admins'
import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
} from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Settings sections and dialogs (`src/components/settings/`).
 *
 * Each of these reads one thing and shows it, so each story seeds that read by
 * its query key with `staleTime: Infinity` and nothing reaches a database or
 * the network. The buttons that would write (rotate a login, turn on two-factor,
 * add the sample project) are shown at rest; none is pressed.
 */
const meta = {
  title: 'Settings/Sections and dialogs',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/settings/workspace', [
          '/instruments/$instrumentId',
          '/samples/$sampleId',
        ]),
        path: '/settings/workspace',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const WS = 'ws-1'

/** A story's cache: the seeds, stamped fresh for an hour past any hook staleTime. */
function provider(data: ReadSeed[]) {
  const client = screenQueryClient({ data })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

/** The token example: a curl request that works with any token. */
export const ApiTokenExample: Story = { render: () => <ApiExample /> }

const settings = {
  id: 's-1',
  workspaceId: WS,
  registrationMode: 'invite_only',
  reviewWorkflowEnabled: true,
  reviewWorkflowConfig: {},
  signaturePolicy: {},
  auditRetentionDays: 365 * 7,
  integrationSettings: {},
  instrumentGateMode: 'warn',
  regulatedLab: false,
  createdByUserId: 'u-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const auditSeeds: ReadSeed[] = [
  { key: adminQueryKeys.settings(WS), value: settings },
  {
    key: auditVerificationKeys.status,
    value: {
      ok: true,
      checkedAt: '2026-10-14T02:00:00.000Z',
      entriesChecked: 18240,
      signaturesChecked: 312,
      firstBadRevisionId: null,
    },
  },
]

/** The audit log's integrity line and the "check now" button. */
export const AuditIntegrity: Story = {
  decorators: [provider(auditSeeds)],
  render: () => (
    <div className="flex items-center gap-4 text-label text-fg-muted">
      <AuditIntegrityLine workspaceId={WS} />
      <CheckNowButton workspaceId={WS} />
    </div>
  ),
}

export const AuditRetention: Story = {
  decorators: [provider(auditSeeds)],
  render: () => (
    <RetentionDialog workspaceId={WS} canManage onClose={() => {}} />
  ),
}

export const AuditRetentionViewOnly: Story = {
  decorators: [provider(auditSeeds)],
  render: () => (
    <RetentionDialog workspaceId={WS} canManage={false} onClose={() => {}} />
  ),
}

const cells = Array.from({ length: 4 }, (_row, row) =>
  Array.from({ length: 6 }, (_col, col) => {
    const n = row * 6 + col

    return {
      id: `pos-${n}`,
      boxId: 'box-1',
      rowIndex: row,
      colIndex: col,
      label: `${'ABCD'[row]}${col + 1}`,
      status: n === 7 ? 'missing' : n === 8 ? 'set_aside' : 'available',
      occupant:
        n % 5 === 0
          ? { id: `smp-${n}`, identifier: `SMP-${1000 + n}`, title: 'Lysate' }
          : null,
    }
  }),
).flat()

/** A box as it is now: taken positions link to their sample. */
export const BoxPositions: Story = {
  decorators: [
    provider([
      { key: [...positionKeys.box('box-1'), 'settings'], value: cells },
    ]),
  ],
  render: () => (
    <BoxOccupancy
      boxId="box-1"
      name="Box 1"
      rows={4}
      cols={6}
      client={stubDataClient()}
    />
  ),
}

export const DataAccess: Story = {
  decorators: [
    provider([
      {
        key: dataAccessKeys.roles(WS),
        value: ['owner', 'admin', 'scientist'],
      },
    ]),
  ],
  render: () => <DataAccessRoles workspaceId={WS} canManage />,
}

export const DataAccessViewOnly: Story = {
  decorators: [
    provider([{ key: dataAccessKeys.roles(WS), value: ['owner', 'admin'] }]),
  ],
  render: () => <DataAccessRoles workspaceId={WS} canManage={false} />,
}

const instruments: InstrumentRow[] = [
  {
    id: 'inst-1',
    displayId: 'INST-2026-0003',
    name: 'Turbidimeter TB-02',
    instrumentType: 'turbidimeter',
    model: 'TB-02',
    serialNumber: 'TB02-9931',
    vendor: 'Vendor',
    location: 'Bench 2',
    ownerId: 'u-1',
    retiredAt: null,
    intakeMethod: 'automated',
    position: 1,
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'inst-2',
    displayId: 'INST-2026-0004',
    name: 'Plate reader PR-1',
    instrumentType: 'plate_reader',
    model: 'PR-1',
    serialNumber: null,
    vendor: null,
    location: 'Bench 4',
    ownerId: 'u-1',
    retiredAt: null,
    intakeMethod: 'manual',
    position: 2,
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
]

const parsers: ParserSettingsRow[] = [
  {
    id: 'parser-1',
    key: 'tb02',
    name: 'TB-02 CSV firmware 4',
    format: 'csv',
    instrument_id: 'inst-1',
    instruments: { id: 'inst-1', name: 'Turbidimeter TB-02' },
    parser_versions: [
      {
        id: 'pv-2',
        version: 2,
        status: 'draft',
        signature: {},
        mapping: {},
        test_result: null,
        validated_at: null,
        approved_at: null,
        approved_by_user_id: null,
      },
      {
        id: 'pv-1',
        version: 1,
        status: 'approved',
        signature: { requiredHeaders: ['well'] },
        mapping: {},
        test_result: { ok: true, rowCount: 96, errors: [] },
        validated_at: '2026-09-25T11:05:00.000Z',
        approved_at: '2026-09-25T11:15:00.000Z',
        approved_by_user_id: 'u-2',
      },
    ],
  },
]

function instrumentProvider() {
  const client = screenQueryClient({
    data: [
      {
        key: ['ui-port', 'instruments', 'last-import', 'all'],
        value: new Map(),
      },
      {
        key: ['ui-port', 'instruments', 'calibrations', 'all'],
        value: new Map(),
      },
      {
        key: ['ui-port', 'instruments', 'parsers', 'all'],
        value: new Map([['inst-1', true]]),
      },
    ],
  })

  client.setQueryData(instrumentQueryKeys.list, instruments, {
    updatedAt: Date.now() + 60 * 60 * 1000,
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

/** Each instrument in service with its parser, status and calibration. */
export const InstrumentsAndParsers: Story = {
  decorators: [instrumentProvider()],
  render: () => (
    <InstrumentParserTable
      parsers={parsers}
      selectedInstrumentId="inst-1"
      onSelect={() => {}}
    />
  ),
}

/** The parser versions as persisted, one row per version. */
export const ParserVersionList: Story = {
  render: () => (
    <ParserVersions
      parsers={parsers}
      selectedVersionId="pv-1"
      onSelect={() => {}}
    />
  ),
}

export const ParserVersionsNone: Story = {
  render: () => (
    <ParserVersions
      parsers={[{ ...parsers[0], parser_versions: [] }]}
      selectedVersionId={null}
      onSelect={() => {}}
    />
  ),
}

/** "Let colleagues join": the lab's email domains and the role they get. */
export const JoinDomains: Story = {
  decorators: [
    provider([
      {
        key: joinDomainKeys.list(WS),
        value: [{ domain: 'aavlabs.example', role: 'scientist' }],
      },
    ]),
  ],
  render: () => (
    <JoinDomainsSection
      workspaceId={WS}
      canManage
      ownEmail="priya@aavlabs.example"
    />
  ),
}

export const JoinDomainsSuggestion: Story = {
  decorators: [provider([{ key: joinDomainKeys.list(WS), value: [] }])],
  render: () => (
    <JoinDomainsSection
      workspaceId={WS}
      canManage
      ownEmail="priya@aavlabs.example"
    />
  ),
}

const session = (id: string, userId: string, ua: string) => ({
  id,
  userId,
  userName: userId === 'u-1' ? 'Priya Raman' : 'Tom Okafor',
  ipAddress: '82.14.31.7',
  userAgent: ua,
  createdAt: '2026-10-12T08:12:00.000Z',
  expiresAt: '2026-11-11T08:12:00.000Z',
})

export const MemberSessions: Story = {
  decorators: [
    provider([
      {
        key: adminQueryKeys.sessions(WS),
        value: [
          session(
            's-1',
            'u-1',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36',
          ),
          session(
            's-2',
            'u-1',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
          ),
        ],
      },
    ]),
  ],
  render: () => (
    <MemberSessionsDialog
      workspaceId={WS}
      userId="u-1"
      name="Priya Raman"
      onClose={() => {}}
    />
  ),
}

export const MemberSessionsNone: Story = {
  decorators: [provider([{ key: adminQueryKeys.sessions(WS), value: [] }])],
  render: () => (
    <MemberSessionsDialog
      workspaceId={WS}
      userId="u-1"
      name="Priya Raman"
      onClose={() => {}}
    />
  ),
}

export const MemberUsername: Story = {
  decorators: [provider([])],
  render: () => (
    <MemberUsernameDialog
      workspaceId={WS}
      userId="u-1"
      name="Priya Raman"
      current="praman"
      onClose={() => {}}
    />
  ),
}

/** Phone alerts: off, on, and the two states the browser can put it in. */
export const PhoneAlertsStates: Story = {
  decorators: [provider([{ key: pushQueryKeys.state(), value: 'off' }])],
  render: () => <PhoneAlerts />,
}

export const PhoneAlertsOn: Story = {
  decorators: [provider([{ key: pushQueryKeys.state(), value: 'on' }])],
  render: () => <PhoneAlerts />,
}

export const PhoneAlertsBlocked: Story = {
  decorators: [provider([{ key: pushQueryKeys.state(), value: 'blocked' }])],
  render: () => <PhoneAlerts />,
}

export const PhoneAlertsUnsupported: Story = {
  decorators: [
    provider([{ key: pushQueryKeys.state(), value: 'unsupported' }]),
  ],
  render: () => <PhoneAlerts />,
}

/** Sample data: offered before it is added, a line after. */
export const SampleData: Story = {
  decorators: [
    provider([
      {
        key: sampleDataQueryKey(WS),
        value: { loaded: false, projectKey: 'virus-stability' },
      },
    ]),
  ],
  render: () => <SettingsSampleData workspaceId={WS} />,
}

export const SampleDataLoaded: Story = {
  decorators: [
    provider([
      {
        key: sampleDataQueryKey(WS),
        value: { loaded: true, projectKey: 'virus-stability' },
      },
    ]),
  ],
  render: () => <SettingsSampleData workspaceId={WS} />,
}

/** Two-factor: off (enrol), and on (turn off). */
export const TwoFactorOff: Story = {
  decorators: [
    provider([
      {
        key: twoFactorQueryKey,
        value: {
          available: true,
          enabled: false,
          needsPassword: false,
          emailLinkEnabled: true,
        },
      },
    ]),
  ],
  render: () => <SettingsTwoFactor />,
}

export const TwoFactorOn: Story = {
  decorators: [
    provider([
      {
        key: twoFactorQueryKey,
        value: {
          available: true,
          enabled: true,
          needsPassword: true,
          emailLinkEnabled: true,
        },
      },
    ]),
  ],
  render: () => <SettingsTwoFactor />,
}

export const TwoFactorUnavailable: Story = {
  decorators: [
    provider([
      {
        key: twoFactorQueryKey,
        value: {
          available: false,
          enabled: false,
          needsPassword: false,
          emailLinkEnabled: false,
        },
      },
    ]),
  ],
  render: () => <SettingsTwoFactor />,
}

/** A member's read-only SQL logins, one of each status. */
export const SqlLoginList: Story = {
  decorators: [
    provider([
      { key: dataAccessKeys.ready(WS), value: true },
      {
        key: sqlConnectionQueryKey,
        value: {
          host: 'sql.aavlabs.example',
          port: 5432,
          database: 'sheetbase',
        },
      },
      {
        key: dataAccessKeys.logins(WS),
        value: [
          {
            id: 'l-1',
            name: 'Power BI',
            username: 'priya_powerbi',
            userId: 'u-1',
            createdAt: '2026-09-01T09:00:00.000Z',
            expiresAt: '2026-12-01T09:00:00.000Z',
            revokedAt: null,
            status: 'active',
          },
          {
            id: 'l-2',
            name: 'Old notebook',
            username: 'priya_old',
            userId: 'u-1',
            createdAt: '2026-01-01T09:00:00.000Z',
            expiresAt: '2026-04-01T09:00:00.000Z',
            revokedAt: null,
            status: 'expired',
          },
        ],
      },
    ]),
  ],
  render: () => <SqlLogins workspaceId={WS} />,
}

export const SqlLoginsNotReady: Story = {
  decorators: [
    provider([
      { key: dataAccessKeys.ready(WS), value: false },
      { key: sqlConnectionQueryKey, value: null },
    ]),
  ],
  render: () => <SqlLogins workspaceId={WS} />,
}

/** "Workspace admins: …", for the lock states that say to ask one. */
export const AdminsLine: Story = {
  decorators: [
    provider([
      {
        key: workspaceAdminsKey(WS),
        value: [{ name: 'Olive Owner' }, { name: 'Sam Admin' }],
      },
    ]),
  ],
  render: () => <WorkspaceAdminsLine workspaceId={WS} className="text-body" />,
}

/** "Sign-in groups": which identity-provider group gives which role. */
export const SignInGroups: Story = {
  decorators: [
    provider([
      {
        key: groupRoleKeys.all(WS),
        value: [
          { id: 'g-1', groupName: 'lab-admins', role: 'admin' },
          { id: 'g-2', groupName: 'lab-scientists', role: 'scientist' },
          { id: 'g-3', groupName: 'lab-guests', role: 'viewer' },
        ],
      },
    ]),
  ],
  render: () => <SignInGroupsSection workspaceId={WS} canManage />,
}

/** "Directory sync": the tokens an identity provider uses to manage people. */
export const DirectorySync: Story = {
  decorators: [
    provider([
      {
        key: directorySyncKeys.tokens(WS),
        value: [
          {
            id: 't-1',
            label: 'Okta',
            createdAt: '2026-10-01T09:00:00Z',
            lastUsedAt: '2026-11-05T08:30:00Z',
          },
          {
            id: 't-2',
            label: 'Entra test',
            createdAt: '2026-10-20T14:00:00Z',
            lastUsedAt: null,
          },
        ],
      },
      {
        key: directorySyncKeys.status(WS),
        value: {
          activeTokens: 2,
          lastCalledAt: '2026-11-05T08:30:00Z',
          peopleManaged: 14,
          peopleSwitchedOff: 2,
          groups: 5,
          groupsGivingARole: 3,
        },
      },
    ]),
  ],
  render: () => <DirectorySyncSection workspaceId={WS} canManage />,
}

/** Passkeys on the profile page: one synced, one kept on a single device. */
export const Passkeys: Story = {
  decorators: [
    provider([
      {
        key: passkeysQueryKey,
        value: [
          {
            id: 'pk-1',
            name: 'Work laptop',
            backedUp: true,
            createdAt: '2026-11-01T09:00:00Z',
          },
          {
            id: 'pk-2',
            name: 'Security key',
            backedUp: false,
            createdAt: '2026-11-03T14:30:00Z',
          },
        ],
      },
    ]),
  ],
  render: () => <SettingsPasskeys />,
}

/** Handing a leaver's open work to a colleague. */
export const HandOverWork: Story = {
  decorators: [
    provider([
      {
        key: handoverKeys.preview(WS, 'u-2'),
        value: [
          {
            key: 'record:experiment',
            label: 'Assigned: experiments',
            count: 3,
          },
          { key: 'task', label: 'Open tasks', count: 5 },
          { key: 'review', label: 'Reviews waiting on them', count: 1 },
        ],
      },
    ]),
  ],
  render: () => (
    <HandoverDialog
      workspaceId={WS}
      userId="u-2"
      name="Tom Okafor"
      candidates={[{ id: 'u-1', label: 'Priya Raman' }]}
      onClose={() => undefined}
    />
  ),
}
