import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ProposalCard } from '#/components/assist/chat/proposal-card'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * A change the assistant suggests, as a card in the chat. Nothing has been
 * written: Apply runs the ordinary propose, approve and execute steps as the
 * signed-in person, so the version check and audit trail are the same as any
 * other change. A story never reaches the server, so pressing Apply here shows
 * the card's failed state.
 */
const PROPOSAL: AssistantProposal = {
  // The tool that proposes a pipeline draft, as the assistant declares it.
  tool: 'sheetbase.pipeline_definition.draft',
  title: 'Add a nightly titre export',
  summary: 'Creates a pipeline that exports titre results to the shared drive.',
  target: 'Pipelines',
  deepLink: '/pipelines',
  changes: [
    { label: 'Name', before: null, after: 'Nightly titre export' },
    {
      label: 'Schedule',
      before: 'Manual',
      after: 'Every night at 02:00',
    },
  ],
  operation: {
    kind: 'pipeline_definition.create',
    workspaceId: '0198d970-e266-4000-8000-0000000000a1',
    key: 'nightly-titre-export',
    name: 'Nightly titre export',
  },
}

const client = screenQueryClient()

const meta = {
  title: 'Assistant/Proposal card',
  component: ProposalCard,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/', ['/pipelines/agents']),
        path: '/',
      },
    },
  },
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="w-[420px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    callId: 'story-call-1',
    workspaceId: '0198d970-e266-4000-8000-0000000000a1',
    proposal: PROPOSAL,
  },
} satisfies Meta<typeof ProposalCard>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A change to something that exists shows what it replaces, struck through. */
export const NewRecordOnly: Story = {
  args: {
    callId: 'story-call-2',
    proposal: {
      ...PROPOSAL,
      changes: [{ label: 'Name', before: null, after: 'Nightly titre export' }],
    },
  },
}

const labCard = (
  proposal: Pick<
    AssistantProposal,
    'tool' | 'title' | 'summary' | 'target' | 'changes' | 'action'
  >,
): AssistantProposal => ({ ...proposal, deepLink: '/stocktake' })

/** Finishing a count says what the unscanned items will become before anyone presses. */
export const FinishStocktake: Story = {
  args: {
    callId: 'story-lab-1',
    proposal: labCard({
      tool: 'sheetbase.stocktake.complete',
      title: 'Finish the count of Freezer 2 / Rack B',
      summary: 'Closes ST-0007. Items nobody scanned are recorded as missing.',
      target: 'ST-0007 · Rack B',
      changes: [
        { label: 'Status', before: 'Open', after: 'Completed' },
        { label: 'Found where expected', before: null, after: '41' },
        {
          label: 'Not scanned, recorded as missing',
          before: null,
          after: '3',
        },
      ],
      action: { kind: 'stocktake.complete', stocktakeId: 'c1' },
    }),
  },
}

/** Archiving past retention lists what is due, so nothing is archived blind. */
export const ApplyRetention: Story = {
  args: {
    callId: 'story-lab-2',
    proposal: labCard({
      tool: 'sheetbase.retention.apply',
      title: 'Archive experiments past their retention time',
      summary: 'Records on a legal hold are skipped.',
      target: 'Experiment',
      changes: [
        { label: 'Archive', before: null, after: '12 records' },
        {
          label: 'For example',
          before: null,
          after: 'EXP-0004 · Titre run 4\nEXP-0009 · ELISA plate 2',
        },
      ],
      action: { kind: 'retention.apply', recordKind: 'experiment' },
    }),
  },
}

/** Pooling shows each source's remaining volume and what the pool will hold. */
export const PoolSamples: Story = {
  args: {
    callId: 'story-lab-3',
    proposal: labCard({
      tool: 'sheetbase.sample.pool',
      title: 'Pool three plasma aliquots for EXP-0021',
      summary: 'Takes volume from each and makes one pooled sample.',
      target: '3 samples',
      changes: [
        {
          label: 'S-0142 · Plasma 142',
          before: '200 µl',
          after: 'Take 50 µl',
        },
        {
          label: 'S-0143 · Plasma 143',
          before: '180 µl',
          after: 'Take 50 µl',
        },
        {
          label: 'S-0150 · Plasma 150',
          before: '90 µl',
          after: 'Take 40 µl',
        },
        {
          label: 'New pooled sample',
          before: null,
          after: '140 µl for EXP-0021',
        },
      ],
      action: {
        kind: 'sample.pool',
        sources: [],
        experimentId: 'e1',
        unit: 'µl',
        notes: null,
        poolName: null,
        storageLocation: null,
      },
    }),
  },
}

/** Booking rules show only what changes, old value struck through. */
export const SetBookingRules: Story = {
  args: {
    callId: 'story-lab-4',
    proposal: labCard({
      tool: 'sheetbase.booking_rules.set',
      title: 'Limit the plate reader to two hours',
      summary: 'Sets the longest single booking and the training needed.',
      target: 'INS-0003 · Plate reader',
      changes: [
        { label: 'Longest booking', before: '4 hours', after: '2 hours' },
        {
          label: 'Training required',
          before: 'None',
          after: 'SOP-0012 · Plate reader basics',
        },
      ],
      action: {
        kind: 'booking_rules.set',
        instrumentId: 'i1',
        protocolIds: [],
        maxBookingMinutes: 120,
        maxAdvanceDays: null,
      },
    }),
  },
}

/** A legal hold names what it covers and why. */
export const PlaceLegalHold: Story = {
  args: {
    callId: 'story-lab-5',
    proposal: labCard({
      tool: 'sheetbase.legal_hold.create',
      title: 'Hold everything in Vaccine B for the audit',
      summary: 'Stops the project’s records being archived or deleted.',
      target: 'Vaccine B audit',
      changes: [
        { label: 'Hold', before: null, after: 'Vaccine B audit' },
        { label: 'Covers', before: null, after: 'Everything in Vaccine B' },
        {
          label: 'Reason',
          before: null,
          after: 'Regulator inspection, Nov 2026',
        },
      ],
      action: {
        kind: 'hold.create',
        name: 'Vaccine B audit',
        reason: 'Regulator inspection, Nov 2026',
        projectId: 'p1',
        recordKind: null,
      },
    }),
  },
}
