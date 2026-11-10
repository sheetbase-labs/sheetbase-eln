/**
 * Editing the sequence: choose a stretch of bases, then replace, insert or
 * delete, and the features move with it. Also flip the strand, move the
 * origin, import a file, and name the features.
 *
 * The tab is the composition; each job is a panel of its own —
 * `sequence-empty-panel.tsx` before there are bases, then the bases,
 * the change, the whole-molecule actions and the features table.
 */
import { useState } from 'react'

import { SequenceBasesPanel } from './sequence-bases-panel'
import type { SequenceSelection } from './sequence-bases-panel'
import { SequenceChangePanel } from './sequence-change-panel'
import { SequenceEmptyPanel } from './sequence-empty-panel'
import { SequenceFeaturesPanel } from './sequence-features-panel'
import { SequenceWholePanel } from './sequence-whole-panel'
import type { WorkbenchProps } from './shared'

export function EditTab({ draft, edit, canEdit }: WorkbenchProps) {
  const [sel, setSel] = useState<SequenceSelection>({ start: 0, end: 0 })
  const isProtein = draft.molecule === 'protein'

  if (draft.residues.length === 0)
    return <SequenceEmptyPanel edit={edit} canEdit={canEdit} />

  return (
    <div className="flex flex-col gap-4">
      <SequenceBasesPanel
        draft={draft}
        selection={sel}
        onSelect={setSel}
        canEdit={canEdit}
      />

      {canEdit ? (
        <SequenceChangePanel
          draft={draft}
          edit={edit}
          selection={sel}
          onSelectionChange={setSel}
        />
      ) : null}

      {canEdit && !isProtein ? (
        <SequenceWholePanel
          draft={draft}
          edit={edit}
          selection={sel}
          onSelectionChange={setSel}
        />
      ) : null}

      <SequenceFeaturesPanel
        draft={draft}
        edit={edit}
        canEdit={canEdit}
        selection={sel}
      />
    </div>
  )
}
