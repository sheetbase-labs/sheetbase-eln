import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CitationList } from '#/components/viz/citation-list'
import type { AnalysisViewCitation } from '#/lib/analysis-studio-data'

/**
 * R5-STUDIO-03 citation read model. Rows link to `/records/$recordId`; the
 * Storybook TanStack framework mounts every story inside its router, so the
 * citations render as real destinations with no wrapper here.
 */
function citation(
  overrides: Partial<AnalysisViewCitation> = {},
): AnalysisViewCitation {
  return {
    linkId: 'link-1',
    sourceRecordId: 'record-1',
    identifier: 'EXP-2026-0042',
    title: 'Virus stability at 4 °C',
    recordStatus: 'in_progress',
    linkedAt: '2026-10-02T09:15:00Z',
    locked: false,
    lockedAt: null,
    signed: false,
    signedAt: null,
    signerUserId: null,
    ...overrides,
  }
}

const citations: AnalysisViewCitation[] = [
  citation(),
  citation({
    linkId: 'link-2',
    sourceRecordId: 'record-2',
    identifier: 'EXP-2026-0051',
    title: 'Hold time confirmation',
    signed: true,
    signedAt: '2026-10-04T16:20:00Z',
    signerUserId: 'user-2',
  }),
  citation({
    linkId: 'link-3',
    sourceRecordId: 'record-3',
    identifier: 'EXP-2026-0055',
    title: 'Forced degradation screen',
    locked: true,
    lockedAt: '2026-10-05T08:05:00Z',
  }),
]

const meta = {
  title: 'Visualization/Citation list',
  component: CitationList,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        // A `path` alone moves the URL; `route` puts the record route in the
        // sandbox router so every citation's `Link` resolves.
        route: { path: '/records/$recordId' },
        path: '/records/$recordId',
        params: { recordId: 'record-1' },
      },
    },
  },
  args: { citations },
} satisfies Meta<typeof CitationList>
export default meta
type Story = StoryObj<typeof meta>

/** Draft, signed and locked citations in one list. */
export const Default: Story = {}

export const Loading: Story = { args: { loading: true } }

export const ReadError: Story = {
  args: { error: 'The citation read model is unavailable.' },
}

/** Callers state why nothing cites the analysis. */
export const Empty: Story = {
  args: {
    citations: [],
    emptyBody: 'No notebook block cites this analysis yet.',
  },
}

export const LongTitles: Story = {
  args: {
    citations: [
      citation({
        title:
          'Long-term stability of the lentiviral vector batch at 4 °C, 25 °C and −80 °C including the full assay panel',
      }),
    ],
  },
}
