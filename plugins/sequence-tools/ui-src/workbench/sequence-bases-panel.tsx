import { useRef } from 'react'

import { Button, copyText } from '../ui/kit'
import { t } from '#/copy'
import { gcFraction, meltingTemp } from '#/lib/molbio'
import { translate } from '#/lib/sequence'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { Panel, fixed } from './shared'

export interface SequenceSelection {
  start: number
  end: number
}

/**
 * The bases themselves, shown as the text they are and selected by eye: a
 * read-only box whose selection drives every other panel. Below it are the facts
 * about what is selected — its length, its GC, its melting temperature when it
 * is primer-sized, and its translation — which are what a person reads while
 * choosing a stretch to act on.
 */
export function SequenceBasesPanel({
  draft,
  selection,
  onSelect,
  canEdit,
}: {
  draft: SequenceBlockPayload
  selection: SequenceSelection
  onSelect: (selection: SequenceSelection) => void
  canEdit: boolean
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const isProtein = draft.molecule === 'protein'
  const selected = draft.residues.slice(selection.start, selection.end)
  const hasSel = selection.end > selection.start

  const readSel = () => {
    const a = area.current

    if (a) onSelect({ start: a.selectionStart, end: a.selectionEnd })
  }

  const selectionFacts =
    hasSel && !isProtein
      ? [
          t('sequences.summary.length.dna', { count: selected.length }),
          t('sequences.summary.gc', {
            value: fixed(gcFraction(selected.toUpperCase()) * 100),
          }),
          selected.length >= 8 &&
          selected.length <= 60 &&
          /^[ACGT]+$/i.test(selected)
            ? t('molbio.edit.tm', { value: fixed(meltingTemp(selected)) })
            : null,
        ].filter(Boolean)
      : []

  return (
    <Panel
      title={t('molbio.edit.bases')}
      hint={canEdit ? t('molbio.edit.basesHint') : undefined}
      actions={
        <>
          <Button
            size="sm"
            icon="copy"
            onClick={() =>
              void copyText(hasSel ? selected : draft.residues, {
                copiedMessage: t('sequences.viewer.copied'),
              })
            }
          >
            {hasSel ? t('molbio.edit.copySelection') : t('molbio.edit.copyAll')}
          </Button>
        </>
      }
    >
      <textarea
        ref={area}
        readOnly
        rows={8}
        spellCheck={false}
        aria-label={t('molbio.edit.basesLabel')}
        value={draft.residues}
        onSelect={readSel}
        onKeyUp={readSel}
        onMouseUp={readSel}
        onFocus={readSel}
        className="w-full resize-y break-all rounded-md border border-border bg-surface p-2 font-mono text-label leading-5 text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-fg-muted">
        <span className="num">
          {hasSel
            ? t('molbio.edit.selection', {
                from: selection.start + 1,
                to: selection.end,
              })
            : t('molbio.edit.cursor', { position: selection.start + 1 })}
        </span>
        {selectionFacts.map((f) => (
          <span key={f} className="num">
            {f}
          </span>
        ))}
      </div>
      {hasSel && !isProtein && selected.length >= 3 ? (
        <p className="num break-all text-label text-fg-muted">
          <span className="font-medium text-fg">
            {t('molbio.edit.translation')}
          </span>{' '}
          {translate(selected)}
        </p>
      ) : null}
    </Panel>
  )
}
