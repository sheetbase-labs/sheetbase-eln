import { useRef, useState } from 'react'

import { Button, Notice, Textarea, toast } from '../ui/kit'
import { t } from '#/copy'
import { cleanDna } from '#/lib/molbio'
import { SEQUENCE_ACCEPT, parseSequenceFile } from '#/lib/sequence'
import { RecordFilePicker } from './shared'
import type { WorkbenchProps } from './shared'
import { importSequenceFile, importSequenceText } from './sequence-import'

/**
 * A sequence with no bases yet: paste them, or import a GenBank or FASTA file
 * from the machine or from a notebook file. It is what the Edit tab shows until
 * there is something to edit, and the only panel in it that can create bases.
 */
export function SequenceEmptyPanel({
  edit,
  canEdit,
}: {
  edit: WorkbenchProps['edit']
  canEdit: boolean
}) {
  const file = useRef<HTMLInputElement>(null)
  const [paste, setPaste] = useState('')

  const applyPasted = () => {
    const raw = paste.trim()

    if (raw.startsWith('>') || /^LOCUS/m.test(raw)) {
      try {
        const [first] = parseSequenceFile(raw)
        edit((d) => ({
          ...d,
          name: d.name || first.name,
          molecule: first.molecule,
          topology: first.topology,
          residues: first.residues,
          features: first.features,
        }))
        setPaste('')

        return
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))

        return
      }
    }

    edit((d) => ({ ...d, residues: cleanDna(raw) }))
    setPaste('')
  }

  return (
    <div className="flex flex-col gap-3">
      <Notice>{t('molbio.edit.emptyHint')}</Notice>
      <Textarea
        aria-label={t('molbio.edit.pasteLabel')}
        placeholder={t('molbio.edit.pastePlaceholder')}
        rows={6}
        className="font-mono"
        disabled={!canEdit}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!canEdit || cleanDna(paste).length === 0}
          onClick={applyPasted}
        >
          {t('molbio.edit.usePasted')}
        </Button>
        <Button
          icon="upload"
          disabled={!canEdit}
          onClick={() => file.current?.click()}
        >
          {t('molbio.edit.importFile')}
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
        <RecordFilePicker
          disabled={!canEdit}
          onPick={(contents) => importSequenceText(contents, edit)}
        />
      </div>
    </div>
  )
}
