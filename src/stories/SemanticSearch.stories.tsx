import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SemanticHitsTable } from '#/components/search/semantic-hits'
import { SimilarWorkPanel } from '#/components/search/similar-work-panel'
import { SemanticSearchSection } from '#/components/settings/semantic-search-section'
import type { SemanticHit } from '#/lib/ai-embeddings'
import type { SemanticSettingsView } from '#/lib/semantic-search-actions'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Search by meaning: the table of work that reads close to a question, the
 * "Have we done this before?" panel on an experiment, and the owner's switch
 * in Settings, AI. Nothing calls a model: each story is seeded with the
 * answer the server would give.
 */
const WORKSPACE = '00000000-0000-4000-8000-0000000005a1'
const EXPERIMENT = '00000000-0000-4000-8000-0000000005a2'

const hit = (
  n: number,
  title: string,
  passage: string,
  similarity: number,
  type: SemanticHit['type'] = 'record',
): SemanticHit => ({
  type,
  id: `00000000-0000-4000-8000-00000000060${n}`,
  title,
  identifier: type === 'record' ? `EXP-000${n}` : `DS-000${n}`,
  kind: type === 'record' ? 'experiment' : 'dataset',
  status: 'approved',
  archived: false,
  deepLink: `/records/00000000-0000-4000-8000-00000000060${n}`,
  projectId: null,
  parentType: null,
  parentId: null,
  passage,
  similarity,
})

const HITS = [
  hit(
    1,
    'Lentiviral transduction at low MOI',
    'Cells were exposed to virus at a multiplicity of 0.3 and read after 72 hours.',
    0.71,
  ),
  hit(
    2,
    'Titre of the pLV batch',
    'Functional titre fell by half after a freeze and thaw cycle.',
    0.52,
    'dataset',
  ),
  hit(
    3,
    'Stability of virus in storage',
    'Aliquots kept at 4 °C lost infectivity within a week.',
    0.38,
  ),
]

function settings(over: Partial<SemanticSettingsView['settings']> = {}) {
  return {
    settings: {
      enabled: true,
      profile: 'local-embeddings',
      literatureEnabled: false,
      indexedDocuments: 412,
      totalDocuments: 640,
      ...over,
    },
    profiles: [
      {
        id: 'local-embeddings',
        label: 'Embeddings on our server',
        kind: 'local',
        model: 'llama3.1:8b',
        dataClass: 'local',
        keyAvailable: true,
        embeddings: true,
        embeddingModel: 'nomic-embed-text',
      },
    ],
    canManage: true,
  } satisfies SemanticSettingsView
}

function seeded(view: SemanticSettingsView | null, similar?: SemanticHit[]) {
  const client = screenQueryClient()

  if (view) client.setQueryData(['semantic-settings', WORKSPACE], view)

  if (similar) {
    client.setQueryData(
      ['similar-work', WORKSPACE, 'record', EXPERIMENT],
      similar,
    )
  }

  return client
}

const meta = {
  title: 'Search/By meaning',
  component: SemanticHitsTable,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
  args: { hits: HITS, label: 'Close in meaning' },
} satisfies Meta<typeof SemanticHitsTable>

export default meta

type Story = StoryObj<typeof meta>

/** Work that reads close to the question, with the passage that matched. */
export const CloseInMeaning: Story = {
  render: (args) => (
    <QueryClientProvider client={seeded(null)}>
      <SemanticHitsTable {...args} />
    </QueryClientProvider>
  ),
}

/** On an experiment: earlier work that reads like it. */
export const HaveWeDoneThisBefore: Story = {
  render: () => (
    <QueryClientProvider client={seeded(settings(), HITS)}>
      <div className="w-[340px]">
        <SimilarWorkPanel
          workspaceId={WORKSPACE}
          objectType="record"
          objectId={EXPERIMENT}
          identifier="EXP-0042"
          title="Virus stability at 4 °C"
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The owner's switch, with how much has been read so far. */
export const SettingsOn: Story = {
  render: () => (
    <QueryClientProvider client={seeded(settings())}>
      <SemanticSearchSection
        workspaceId={WORKSPACE}
        cloudAllowed={false}
        assistantOn
      />
    </QueryClientProvider>
  ),
}

/** Off: nothing is read until an owner turns it on. */
export const SettingsOff: Story = {
  render: () => (
    <QueryClientProvider
      client={seeded(settings({ enabled: false, profile: null }))}
    >
      <SemanticSearchSection
        workspaceId={WORKSPACE}
        cloudAllowed={false}
        assistantOn
      />
    </QueryClientProvider>
  ),
}
