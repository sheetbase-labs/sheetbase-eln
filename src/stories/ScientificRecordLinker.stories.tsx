import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScientificRecordLinker } from '#/components/scientific/scientific-record-linker'
import type { NotebookLink } from '#/lib/notebook-data'
import type { ModelRelationshipRule } from '#/lib/model-relationships'

/**
 * SCI-001 record linker. The picker itself opens on the Link action; the
 * stories below cover what the surface shows at rest for each caller
 * configuration. Per-record summaries are suppressed the way the notebook
 * inspector mounts it (`hideSummaries`), so the stories issue no reads.
 */
const SOURCE_ID = '0198d970-e266-4000-8000-0000000000a1'

function link(overrides: Partial<NotebookLink> = {}): NotebookLink {
  return {
    id: 'link-1',
    sourceRecordId: SOURCE_ID,
    targetRecordId: '0198d970-e266-4000-8000-0000000088aa',
    targetKind: 'sample',
    targetIdentifier: 'SMP-2026-0142',
    linkType: 'sample',
    createdAt: '2026-07-29T11:00:00Z',
    createdByUserId: 'user-1',
    ...overrides,
  }
}

const rules: ModelRelationshipRule[] = [
  {
    id: 'rule-1',
    sourceModelKey: 'experiment',
    linkType: 'sample',
    targetModelKey: 'sample',
    minLinks: 0,
    maxLinks: 4,
    label: 'Samples',
  },
  {
    id: 'rule-2',
    sourceModelKey: 'experiment',
    linkType: 'protocol',
    targetModelKey: 'protocol_template',
    minLinks: 0,
    maxLinks: null,
    label: 'Protocol',
  },
]

const meta = {
  title: 'Scientific/Record linker',
  component: ScientificRecordLinker,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, queryFn: () => new Promise(() => {}) },
            },
          })
        }
      >
        <div className="w-[420px]">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    sourceRecordId: SOURCE_ID,
    links: [],
    hideSummaries: true,
    onLinked: () => {},
  },
} satisfies Meta<typeof ScientificRecordLinker>
export default meta
type Story = StoryObj<typeof meta>

/** No links yet: the picker is the only affordance. */
export const Default: Story = {}

/** Existing links are listed with their kind. */
export const WithLinks: Story = {
  args: { links: [link()] },
}

/** MODEL-03: only the kinds the source Model accepts are offered. */
export const RestrictedByRules: Story = {
  args: { sourceModelKey: 'experiment', rules },
}

/** A Model whose rules accept no link kind still offers the action; opening
 * it shows no kind tabs to choose from. */
export const NoAllowedKinds: Story = {
  args: {
    sourceModelKey: 'experiment',
    rules: [
      {
        id: 'rule-3',
        sourceModelKey: 'experiment',
        linkType: 'file',
        targetModelKey: 'file',
        minLinks: 0,
        maxLinks: null,
        label: 'Files',
      },
    ],
  },
}

/** Detailed summaries are the other caller mode; the first read is pending
 * until the record arrives. */
export const WithSummaries: Story = {
  args: { links: [link()], hideSummaries: false },
}
