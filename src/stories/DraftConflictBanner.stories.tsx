import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DraftConflictBanner } from '#/components/v3/models/draft-conflict-banner'
import type { DraftConflict } from '#/lib/dataset-schema-draft'

/**
 * The stale-draft banner of a model's field editor
 * (`src/components/v3/models/draft-conflict-banner.tsx`), as the models edit
 * route renders it when a save was refused because the draft moved underneath
 * it. Which resolution is offered follows `conflict.overlap`: an overlap must be
 * chosen between explicitly (Keep mine), while disjoint edits can be merged.
 *
 * The copy counts only the fields the other side changed, so the stories cover
 * one field and several, and a save that is already in flight.
 */
const conflict = (theirs: string[], overlap: boolean): DraftConflict => ({
  serverRows: [],
  serverRevision: 3,
  theirs: new Set(theirs),
  mine: new Set(['viability']),
  overlap,
})

const meta = {
  title: 'Models/Draft conflict banner',
  component: DraftConflictBanner,
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { onReload: () => {}, onMerge: () => {}, onKeepMine: () => {} },
} satisfies Meta<typeof DraftConflictBanner>
export default meta
type Story = StoryObj<typeof meta>

/**
 * Both sides changed the same field: nothing is written until the author
 * chooses, and keeping theirs replaces the other version of the shared fields.
 */
export const Overlap: Story = {
  args: { conflict: conflict(['cell_line', 'passage'], true) },
}

/**
 * The other side changed a field this editor did not: both can be kept, and
 * merging takes their fields and re-applies this editor's, keeping their order.
 */
export const NoOverlap: Story = {
  args: { conflict: conflict(['viability'], false) },
}

/** A save in flight: both resolutions are held until it answers. */
export const Saving: Story = {
  args: { conflict: conflict(['cell_line', 'passage'], true), busy: true },
}
