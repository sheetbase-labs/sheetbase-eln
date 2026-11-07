/**
 * Editing the sequence: choose a stretch of bases, then replace, insert or
 * delete, and the features move with it. Also flip the strand, move the
 * origin, import a file, and name the features.
 */
import { useRef, useState } from 'react'

import { Textarea } from '#/components/inventory/list'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { copyText } from '#/components/ui/copy-button'
import { IconButton } from '#/components/ui/icon-button'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  addFeature,
  autoAnnotate,
  cleanDna,
  deleteRange,
  gcFraction,
  insertAt,
  meltingTemp,
  removeFeature,
  replaceRange,
  reverseComplement,
  reverseComplementSequence,
  setOrigin,
} from '#/lib/molbio'
import type { EditableSequence } from '#/lib/molbio'
import {
  SEQUENCE_ACCEPT,
  isSequenceFileName,
  parseSequenceFile,
  translate,
} from '#/lib/sequence'
import type { SequenceFeature } from '#/lib/sequence'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { featureColour, formatBases } from '../geometry'
import { DataTable, Panel, fixed } from './shared'
import type { WorkbenchProps } from './shared'

const FEATURE_TYPES = [
  'CDS',
  'promoter',
  'terminator',
  'rep_origin',
  'primer_bind',
  'misc_feature',
  'misc_recomb',
  'protein_bind',
  'regulatory',
] as const

function editable(d: SequenceBlockPayload): EditableSequence {
  return { residues: d.residues, topology: d.topology, features: d.features }
}
function merge(
  d: SequenceBlockPayload,
  s: EditableSequence,
): SequenceBlockPayload {
  return {
    ...d,
    residues: s.residues,
    topology: s.topology,
    features: s.features,
  }
}

export function EditTab({ draft, edit, canEdit }: WorkbenchProps) {
  const area = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [sel, setSel] = useState({ start: 0, end: 0 })
  const [text, setText] = useState('')
  const [paste, setPaste] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<string>('misc_feature')
  const [strand, setStrand] = useState<'1' | '-1'>('1')
  const isProtein = draft.molecule === 'protein'
  const selected = draft.residues.slice(sel.start, sel.end)
  const hasSel = sel.end > sel.start

  const readSel = () => {
    const a = area.current
    if (a) setSel({ start: a.selectionStart, end: a.selectionEnd })
  }
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
    if (at !== undefined) setSel({ start: at, end: at })
  }
  const bases = isProtein
    ? text.toUpperCase().replace(/[^A-Z*]/g, '')
    : cleanDna(text)

  const importFile = async (f: File) => {
    if (!isSequenceFileName(f.name)) {
      toast.error(t('sequences.notSequence', { name: f.name }))
      return
    }
    try {
      const [first] = parseSequenceFile(await f.text())
      edit((d) => ({
        ...d,
        name: d.name || first.name,
        molecule: first.molecule,
        topology: first.topology,
        residues: first.residues,
        features: first.features,
      }))
      toast(t('molbio.edit.imported', { name: first.name }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  if (draft.residues.length === 0) {
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
            onClick={() => {
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
            }}
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
              if (f) void importFile(f)
            }}
          />
        </div>
      </div>
    )
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
    <div className="flex flex-col gap-4">
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
              {hasSel
                ? t('molbio.edit.copySelection')
                : t('molbio.edit.copyAll')}
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
              ? t('molbio.edit.selection', { from: sel.start + 1, to: sel.end })
              : t('molbio.edit.cursor', { position: sel.start + 1 })}
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

      {canEdit ? (
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
                  replaceRange(editable(draft), sel.start, sel.end, bases),
                  sel.start + bases.length,
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
                  insertAt(editable(draft), sel.start, bases),
                  sel.start + bases.length,
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
                  deleteRange(editable(draft), sel.start, sel.end),
                  sel.start,
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
                      sel.start,
                      sel.end,
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
      ) : null}

      {canEdit && !isProtein ? (
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
                disabled={sel.start === 0}
                onClick={() => {
                  edit((d) => merge(d, setOrigin(editable(d), sel.start)))
                  setSel({ start: 0, end: 0 })
                }}
              >
                {t('molbio.edit.originHere', { position: sel.start + 1 })}
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
                if (f) void importFile(f)
              }}
            />
          </div>
        </Panel>
      ) : null}

      <Panel
        title={t('molbio.edit.features', { count: draft.features.length })}
        actions={
          canEdit && !isProtein ? (
            <Button
              size="sm"
              icon="spark"
              onClick={() => {
                const found = autoAnnotate(
                  draft.residues.toUpperCase(),
                  draft.topology,
                  draft.features,
                )
                if (found.length === 0) {
                  toast(t('molbio.edit.nothingFound'))
                  return
                }
                edit((d) => {
                  let s = editable(d)
                  for (const f of found) s = addFeature(s, f)
                  return merge(d, s)
                })
                toast(t('molbio.edit.annotated', { count: found.length }))
              }}
            >
              {t('molbio.edit.annotate')}
            </Button>
          ) : null
        }
      >
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              aria-label={t('molbio.edit.featureName')}
              placeholder={t('molbio.edit.featureName')}
              className="w-44"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Select
              size="sm"
              aria-label={t('molbio.edit.featureType')}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {FEATURE_TYPES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
            <Select
              size="sm"
              aria-label={t('molbio.edit.featureStrand')}
              value={strand}
              onChange={(e) => setStrand(e.target.value as '1' | '-1')}
            >
              <option value="1">{t('sequences.viewer.strandForward')}</option>
              <option value="-1">{t('sequences.viewer.strandReverse')}</option>
            </Select>
            <Button
              disabled={!hasSel || label.trim() === ''}
              onClick={() => {
                const f: Omit<SequenceFeature, 'id' | 'parts'> = {
                  type,
                  label: label.trim(),
                  strand: strand === '1' ? 1 : -1,
                  start: sel.start + 1,
                  end: sel.end,
                  qualifiers: {},
                }
                edit((d) => merge(d, addFeature(editable(d), f)))
                setLabel('')
              }}
            >
              {t('molbio.edit.addFeature')}
            </Button>
          </div>
        ) : null}
        <DataTable
          caption={t('molbio.edit.featuresCaption')}
          rows={[...draft.features].sort((a, b) => a.start - b.start)}
          rowKey={(f) => String(f.id)}
          empty={t('sequences.viewer.noFeatures')}
          columns={[
            {
              key: 'name',
              head: t('sequences.viewer.columns.name'),
              cell: (f) => (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-sm"
                    style={{ background: featureColour(f.type) }}
                  />
                  {f.label}
                </span>
              ),
            },
            {
              key: 'type',
              head: t('sequences.viewer.columns.type'),
              cell: (f) => f.type,
            },
            {
              key: 'pos',
              head: t('sequences.viewer.columns.position'),
              cell: (f) => `${formatBases(f.start)}..${formatBases(f.end)}`,
            },
            {
              key: 'strand',
              head: t('sequences.viewer.columns.strand'),
              cell: (f) =>
                f.strand === 1
                  ? t('sequences.viewer.strandForward')
                  : t('sequences.viewer.strandReverse'),
            },
            ...(canEdit
              ? [
                  {
                    key: 'remove',
                    head: '',
                    align: 'right' as const,
                    cell: (f: SequenceFeature) => (
                      <IconButton
                        label={t('molbio.edit.removeFeature')}
                        icon="x"
                        onClick={() =>
                          edit((d) =>
                            merge(d, removeFeature(editable(d), f.id)),
                          )
                        }
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>
    </div>
  )
}
