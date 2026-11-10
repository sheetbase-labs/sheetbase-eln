/**
 * Primers: design pairs for a region, check any primer you already have, keep
 * the ones you will order, and simulate the PCR to see what they make.
 *
 * Each of those is a panel of its own — `primer-design-panel.tsx`,
 * `kept-primers-panel.tsx` and `primer-pcr-panel.tsx` — because each holds its
 * own form state and its own answer.
 */
import { Notice } from '../ui/kit'
import { t } from '#/copy'
import type { WorkbenchProps } from './shared'
import { KeptPrimersPanel } from './kept-primers-panel'
import { PrimerDesignPanel } from './primer-design-panel'
import { PrimerPcrPanel } from './primer-pcr-panel'

export function PrimersTab({ draft, edit, canEdit }: WorkbenchProps) {
  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  if (draft.residues.length === 0)
    return <Notice>{t('molbio.enzymes.empty')}</Notice>

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? (
        <PrimerDesignPanel draft={draft} edit={edit} canEdit={canEdit} />
      ) : null}

      <KeptPrimersPanel draft={draft} edit={edit} canEdit={canEdit} />

      {(draft.primers ?? []).length >= 2 ? (
        <PrimerPcrPanel draft={draft} />
      ) : null}
    </div>
  )
}
