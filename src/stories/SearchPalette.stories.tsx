import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { screen, userEvent } from 'storybook/test'

import { Highlight } from '#/components/v3/search/highlight'
import { SearchPalette } from '#/components/v3/search/search-palette'
import type { DidYouMeanSuggestion, SearchResultWire } from '#/lib/search'
import {
  StubDataClient,
  screenQueryClient,
  screenRoutes,
} from './screen-stories'
import type { DataClientStub } from './screen-stories'

/**
 * The ⌘K search palette and its highlight helper
 * (`src/components/v3/search/`).
 *
 * The palette owns its search: it calls the canonical `api.search` boundary
 * imperatively rather than through React Query, so a cache seed cannot render
 * its result states. These stories replace that one call on the shared data
 * client (`StubDataClient`) with a static page of `api.search` rows — the same
 * wire shape PostgREST returns — and leave the palette's own grouping, ranking,
 * scope filtering and empty/error states to render from it. The project list it
 * reads for the scope picker is a normal seeded query.
 *
 * `open` is the state the shell passes when it mounts the palette; the stories
 * set it directly rather than driving the ⌘K binding.
 */
const PROJECT_A = '0198d970-e266-4000-8000-0000000000a1'
const PROJECT_B = '0198d970-e266-4000-8000-0000000000b2'
const SHEET_ID = '67d5c8d3-129b-44e8-bcbc-a1018b0d8041'
const DATASET_ID = '0198d970-e266-4000-8000-000000000d01'
const TEMPLATE_ID = '0198d970-e266-4000-8000-0000000c0001'
const FILE_ID = '0198d970-e266-4000-8000-0000000f0001'

/** A row in the wire shape `api.search` returns, before `toSearchResult` maps it. */
function row(overrides: Partial<SearchResultWire>): SearchResultWire {
  return {
    result_type: 'record',
    record_id: '0198d970-e266-4000-8000-000000000e14',
    kind: 'experiment',
    identifier: 'EXP-0142',
    title: 'Depth filtration run',
    status: 'in_progress',
    project_id: PROJECT_A,
    archived: false,
    created_by_user_id: 'user-1',
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-12T09:00:00.000Z',
    matched_context: '',
    matched_field: 'title',
    rank: '0.5',
    deep_link: '/records/0198d970-e266-4000-8000-000000000e14',
    total_count: '7',
    ...overrides,
  }
}

/** Two groups and an archived row: what the canonical page renders for one query. */
const RESULTS: SearchResultWire[] = [
  row({
    record_id: '0198d970-e266-4000-8000-0000000005a1',
    kind: 'sample',
    identifier: 'SMP-2231',
    title: 'Clarification harvest HL-0934',
    status: 'available',
    matched_field: 'title',
    matched_context: 'Harvested by G. P. · <b>Clarification</b> lot HL-0934',
    rank: '0.91',
    updated_at: '2026-10-11T10:00:00.000Z',
  }),
  row({
    kind: 'experiment',
    identifier: 'EXP-0142',
    title: 'Clarification run 4',
    matched_context: 'Plate reader run · <b>Clarification</b> step added',
    rank: '0.73',
    updated_at: '2026-10-12T09:00:00.000Z',
  }),
  row({
    record_id: '0198d970-e266-4000-8000-000000000e13',
    kind: 'experiment',
    identifier: 'EXP-0139',
    title: 'Clarification run 2',
    archived: true,
    matched_context: 'Archived · <b>Clarification</b> step',
    rank: '0.4',
    updated_at: '2026-08-02T09:00:00.000Z',
  }),
  row({
    result_type: 'sheet',
    record_id: SHEET_ID,
    kind: 'sheet_instance',
    identifier: SHEET_ID,
    title: 'Clarification working sheet',
    matched_field: 'block_text',
    matched_context: 'Sheet 3 · <b>clarification</b> Qmax column',
    rank: '0.68',
    deep_link: '/sheets/67d5c8d3-129b-44e8-bcbc-a1018b0d8041',
  }),
  row({
    result_type: 'dataset',
    record_id: DATASET_ID,
    kind: 'dataset',
    identifier: DATASET_ID,
    title: 'Clarification DOE results',
    matched_field: 'title',
    matched_context: '<b>Clarification</b> DOE · 48 rows',
    rank: '0.63',
    deep_link: '/datasets/0198d970-e266-4000-8000-000000000d01',
  }),
  row({
    result_type: 'template',
    record_id: TEMPLATE_ID,
    kind: 'notebook_template',
    identifier: 'NT-0004',
    title: 'Clarification protocol template',
    project_id: null,
    matched_field: 'title',
    matched_context: '<b>Clarification</b> protocol · 6 sections',
    rank: '0.57',
    deep_link: '/templates/0198d970-e266-4000-8000-000000000t01',
  }),
  row({
    result_type: 'file',
    record_id: FILE_ID,
    kind: 'file',
    identifier: 'FILE-0042',
    title: 'clarification-panel.csv',
    matched_field: 'file_metadata',
    matched_context: 'Uploaded 12 Oct · <b>clarification</b> panel readings',
    rank: '0.52',
    deep_link: '/records/0198d970-e266-4000-8000-000000000f01',
  }),
]

