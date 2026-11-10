import { useRef } from 'react'

import { Button } from '../ui/kit'
import { t } from '#/copy'
import { reverseComplementSequence, setOrigin } from '#/lib/molbio'
import { SEQUENCE_ACCEPT } from '#/lib/sequence'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { editable, merge } from './edit-model'
import { Panel } from './shared'
import type { WorkbenchProps } from './shared'
import type { SequenceSelection } from './sequence-bases-panel'
import { importSequenceFile } from './sequence-import'

/**
 * The whole molecule, rather than a stretch of it: reverse-complement it, make
 * it circular or linear, move the origin to the cursor, or replace its bases
 * from a file. Only shown for DNA, where those operations mean something.
 */
export function SequenceWholePanel({
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
  const file = useRef<HTMLInputElement>(null)

  return (
    <Panel title={t('molbio.edit.wholeSequence')}>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            edit((d) => merge(d, reverseComplementSequence(editable(d))))
          }
        >
          {t('molbio.edit.reverseComplement')}
        </Button>
        <Button
          onClick={() =>
            edit((d) => ({
              ...d,
              topology: d.topology === 'circular' ? 'linear' : 'circular',
            }))
          }
        >
          {draft.topology === 'circular'
            ? t('molbio.edit.makeLinear')
            : t('molbio.edit.makeCircular')}
        </Button>
        {draft.topology === 'circular' ? (
          <Button
            disabled={selection.start === 0}
            onClick={() => {
              edit((d) => merge(d, setOrigin(editable(d), selection.start)))
              onSelectionChange({ start: 0, end: 0 })
            }}
          >
            {t('molbio.edit.originHere', { position: selection.start + 1 })}
          </Button>
        ) : null}
        <Button icon="upload" onClick={() => file.current?.click()}>
          {t('molbio.edit.replaceFromFile')}
        </Button>
        <input
          ref={file}
          type="file"
          hidden
          accept={SEQUENCE_ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''

            if (f) void importSequenceFile(f, edit)
          }}
        />
      </div>
    </Panel>
  )
}
