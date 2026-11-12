import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ConvertDialog } from '#/components/pipelines/convert-dialog'
import { DuplicateDialog } from '#/components/pipelines/history/duplicate-dialog'
import { HistoryTable } from '#/components/pipelines/history/history-table'
import { ReadOnlyVersion } from '#/components/pipelines/history/read-only-version'
import { HistorySection } from '#/components/pipelines/history/history-section'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import { ActionMenu } from '#/components/pipelines/simple/action-menu'
import { DryRunPanel } from '#/components/pipelines/simple/dry-run-panel'
import { HowItRuns } from '#/components/pipelines/simple/how-it-runs'
import { LastRuns } from '#/components/pipelines/simple/last-runs'
import { RecipeEditor } from '#/components/pipelines/simple/recipe-editor'
import { SimpleEditor } from '#/components/pipelines/simple/simple-editor'
import { TemplateDialog } from '#/components/pipelines/simple/template-dialog'
import { TokenInput, TokenSelect } from '#/components/pipelines/simple/token'
import { simpleConfig } from '#/lib/pipelines/simple/compile'
import type { PipelineRecipe } from '#/lib/pipelines/simple/recipe'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * A Simple pipeline (`src/components/pipelines/simple/`).
 *
 * The recipe as a sentence (When, if, then), the menu of actions, a dry run of
 * the draft on the latest snapshot, how the pipeline starts and runs, Convert to
 * Standard, and the History and Duplicate that open any version in the mode it
 * was written in. Reads are seeded by query key; no story saves, converts or
 * duplicates anything.
 */
const meta = {
  title: 'Pipelines/Simple',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/$pipelineId/steps', [
          '/pipelines/$pipelineId/triggers',
          '/pipelines/$pipelineId/runs',
          '/pipelines/runs/$runId',
          '/pipelines',
        ]),
        path: '/pipelines/$pipelineId/steps',
        params: { pipelineId: 'pl-1' },
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

const DATASET = '11111111-1111-4111-8111-111111111111'
const PERSON = '33333333-3333-4333-8333-333333333333'

const recipe: PipelineRecipe = {
  when: { datasetId: DATASET },
  join: 'and',
  conditions: [{ column: 'turbidity', operator: 'above', value: 50 }],
  actions: [
    { kind: 'flag_rows', column: 'turbidity', fieldId: 'f-1' },
    {
      kind: 'ask',
      mode: 'confirm',
      userId: PERSON,
      hours: 24,
      noAnswer: 'reask',
    },
    { kind: 'inbox', mode: 'review', userId: PERSON, text: '' },
  ],
}

const wire = (
  id: string,
  version: number,
  lifecycle: PipelineDefinitionVersionWire['lifecycle'],
  configuration: PipelineDefinitionVersionWire['configuration'],
): PipelineDefinitionVersionWire => ({
  id,
  definition_id: 'pl-1',
  workspace_id: 'ws-1',
  version,
  lifecycle,
  configuration_format_version: 2,
  configuration,
  revision: 1,
  created_at: '2026-11-01T09:00:00.000Z',
  updated_at: '2026-11-01T09:00:00.000Z',
  created_by_user_id: 'u-1',
  published_at: lifecycle === 'published' ? '2026-11-02T09:30:00.000Z' : null,
  published_by_user_id: lifecycle === 'published' ? 'u-1' : null,
  retired_at: null,
  retired_by_user_id: null,
})

// SAFETY: a compiled recipe is plain JSON; the round trip only drops the contract's class types.
const stored: PipelineDefinitionVersionWire['configuration'] = JSON.parse(
  JSON.stringify(simpleConfig(recipe)),
)

const versions = [
  wire('v-3', 3, 'draft', stored),
  wire('v-2', 2, 'published', stored),
]

const client = screenQueryClient({
  data: [
    {
      key: pipelineDataQueryKeys.versions('pl-1'),
      value: versions,
    },
    { key: pipelineDataQueryKeys.schedules('pl-1'), value: [] },
    {
      key: ['ui-port', 'pipelines', 'member-names'],
      value: { [PERSON]: 'Mei L.', 'u-1': 'Gareth P.' },
    },
    {
      key: ['ui-port', 'pipelines', 'output-targets'],
      value: {
        datasets: [
          {
            id: DATASET,
            name: 'Turbidity',
            displayId: 'DS-0311',
            schemaVersionId: 'sv-1',
          },
        ],
        schemaVersions: [],
      },
    },
    {
      key: ['ui-port', 'pipelines', 'simple-columns', 'sv-1'],
      value: [
        { id: 'f-1', key: 'turbidity', label: 'Turbidity', type: 'decimal' },
      ],
    },
    {
      key: ['ui-port', 'pipelines', 'simple-instruments'],
      value: [{ id: 'i-1', name: 'Plate reader', display_id: 'INS-0001' }],
    },
    {
      key: ['ui-port', 'pipelines', 'simple-channels'],
      value: [],
    },
    {
      key: ['ui-port', 'pipelines', 'simple-snapshot', DATASET, ''],
      value: { id: 'dv-1', label: 'S-15', createdAt: '2026-11-12T10:12:00Z' },
    },
  ],
})

