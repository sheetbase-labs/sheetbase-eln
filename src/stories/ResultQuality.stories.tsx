import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { IncidentLog } from '#/components/incidents/incident-log'
import { ModelQualityDialog } from '#/components/results/model-quality-dialog'
import { SpecVerdictBadge } from '#/components/results/spec-verdict'
import { RetentionPanel } from '#/components/settings/retention-panel'
import { recordModelQueryKeys } from '#/components/models/models-data'
import { qualityKeys } from '#/lib/result-quality'
import type {
  DueRecord,
  FieldLimits,
  IncidentEntry,
  IncidentModel,
  LegalHold,
  RetentionRule,
} from '#/lib/result-quality'
import { workspaceGeneralQueryKey } from '#/lib/workspace-general'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { cellBankModel, modelField } from './model-fixtures'

/**
 * Result quality: the verdict badge, the Quality dialog on a model, the
 * Incidents page and Settings > Retention and holds. Every read is seeded, so
 * nothing is fetched.
 */
const meta = {
  title: 'Quality/Screens',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/incidents', [
          '/models/$modelId/records/$recordId',
          '/models/$modelId/records/new',
        ]),
        path: '/incidents',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const incidentModels: IncidentModel[] = [
  { key: 'incident', name: 'Incident', identifier_prefix: 'INC' },
]

const incident = (
  id: string,
  identifier: string,
  title: string,
  fields: IncidentEntry['custom_fields'],
): IncidentEntry => ({
  id,
  identifier,
  title,
  kind: 'incident',
  status: 'draft',
  custom_fields: fields,
  created_at: '2026-11-02T09:00:00.000Z',
  archived_at: null,
})

const incidents = [
  incident('i1', 'INC-0001', '-80 °C freezer door left ajar', {
    kind: 'deviation',
    severity: 'major',
    stage: 'investigating',
  }),
  incident('i2', 'INC-0002', 'Pipette calibration overdue at time of use', {
    kind: 'incident',
    severity: 'minor',
    stage: 'action_due',
  }),
]

const incidentClient = screenQueryClient({
  data: [
    { key: qualityKeys.incidentModels, value: incidentModels },
    { key: qualityKeys.incidents(['incident']), value: incidents },
  ],
})

const noLogClient = screenQueryClient({
  data: [{ key: qualityKeys.incidentModels, value: [] }],
})

/** Every model ticked as an incident log, listed together. */
export const Incidents: Story = {
  render: () => (
    <QueryClientProvider client={incidentClient}>
      <div className="flex h-[420px] w-[1000px] max-w-full flex-col">
        <IncidentLog canWrite canEditModels />
      </div>
    </QueryClientProvider>
  ),
}

/** No log yet: an administrator can start from the ready-made Incident model. */
export const IncidentsEmpty: Story = {
  render: () => (
    <QueryClientProvider client={noLogClient}>
      <div className="flex h-[360px] w-[1000px] max-w-full flex-col">
        <IncidentLog canWrite canEditModels />
      </div>
    </QueryClientProvider>
  ),
}

/** The three verdicts a result can have. */
export const Verdicts: Story = {
  parameters: { layout: 'centered' },
  render: () => (
    <div className="flex flex-col gap-2">
      <SpecVerdictBadge verdict="pass" />
      <SpecVerdictBadge verdict="alert" />
      <SpecVerdictBadge verdict="fail" />
      <SpecVerdictBadge verdict="fail" short />
    </div>
  ),
}

const limits: FieldLimits[] = [
  {
    fieldName: 'purity',
    lowerLimit: 90,
    upperLimit: 100,
    alertLower: 95,
    alertUpper: null,
    note: null,
  },
]

const dialogClient = (specLimits: boolean) =>
  screenQueryClient({
    data: [
      {
        key: [...recordModelQueryKeys.fields('cell_bank'), 'current'],
        value: [
          modelField('cell_bank', 'purity', 'Purity (%)', {
            logicalType: 'decimal',
          }),
          modelField('cell_bank', 'titre', 'Titre', {
            logicalType: 'integer',
          }),
          modelField('cell_bank', 'operator', 'Operator'),
        ],
      },
      { key: qualityKeys.limits('cell_bank'), value: limits },
      { key: qualityKeys.incidentModels, value: [] },
      {
        key: workspaceGeneralQueryKey,
        value: { specLimitsEnabled: specLimits },
      },
    ],
  })

const withLimits = dialogClient(true)
const withoutLimits = dialogClient(false)

/** Limits for each number field of a model, and the incident log tick. */
export const QualityDialog: Story = {
  render: () => (
    <QueryClientProvider client={withLimits}>
      <ModelQualityDialog
        open
        onOpenChange={() => {}}
        model={cellBankModel}
        specLimitsOn
      />
    </QueryClientProvider>
  ),
}

/** With result limits off for the lab, the dialog says where to turn them on. */
export const QualityDialogLimitsOff: Story = {
  render: () => (
    <QueryClientProvider client={withoutLimits}>
      <ModelQualityDialog
        open
        onOpenChange={() => {}}
        model={cellBankModel}
        specLimitsOn={false}
      />
    </QueryClientProvider>
  ),
}

const rules: RetentionRule[] = [
  { id: 'r1', kind: 'incident', keep_months: 24, note: 'Quality procedure' },
]

const due: DueRecord[] = [
  {
    record_id: 'i2',
    identifier: 'INC-0002',
    title: 'Pipette calibration overdue at time of use',
    kind: 'incident',
    last_changed: '2024-05-05T09:00:00.000Z',
    keep_months: 24,
    due_since: '2026-05-05T09:00:00.000Z',
  },
]

const holds: LegalHold[] = [
  {
    id: 'h1',
    name: 'Supplier dispute, AAV9 lots',
    reason: 'Needed for the supplier claim.',
    project_id: 'p1',
    kind: 'release_assay',
    created_at: '2026-11-05T09:00:00.000Z',
    released_at: null,
    release_note: null,
  },
]

const retentionClient = screenQueryClient({
  data: [
    { key: workspaceGeneralQueryKey, value: { retentionEnabled: true } },
    {
      key: ['quality', 'models'],
      value: [
        { key: 'incident', name: 'Incident' },
        { key: 'release_assay', name: 'Release assay' },
      ],
    },
    {
      key: ['quality', 'projects'],
      value: [{ id: 'p1', title: 'AAV9 process transfer' }],
    },
    { key: qualityKeys.rules, value: rules },
    { key: qualityKeys.due, value: due },
    { key: qualityKeys.holds, value: holds },
    { key: qualityKeys.holdCounts, value: new Map([['h1', 5]]) },
  ],
})

/** Keep times per model, what is due for archiving, and the legal holds. */
export const Retention: Story = {
  render: () => (
    <QueryClientProvider client={retentionClient}>
      <div className="w-[1000px] max-w-full">
        <RetentionPanel workspaceId="ws-1" canManage />
      </div>
    </QueryClientProvider>
  ),
}
