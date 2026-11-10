import { useRef, useState } from 'react'

import {
  Button,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
  toast,
} from '../ui/kit'
import { t } from '#/copy'
import type { SiblingSequence } from '#/lib/host'
import type { Async } from '#/lib/use-async'
import { cleanDna, simulatePcr } from '#/lib/molbio'
import {
  SEQUENCE_ACCEPT,
  isSequenceFileName,
  parseSequenceFile,
} from '#/lib/sequence'
import type { ParsedSequence } from '#/lib/sequence'
import { newId } from '#/lib/sequence-block'
import type { PlanPart } from '#/lib/sequence-block'
import { partFromSequence } from './cloning-plan'
import type { WorkbenchProps } from './shared'

/**
 * The five ways to supply a part, one form each, in the order the picker lists
 * them. Each asks for exactly what its way needs and nothing else, and each
 * adds the part it can build: this whole sequence, a region of it, a primer
 * product, another block, or bases from a paste or a file.
 */

/** The whole sequence, as it stands, as one part. */
export function WholePartButton({
  draft,
  blockId,
  addPart,
}: {
  draft: WorkbenchProps['draft']
  blockId: string
  addPart: (p: PlanPart) => void
}) {
  return (
    <Button onClick={() => addPart(partFromSequence(draft, blockId))}>
      {t('molbio.cloning.add.add')}
    </Button>
  )
}

/** A stretch of the sequence, with the features that sit wholly inside it. */
export function RegionPartForm({
  draft,
  blockId,
  addPart,
}: {
  draft: WorkbenchProps['draft']
  blockId: string
  addPart: (p: PlanPart) => void
}) {
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(draft.residues.length || 1))
  const own = draft.name || draft.title || t('molbio.sequenceFallback')

  const addRegion = () => {
    const a = Math.max(1, Number(from) || 1)

    const b = Math.min(
      draft.residues.length,
      Number(to) || draft.residues.length,
    )

    if (b <= a) return
    addPart({
      id: newId('part'),
      name: `${own} ${a}..${b}`,
      seq: draft.residues.slice(a - 1, b),
      topology: 'linear',
      features: draft.features
        .filter((f) => f.start <= f.end && f.start >= a && f.end <= b)
        .map((f) => ({
          ...f,
          start: f.start - a + 1,
          end: f.end - a + 1,
          parts: f.parts.map((x) => ({
            start: x.start - a + 1,
            end: x.end - a + 1,
          })),
        })),
      blockId,
    })
  }

  return (
    <>
      <Field label={t('molbio.primers.targetFrom')} className="w-24">
        <Input
          inputMode="numeric"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <Field label={t('molbio.primers.targetTo')} className="w-24">
        <Input
          inputMode="numeric"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </Field>
      <Button onClick={addRegion}>{t('molbio.cloning.add.add')}</Button>
    </>
  )
}

/** The product of two kept primers. Disabled, and saying so, when they make none. */
export function PcrPartForm({
  draft,
  blockId,
  addPart,
}: {
  draft: WorkbenchProps['draft']
  blockId: string
  addPart: (p: PlanPart) => void
}) {
  const [fwd, setFwd] = useState('')
  const [rev, setRev] = useState('')
  const primers = draft.primers ?? []

  const pcrProducts =
    fwd && rev
      ? simulatePcr(
          draft.residues.toUpperCase(),
          primers.find((p) => p.id === fwd)?.seq ?? '',
          primers.find((p) => p.id === rev)?.seq ?? '',
          draft.topology === 'circular',
        )
      : []

  return (
    <>
      <Field label={t('molbio.primers.forward')} className="w-44">
        <Select value={fwd} onChange={(e) => setFwd(e.target.value)}>
          <option value="">{t('molbio.primers.choose')}</option>
          {primers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('molbio.primers.reverse')} className="w-44">
        <Select value={rev} onChange={(e) => setRev(e.target.value)}>
          <option value="">{t('molbio.primers.choose')}</option>
          {primers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        disabled={pcrProducts.length === 0}
        onClick={() => {
          const p = pcrProducts[0]
          addPart({
            id: newId('part'),
            name: t('molbio.cloning.add.pcrName', {
              forward: primers.find((x) => x.id === fwd)?.name ?? '',
              reverse: primers.find((x) => x.id === rev)?.name ?? '',
            }),
            seq: p.seq,
            topology: 'linear',
            features: [],
            blockId,
          })
        }}
      >
        {pcrProducts.length === 0 && fwd && rev
          ? t('molbio.primers.noProduct')
          : t('molbio.cloning.add.add')}
      </Button>
    </>
  )
}

/** Another block in the notebook, read from the host once and listed by name. */
export function BlockPartForm({
  siblings,
  addPart,
}: {
  siblings: Async<SiblingSequence[]>
  addPart: (p: PlanPart) => void
}) {
  if (siblings.error)
    return (
      <div role="alert">
        <Notice tone="warn">{t('molbio.cloning.add.loadFailed')}</Notice>
      </div>
    )

  return (
    <Field label={t('molbio.cloning.add.block')} className="w-64">
      <Select
        value=""
        onChange={(e) => {
          const s = siblings.data?.find((x) => x.id === e.target.value)

          if (!s) return
          const part = partFromSequence(s.payload, s.id)
          part.name =
            s.payload.name || s.payload.title || t('molbio.sequenceFallback')
          addPart(part)
        }}
      >
        <option value="">
          {siblings.isPending
            ? t('molbio.cloning.add.loading')
            : (siblings.data?.length ?? 0) === 0
              ? t('molbio.cloning.add.noBlocks')
              : t('molbio.cloning.add.pickBlock')}
        </option>
        {siblings.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.payload.name || s.payload.title || t('molbio.sequenceFallback')}{' '}
            ({s.payload.residues.length})
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** A GenBank or FASTA file from the machine; up to four sequences become parts. */
export function FilePartForm({ addPart }: { addPart: (p: PlanPart) => void }) {
  const file = useRef<HTMLInputElement>(null)

  const load = async (f: File) => {
    if (!isSequenceFileName(f.name)) {
      toast.error(t('sequences.notSequence', { name: f.name }))

      return
    }

    try {
      const parsed: ParsedSequence[] = parseSequenceFile(await f.text())

      for (const s of parsed.slice(0, 4))
        addPart({
          id: newId('part'),
          name: s.name,
          seq: s.residues,
          topology: s.topology,
          features: s.features,
        })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Button icon="upload" onClick={() => file.current?.click()}>
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

          if (f) void load(f)
        }}
      />
    </>
  )
}

/** Bases typed or pasted into the form, with a name to keep them under. */
export function PastedPartForm({
  addPart,
}: {
  addPart: (p: PlanPart) => void
}) {
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')

  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-label={t('molbio.primers.name')}
        placeholder={t('molbio.primers.name')}
        className="w-56"
        value={pastedName}
        onChange={(e) => setPastedName(e.target.value)}
      />
      <Textarea
        aria-label={t('molbio.edit.pasteLabel')}
        rows={3}
        className="font-mono"
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder={t('molbio.cloning.add.pastePlaceholder')}
      />
      <div>
        <Button
          disabled={cleanDna(pasted).length < 8}
          onClick={() => {
            addPart({
              id: newId('part'),
              name: pastedName.trim() || t('molbio.cloning.add.pastedName'),
              seq: cleanDna(pasted),
              topology: 'linear',
              features: [],
            })
            setPasted('')
            setPastedName('')
          }}
        >
          {t('molbio.cloning.add.add')}
        </Button>
      </div>
    </div>
  )
}
