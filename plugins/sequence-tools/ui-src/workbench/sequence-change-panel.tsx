import { useState } from 'react'

import { Button, Textarea, toast } from '../ui/kit'
import { t } from '#/copy'
import {
  cleanDna,
  deleteRange,
  insertAt,
  replaceRange,
  reverseComplement,
} from '#/lib/molbio'
import type { EditableSequence } from '#/lib/molbio'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { editable, merge } from './edit-model'
import { Panel } from './shared'
import type { WorkbenchProps } from './shared'
import type { SequenceSelection } from './sequence-bases-panel'

/**
 * Act on the selected stretch: replace it, insert before it, delete it, or flip
 * it to the other strand. The new bases are typed here and cleaned to the
 * molecule as they are; a feature the change would cut through is removed, and
 * the person is told which.
 */
export function SequenceChangePanel({
  draft,
  edit,
  selection,
  onSelectionChange,
}: {
  draft: SequenceBlockPayload
  edit: WorkbenchProps['edit']
  selection: SequenceSelection
  onSelectionChange: (selection: SequenceSelection) => void
}) {
  const [text, setText] = useState('')
  const isProtein = draft.molecule === 'protein'
  const selected = draft.residues.slice(selection.start, selection.end)
  const hasSel = selection.end > selection.start

  const bases = isProtein
    ? text.toUpperCase().replace(/[^A-Z*]/g, '')
    : cleanDna(text)

  const apply = (
    result: { sequence: EditableSequence; removedFeatures: string[] },
    at?: number,
  ) => {
    edit((d) => merge(d, result.sequence))

    if (result.removedFeatures.length > 0)
      toast(
        t('molbio.edit.removedFeatures', {
          names: result.removedFeatures.join(', '),
        }),
      )

    if (at !== undefined) onSelectionChange({ start: at, end: at })
  }

  return (
    <Panel title={t('molbio.edit.change')}>
      <Textarea
        aria-label={t('molbio.edit.newBases')}
        placeholder={t('molbio.edit.newBasesPlaceholder')}
        rows={2}
        className="font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!hasSel || bases.length === 0}
          onClick={() => {
            apply(
              replaceRange(
                editable(draft),
                selection.start,
                selection.end,
                bases,
              ),
              selection.start + bases.length,
            )
            setText('')
          }}
        >
          {t('molbio.edit.replace')}
        </Button>
        <Button
          disabled={bases.length === 0}
          onClick={() => {
            apply(
              insertAt(editable(draft), selection.start, bases),
              selection.start + bases.length,
            )
            setText('')
          }}
        >
          {t('molbio.edit.insert')}
        </Button>
        <Button
          variant="danger"
          disabled={!hasSel}
          onClick={() =>
            apply(
              deleteRange(editable(draft), selection.start, selection.end),
              selection.start,
            )
          }
        >
          {t('molbio.edit.delete')}
        </Button>
        {!isProtein ? (
          <Button
            disabled={!hasSel}
            onClick={() =>
              apply(
                replaceRange(
                  editable(draft),
                  selection.start,
                  selection.end,
                  reverseComplement(selected),
                ),
              )
            }
          >
            {t('molbio.edit.flipSelection')}
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}