const SUGGESTION: DidYouMeanSuggestion = {
  id: '0198d970-e266-4000-8000-0000000005a9',
  kind: 'sample',
  identifier: 'SMP-2249',
  title: 'Virus stock A',
  similarity: 0.8,
}

function rpcStub(answer: (name: string) => Promise<unknown>): DataClientStub {
  return { rpc: (name) => answer(name) }
}

const WITH_RESULTS: DataClientStub = rpcStub((name) =>
  name === 'search' ? Promise.resolve(RESULTS) : Promise.resolve([]),
)

const WITH_CORRECTION: DataClientStub = rpcStub((name) =>
  name === 'search_did_you_mean'
    ? Promise.resolve([SUGGESTION])
    : Promise.resolve([]),
)

const NEVER_ANSWERS: DataClientStub = rpcStub(() => new Promise(() => {}))

const FAILS: DataClientStub = rpcStub(() =>
  Promise.reject(new Error('The search service did not answer.')),
)

const PROJECTS = new Map([
  [PROJECT_A, 'Process Development'],
  [PROJECT_B, 'Analytics'],
])

/** The palette reads this for the scope picker; the story seeds it like any read. */
function provider(stub: DataClientStub) {
  const client = screenQueryClient({
    data: [{ key: ['ui-port', 'experiments', 'projects'], value: PROJECTS }],
  })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <StubDataClient stub={stub}>
        <Story />
      </StubDataClient>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Search/Palette',
  parameters: {
    tanstack: {
      router: {
        // Every destination the palette can navigate to when a row is chosen.
        route: screenRoutes('/search', [
          '/records/$recordId',
          '/samples',
          '/experiments/$experimentId',
        ]),
        path: '/search',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Open with no query: the palette's hint, before anything is searched. */
export const Open: Story = {
  decorators: [provider(WITH_RESULTS)],
  render: () => <SearchPalette open onOpenChange={() => {}} />,
  play: async () => {
    await screen.findByText(/Type an ID like/)
  },
}

/** Grouped, ranked results with the archived flag, as one real search page renders. */
export const Results: Story = {
  decorators: [provider(WITH_RESULTS)],
  render: () => (
    <SearchPalette open initialQuery="clarification" onOpenChange={() => {}} />
  ),
  play: async () => {
    await screen.findByText('SMP-2231')
    await screen.findByText('Archived')
    await screen.findByText('See all 7 results')
  },
}

/** A query that finds nothing offers the corrected identifier from the boundary. */
export const NoMatches: Story = {
  decorators: [provider(WITH_CORRECTION)],
  render: () => (
    <SearchPalette open initialQuery="SMP-224" onOpenChange={() => {}} />
  ),
  play: async () => {
    await screen.findByText(/No matches for/)
    await screen.findByRole('button', { name: 'SMP-2249' })
  },
}

/** The search is still running: the list says so rather than showing an empty one. */
export const Loading: Story = {
  decorators: [provider(NEVER_ANSWERS)],
  render: () => (
    <SearchPalette open initialQuery="clarification" onOpenChange={() => {}} />
  ),
  play: async () => {
    await screen.findByText('Searching…')
  },
}

/** A failed search states what happened and offers the retry. */
export const SearchFailed: Story = {
  decorators: [provider(FAILS)],
  render: () => (
    <SearchPalette open initialQuery="clarification" onOpenChange={() => {}} />
  ),
  play: async () => {
    await screen.findByText('Search couldn’t run')
    await screen.findByRole('button', { name: 'Try again' })
  },
}

/**
 * A project scope that excludes every hit: the palette says so and names the
 * scope, rather than pretending the query found nothing.
 */
export const ScopeMiss: Story = {
  decorators: [provider(WITH_RESULTS)],
  render: () => (
    <SearchPalette open initialQuery="clarification" onOpenChange={() => {}} />
  ),
  play: async () => {
    await screen.findByText('SMP-2231')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Search scope' }),
      PROJECT_B,
    )
    await screen.findByText('No matches in Analytics')
  },
}

/** The helper's two modes: explicit `[[…]]` marks and a plain query match. */
export const HighlightModes: Story = {
  render: () => (
    <div className="flex max-w-[560px] flex-col gap-2 text-body">
      <div>
        <Highlight text="Harvest lot [[SMP-2231]] stored at 2–8 °C" />
      </div>
      <div>
        <Highlight text="Clarification working sheet" q="clarification" />
      </div>
      <div>
        <Highlight text="Plate reader run" q="clarification" />
      </div>
    </div>
  ),
}