const withClient = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={client}>
    <Story />
  </QueryClientProvider>
)

/** The recipe sentence: every choice is a chip that opens a list. */
export const Recipe: Story = {
  decorators: [withClient],
  render: function Render() {
    const [value, setValue] = useState(recipe)

    return (
      <RecipeEditor
        recipe={value}
        onChange={setValue}
        onConvert={() => {}}
        pipelineLabel="PL-0011"
        ownerName="Gareth P."
      />
    )
  },
}

/** A version of the recipe that can no longer be changed. */
export const RecipeReadOnly: Story = {
  decorators: [withClient],
  render: () => (
    <RecipeEditor
      recipe={recipe}
      onChange={() => {}}
      onConvert={() => {}}
      pipelineLabel="v2"
      ownerName={null}
      readOnly
    />
  ),
}

/** The chips on their own: a list to choose from and a value to type. */
export const Tokens: Story = {
  render: function Render() {
    const [choice, setChoice] = useState('above')
    const [amount, setAmount] = useState('50')

    return (
      <span className="flex items-center gap-2">
        <TokenSelect
          label="Operator"
          value={choice}
          placeholder="an operator"
          options={[
            { value: 'above', label: 'is above' },
            { value: 'below', label: 'is below' },
          ]}
          onChange={setChoice}
        />
        <TokenInput
          label="Amount"
          type="number"
          value={amount}
          suffix="NTU"
          onChange={setAmount}
        />
      </span>
    )
  },
}

/** Everything Simple can do, and where it stops. */
export const Actions: Story = {
  decorators: [withClient],
  render: () => (
    <div className="w-[560px] rounded-lg border border-border bg-surface-raised">
      <ActionMenu
        context={{ column: 'turbidity', fieldIds: { turbidity: 'f-1' } }}
        hasKeep={false}
        onPick={() => {}}
        onConvert={() => {}}
      />
    </div>
  ),
}

/** How the pipeline starts and what a run does about the rest. */
export const HowItRunsCard: Story = {
  decorators: [withClient],
  render: () => (
    <HowItRuns
      pipelineId="pl-1"
      workspaceId="ws-1"
      recipe={recipe}
      datasetLabel="DS-0311 Turbidity"
      pipelineLink="/pipelines/pl-1/triggers"
      onChange={() => {}}
    />
  ),
}

/** The draft tried on the latest snapshot; nothing runs until Try again. */
export const DryRun: Story = {
  decorators: [withClient],
  render: () => (
    <div className="w-[300px]">
      <DryRunPanel
        workspaceId="ws-1"
        recipe={recipe}
        complete
        datasetLabel="DS-0311 Turbidity"
        people={{ [PERSON]: 'Mei L.' }}
        destinations={() => '#aav9-process'}
        datasetName={() => 'Step yield'}
      />
    </div>
  ),
}

export const RecentRuns: Story = {
  decorators: [withClient],
  render: () => <LastRuns pipelineId="pl-1" published={2} draft={3} />,
}

/** The whole Steps tab of a Simple pipeline. */
export const Editor: Story = {
  decorators: [withClient],
  parameters: { layout: 'fullscreen' },
  render: () => <SimpleEditor pipelineId="pl-1" workspaceId="ws-1" />,
}

export const Templates: Story = {
  decorators: [withClient],
  render: () => <TemplateDialog workspaceId="ws-1" />,
}

/** The one-way step from Simple to Standard, with the way out beside it. */
export const Convert: Story = {
  render: () => (
    <ConvertDialog
      open
      onOpenChange={() => {}}
      workspaceId="ws-1"
      pipelineId="pl-1"
      displayId="PL-0011"
      name="Turbidity check on import"
      draftVersion={3}
      publishedVersion={2}
      onDuplicate={() => {}}
      onConverted={() => {}}
    />
  ),
}

export const Duplicate: Story = {
  render: () => (
    <DuplicateDialog
      open
      onOpenChange={() => {}}
      workspaceId="ws-1"
      versionId="v-2"
      version={2}
      mode="Simple"
      displayId="PL-0011"
      name="Turbidity check on import"
    />
  ),
}

/** Every version, each in the mode it was written in. */
export const History: Story = {
  decorators: [withClient],
  render: () => (
    <HistoryTable
      versions={versions}
      names={{ 'u-1': 'Gareth P.' }}
      convertedVersion={new Set()}
      onOpen={() => {}}
      onDuplicate={() => {}}
    />
  ),
}

/** History as a section of the Activity tab. */
export const HistoryInActivity: Story = {
  decorators: [withClient],
  render: () => <HistorySection pipelineId="pl-1" workspaceId="ws-1" />,
}

export const OldVersion: Story = {
  decorators: [withClient],
  render: () => <ReadOnlyVersion version={versions[1]} />,
}
