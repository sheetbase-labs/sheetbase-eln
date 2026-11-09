import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExperimentPicker } from '#/components/record-picker/experiment-picker'
import {
  RecordPicker,
  RecordPickerDialog,
} from '#/components/record-picker/record-picker'
import { SavedSearches } from '#/components/search/saved-searches'
import { SearchResultIcon } from '#/components/search/result-icon'
import { savedSearchQueryKey } from '#/lib/search'
import type { SavedQuery } from '#/lib/search'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Searching and picking records (`src/components/search/`,
 * `src/components/record-picker/`): the saved-searches popover, the icon a
 * result leads with, the experiment picker and the record picker.
 *
 * The record picker reads the workspace search through a client built when
 * the module loads, so a story cannot hand it results; with no server behind
 * Storybook it shows its failed-search state, which is recorded in
 * `docs/development/storybook-coverage.md`.
 */
const WORKSPACE_ID = '0198d970-e266-4000-8000-000000000001'

const saved = (
  id: string,
  name: string,
  query: string,
  extra: Partial<SavedQuery> = {},
): SavedQuery => ({
  id,
  name,
  query,
  facets: {},
  kind: '',
  projectId: '',
  status: '',
  ownerId: '',
  dateRange: 'all',
  ts: Date.parse('2026-09-20T09:00:00.000Z'),
  visibility: 'private',
  savedBy: 'u-1',
  lastUsed: Date.parse('2026-09-24T09:00:00.000Z'),
  ...extra,
})

const client = screenQueryClient({
  data: [
    {
      key: savedSearchQueryKey(WORKSPACE_ID),
      value: [
        saved('s1', 'Quarantined harvests', 'harvest quarantine'),
        saved('s2', 'Open deviations', 'deviation', {
          visibility: 'workspace',
          lastUsed: undefined,
        }),
      ],
    },
    { key: ['ui-port', 'workspace-members'], value: [] },
  ],
})

const emptyClient = screenQueryClient({
  data: [
    { key: savedSearchQueryKey(WORKSPACE_ID), value: [] },
    { key: ['ui-port', 'workspace-members'], value: [] },
  ],
})

const meta = {
  title: 'Search/Saved searches and pickers',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/search', ['/saved-searches']),
        path: '/search',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}

/** The popover on a results page: save the current search, jump to a recent one. */
export const Saved: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="w-[340px] rounded-md border border-border p-3">
        <SavedSearches
          workspaceId={WORKSPACE_ID}
          current={{ q: 'harvest' }}
          onApply={noop}
          userId="u-1"
          role="admin"
        />
      </div>
    </QueryClientProvider>
  ),
}

/** No saved searches yet. */
export const SavedEmpty: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <div className="w-[340px] rounded-md border border-border p-3">
        <SavedSearches
          workspaceId={WORKSPACE_ID}
          current={{ q: '' }}
          onApply={noop}
          userId="u-1"
          role="viewer"
        />
      </div>
    </QueryClientProvider>
  ),
}

/** The icons results lead with: records by kind, then other object types. */
export const ResultIcons: Story = {
  render: () => (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
      {(
        [
          ['record', 'experiment'],
          ['record', 'sample'],
          ['record', 'material'],
          ['dataset', ''],
          ['file', ''],
          ['project', ''],
          ['instrument', ''],
          ['storage_location', ''],
        ] as const
      ).map(([resultType, kind]) => (
        <li key={`${resultType}:${kind}`} className="flex items-center gap-2">
          <SearchResultIcon
            result={{ resultType, kind, matchedField: 'title' }}
          />
          {kind || resultType}
        </li>
      ))}
    </ul>
  ),
}

const EXPERIMENTS = [
  { id: 'exp-1', identifier: 'EXP-0142', title: 'Depth filtration' },
  { id: 'exp-2', identifier: 'EXP-0147', title: 'Virus inactivation' },
  { id: 'exp-3', identifier: 'EXP-0151', title: 'Viral clearance spike' },
]

function Experiment({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)

  return (
    <div className="w-[360px]">
      <ExperimentPicker
        value={value}
        onChange={setValue}
        experiments={EXPERIMENTS}
        placeholder="Choose an experiment"
      />
    </div>
  )
}

/** The experiment picker over a list the page already holds. */
export const ExperimentChoose: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <Experiment initial="" />
    </QueryClientProvider>
  ),
}

/** A chosen experiment names itself in the field. */
export const ExperimentChosen: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <Experiment initial="exp-2" />
    </QueryClientProvider>
  ),
}

/** The record picker panel with no server behind it: its failed-search state. */
export const Picker: Story = {
  render: () => (
    <div className="flex h-[420px] w-[560px] flex-col rounded-md border border-border">
      <RecordPicker onPick={noop} autoFocus={false} />
    </div>
  ),
}

/** A picker limited to samples and experiments, as the pool dialog offers it. */
export const PickerLimited: Story = {
  render: () => (
    <div className="flex h-[420px] w-[560px] flex-col rounded-md border border-border">
      <RecordPicker
        allowed={['Sample', 'Experiment']}
        multiple
        confirmLabel={(count) => `Add ${count}`}
        onPick={noop}
        autoFocus={false}
      />
    </div>
  ),
}

/** The picker as a dialog. */
export const PickerInDialog: Story = {
  render: () => (
    <RecordPickerDialog
      open
      onOpenChange={noop}
      title="Link a record"
      onPick={noop}
    />
  ),
}
