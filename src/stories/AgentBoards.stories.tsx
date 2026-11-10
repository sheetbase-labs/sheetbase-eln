import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  RiskGlyph,
  linkifyIdentifiers,
} from '#/components/pipelines/agents/board-parts'
import { AgentPoliciesBoard } from '#/components/pipelines/agents/policies-board'
import { AgentWorkflowsBoard } from '#/components/pipelines/agents/workflows-board'
import type {
  AgentDefinition,
  AgentPolicyRevision,
  AgentRun,
} from '#/lib/agent-registry'
import { screenRoutes } from './screen-stories'

/**
 * The Agents boards (`src/components/pipelines/agents/`).
 *
 * The workflows board lists each automation with what starts it and how its
 * last run went; the policies board shows what each may do on its own with the
 * numbered revisions of that policy beside it; `board-parts.tsx` holds the risk
 * glyph and the identifier linking both share. All three are prop-driven, so
 * these stories are their real inputs with no read behind them.
 */
const meta = {
  title: 'Pipelines/Agent boards',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/agents', ['/pipelines/agents/']),
        path: '/pipelines/agents',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex h-[560px] w-[1080px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const NOW = new Date('2026-10-14T10:00:00.000Z')

const policy = {
  read: 'allowed',
  notebook_blocks: 'needs_approval',
  dataset_flags: 'needs_approval',
  create_records: 'needs_signature',
  messages: 'allowed',
} as const

function definition(
  overrides: Partial<AgentDefinition> & Pick<AgentDefinition, 'id' | 'name'>,
): AgentDefinition {
  return {
    workspace_id: 'ws-1',
    display_id: 'AGT-0001',
    kind: 'ai',
    description: 'Reads new plate-reader uploads and flags wells that drift.',
    trigger_label: 'On dataset upload',
    project_ids: [],
    owner_user_id: 'u-1',
    model_label: 'Claude',
    reads: ['Datasets', 'Samples'],
    proposes: 'Dataset flags',
    enabled: true,
    policy: { ...policy },
    updated_at: '2026-10-10T09:00:00.000Z',
    ...overrides,
  }
}

const definitions: AgentDefinition[] = [
  definition({ id: 'ag-1', display_id: 'AGT-0001', name: 'Plate drift check' }),
  definition({
    id: 'ag-2',
    display_id: 'AGT-0002',
    name: 'Weekly stability digest',
    kind: 'rule',
    description: 'Posts a summary of stability pulls due this week.',
    trigger_label: 'Mon 08:00',
    project_ids: ['p-1'],
    model_label: null,
    reads: ['Samples'],
    proposes: 'Messages',
  }),
  definition({
    id: 'ag-3',
    display_id: 'AGT-0003',
    name: 'Notebook reviewer',
    description: 'Reads a notebook when someone asks and suggests edits.',
    trigger_label: 'When asked in a notebook',
    enabled: false,
    proposes: 'Notebook blocks',
  }),
]

const runs: AgentRun[] = [
  {
    id: 'r-1',
    definition_id: 'ag-1',
    run_number: 41,
    outcome: 'proposed',
    summary: 'Flagged 3 wells on DS-0012',
    detail: 'Proposed 3 dataset flags on DS-0012.',
    proposal_id: null,
    started_at: '2026-10-14T08:30:00.000Z',
  },
  {
    id: 'r-2',
    definition_id: 'ag-2',
    run_number: 12,
    outcome: 'sent',
    summary: 'Sent the digest',
    detail: 'Posted 6 pulls due to the stability channel.',
    proposal_id: null,
    started_at: '2026-10-13T08:00:00.000Z',
  },
  {
    id: 'r-3',
    definition_id: 'ag-1',
    run_number: 40,
    outcome: 'no_change',
    summary: 'Nothing to flag',
    detail: 'Read DS-0011 and found no drift.',
    proposal_id: null,
    started_at: '2026-10-12T15:10:00.000Z',
  },
]

const revisions: AgentPolicyRevision[] = [
  {
    id: 'rev-2',
    revision: 2,
    summary: 'Creating records now needs an e-signature',
    change_ref: 'CHG-0007',
    reason: 'Aligning with the SOP review.',
    changed_by_user_id: 'u-1',
    changed_at: '2026-10-09T11:00:00.000Z',
  },
  {
    id: 'rev-1',
    revision: 1,
    summary: 'Initial policy',
    change_ref: null,
    reason: 'First configuration.',
    changed_by_user_id: 'u-2',
    changed_at: '2026-09-30T09:00:00.000Z',
  },
]

const nameOf = (id: string | null) =>
  id === 'u-1' ? 'Priya Raman' : id === 'u-2' ? 'Tom Okafor' : null

const projectName = (id: string) => (id === 'p-1' ? 'Stability' : id)

/** The risk glyph at each level, with and without its label. */
export const Risk: Story = {
  parameters: { layout: 'centered' },
  decorators: [],
  render: () => (
    <div className="flex flex-col gap-2">
      <RiskGlyph risk="high" />
      <RiskGlyph risk="medium" />
      <RiskGlyph risk="low" />
      <RiskGlyph risk="low" label={false} />
    </div>
  ),
}

/** Record identifiers in a sentence become links to those records. */
export const LinkedIdentifiers: Story = {
  parameters: { layout: 'centered' },
  decorators: [],
  render: () => (
    <p className="max-w-md text-body">
      {linkifyIdentifiers(
        'Flagged 3 wells on DS-0012 after EXP-0044 changed the plate layout; see PRT-0007.',
      )}
    </p>
  ),
}

/** Workflows with the first selected: its reads, proposals and recent runs. */
export const Workflows: Story = {
  render: () => (
    <AgentWorkflowsBoard
      definitions={definitions}
      runs={runs}
      proposals={[]}
      selectedId="ag-1"
      onSelect={() => {}}
      onToggle={() => {}}
      canToggle={() => true}
      me={{ userId: 'u-1', canApprove: true }}
      nameOf={nameOf}
      projectName={projectName}
      now={NOW}
      pending={false}
    />
  ),
}

/** A reader who cannot switch workflows on or off sees the same list. */
export const WorkflowsReadOnly: Story = {
  render: () => (
    <AgentWorkflowsBoard
      definitions={definitions}
      runs={runs}
      proposals={[]}
      selectedId="ag-3"
      onSelect={() => {}}
      onToggle={() => {}}
      canToggle={() => false}
      me={{ userId: null, canApprove: false }}
      nameOf={nameOf}
      projectName={projectName}
      now={NOW}
      pending={false}
      error="The workspace connection failed."
    />
  ),
}

export const WorkflowsEmpty: Story = {
  render: () => (
    <AgentWorkflowsBoard
      definitions={[]}
      runs={[]}
      proposals={[]}
      selectedId={null}
      onSelect={() => {}}
      onToggle={() => {}}
      canToggle={() => false}
      me={{ userId: null, canApprove: false }}
      nameOf={nameOf}
      projectName={projectName}
      now={NOW}
      pending={false}
    />
  ),
}

/** What each workflow may do, with the policy revisions beside it. */
export const Policies: Story = {
  render: () => (
    <AgentPoliciesBoard
      definitions={definitions}
      revisions={revisions}
      canChange
      onChange={async () => revisions[0]}
      nameOf={nameOf}
      projectName={projectName}
      pending={false}
    />
  ),
}

/** Opened straight onto the change dialog, as "Edit policy" does. */
export const PolicyChangeDialog: Story = {
  render: () => (
    <AgentPoliciesBoard
      definitions={definitions}
      revisions={revisions}
      initialDefinitionId="ag-1"
      canChange
      onChange={async () => revisions[0]}
      nameOf={nameOf}
      projectName={projectName}
      pending={false}
    />
  ),
}

export const PoliciesReadOnly: Story = {
  render: () => (
    <AgentPoliciesBoard
      definitions={definitions}
      revisions={[]}
      canChange={false}
      onChange={async () => revisions[0]}
      nameOf={nameOf}
      projectName={projectName}
      pending={false}
    />
  ),
}

export const PoliciesEmpty: Story = {
  render: () => (
    <AgentPoliciesBoard
      definitions={[]}
      revisions={[]}
      canChange={false}
      onChange={async () => revisions[0]}
      nameOf={nameOf}
      projectName={projectName}
      pending={false}
    />
  ),
}
