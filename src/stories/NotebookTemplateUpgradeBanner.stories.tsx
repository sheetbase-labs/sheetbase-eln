import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookTemplateUpgradeBanner } from '#/components/notebook/notebook-template-upgrade-banner'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'

/**
 * REUSE-03 upgrade banner. The banner compares the record's stored Template
 * Version pin against the Template's published lineage and renders nothing
 * unless a newer published version exists, so the stories seed the pin, the
 * template and the lineage it compares.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'
const TEMPLATE_ID = '0198d970-e266-4000-8000-0000000000t1'.replace('t', 'f')
const PINNED_VERSION_ID = '0198d970-e266-4000-8000-0000000v0001'.replace(
  'v',
  'e',
)
const LATEST_VERSION_ID = '0198d970-e266-4000-8000-0000000e0002'

function version(
  id: string,
  number: number,
  lifecycle: 'published' | 'draft',
): NotebookTemplateVersion {
  return {
    id,
    templateId: TEMPLATE_ID,
    version: number,
    lifecycle,
    configuration: { formatVersion: 1, parameters: [], placements: [] },
    revision: 1,
    publishedAt: '2026-08-01T09:00:00Z',
    publishedByUserId: 'user-1',
    reason: 'Added the assay controls section',
    signedByUserId: null,
    signedMeaning: null,
    signedAt: null,
    retiredAt: null,
  }
}

function client(state: 'upgrade' | 'current' | 'unknown') {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (state === 'unknown') return instance
  instance.setQueryData(
    ['notebook-template-version', PINNED_VERSION_ID],
    version(PINNED_VERSION_ID, 2, 'published'),
  )
  instance.setQueryData(['notebook-template', TEMPLATE_ID], {
    id: TEMPLATE_ID,
    key: 'titration-assay',
    name: 'Titration assay',
  })
  instance.setQueryData(
    ['notebook-template-versions', TEMPLATE_ID],
    state === 'upgrade'
      ? [
          version(PINNED_VERSION_ID, 2, 'published'),
          version(LATEST_VERSION_ID, 3, 'published'),
        ]
      : [version(PINNED_VERSION_ID, 2, 'published')],
  )
  return instance
}

function withClient(state: 'upgrade' | 'current' | 'unknown') {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(state)}>
      <div className="w-[800px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/Template upgrade banner',
  component: NotebookTemplateUpgradeBanner,
  tags: ['autodocs'],
  decorators: [withClient('upgrade')],
  args: { recordId: RECORD_ID, pinnedVersionId: PINNED_VERSION_ID },
} satisfies Meta<typeof NotebookTemplateUpgradeBanner>
export default meta
type Story = StoryObj<typeof meta>

/** A newer published Template Version exists for this record's pin. */
export const UpgradeAvailable: Story = {}

/** The pin is the newest published version: the banner is silent. */
export const Current: Story = { decorators: [withClient('current')] }

/** An unpinned record has no lineage to compare. */
export const Unpinned: Story = { args: { pinnedVersionId: null } }

/** A pin or lineage that cannot be resolved is silent, not guessed. */
export const UnknownLineage: Story = { decorators: [withClient('unknown')] }
