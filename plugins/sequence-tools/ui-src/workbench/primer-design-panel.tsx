import { useState } from 'react'

import { Button, Checkbox, Field, Input, Select, toast } from '../ui/kit'
import { t } from '#/copy'
import { cleanDna, designPrimers } from '#/lib/molbio'
import type { PrimerPair } from '#/lib/molbio'
import { MAX_PRIMERS, newId } from '#/lib/sequence-block'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import type { WorkbenchProps } from './shared'
import { DataTable, Panel, fixed } from './shared'
import { numberOr, warningText } from './primer-format'

/**
 * Design primer pairs for a region: where the region starts and ends (typed, or
 * taken from a feature), the melting temperature to aim for, the product size
 * to allow, any tails to add, and whether the product may sit beside the region.
 * Each pair found can be kept, which adds its two primers to the sequence.
 */
export function PrimerDesignPanel({
  draft,
  edit,
  canEdit,
}: {
  draft: SequenceBlockPayload
  edit: WorkbenchProps['edit']
  canEdit: boolean
}) {
  const len = draft.residues.length
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(Math.min(len, 1000) || 1))
  const [flank, setFlank] = useState(false)
  const [tm, setTm] = useState('60')
  const [maxProduct, setMaxProduct] = useState('2000')
  const [tailF, setTailF] = useState('')
  const [tailR, setTailR] = useState('')
  const [pairs, setPairs] = useState<PrimerPair[] | null>(null)
  const primers = draft.primers ?? []

  const design = () => {
    const start = Math.max(1, Math.min(len, numberOr(from, 1))) - 1
    const end = Math.max(start + 1, Math.min(len, numberOr(to, len)))
    const optTm = numberOr(tm, 60)

    if (end - start > numberOr(maxProduct, 2000)) {
      setPairs([])
      toast(t('molbio.primers.regionTooLong'))

      return
    }

    const found = designPrimers(
      draft.residues.toUpperCase(),
      { start, end },
      {
        optTm,
        minTm: optTm - 3,
        maxTm: optTm + 3,
        maxProduct: numberOr(maxProduct, 2000),
        minProduct: Math.min(100, end - start),
      },
      { flank: flank ? 60 : 0 },
    )

    setPairs(found)

    if (found.length === 0) toast(t('molbio.primers.nonFound'))
  }

  const keep = (pair: PrimerPair, rank: number) => {
    if (primers.length + 2 > MAX_PRIMERS) {
      toast.error(t('molbio.primers.tooMany'))

      return
    }

    const base = draft.name || draft.title || t('molbio.sequenceFallback')
    const n = rank + 1

    edit((d) => ({
      ...d,
      primers: [
        ...(d.primers ?? []),
        {
          id: newId('primer'),
          name: `${base}-F${n}`,
          seq: tailF.toUpperCase() + pair.forward.seq,
          start: pair.forward.start + 1,
          end: pair.forward.end,
          strand: 1,
        },
        {
          id: newId('primer'),
          name: `${base}-R${n}`,
          seq: tailR.toUpperCase() + pair.reverse.seq,
          start: pair.reverse.start + 1,
          end: pair.reverse.end,
          strand: -1,
        },
      ],
    }))
  }

  return (
    <Panel
      title={t('molbio.primers.design')}
      hint={t('molbio.primers.designHint')}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('molbio.primers.targetFrom')} className="w-28">
          <Input
            inputMode="numeric"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={t('molbio.primers.targetTo')} className="w-28">
          <Input
            inputMode="numeric"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {draft.features.length > 0 ? (
          <Field label={t('molbio.primers.fromFeature')} className="w-48">
            <Select
              value=""
              onChange={(e) => {
                const ft = draft.features.find(
                  (x) => String(x.id) === e.target.value,
                )

                if (ft && ft.start <= ft.end) {
                  setFrom(String(ft.start))
                  setTo(String(ft.end))
                }
              }}
            >
              <option value="">{t('molbio.primers.pickFeature')}</option>
              {draft.features
                .filter((x) => x.start <= x.end)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('molbio.primers.tm')} className="w-24">
          <Input
            inputMode="decimal"
            value={tm}
            onChange={(e) => setTm(e.target.value)}
          />
        </Field>
        <Field label={t('molbio.primers.maxProduct')} className="w-28">
          <Input
            inputMode="numeric"
            value={maxProduct}
            onChange={(e) => setMaxProduct(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('molbio.primers.tailForward')}
          hint={t('molbio.primers.tailHint')}
          className="w-56"
        >
          <Input
            className="font-mono"
            value={tailF}
            onChange={(e) => setTailF(cleanDna(e.target.value))}
          />
        </Field>
        <Field label={t('molbio.primers.tailReverse')} className="w-56">
          <Input
            className="font-mono"
            value={tailR}
            onChange={(e) => setTailR(cleanDna(e.target.value))}
          />
        </Field>
        <label className="flex items-center gap-2 pb-1 text-label">
          <Checkbox checked={flank} onCheckedChange={setFlank} />
          {t('molbio.primers.flank')}
        </label>
        <Button variant="primary" icon="spark" onClick={design}>
          {t('molbio.primers.run')}
        </Button>
      </div>
      {pairs ? (
        <DataTable
          caption={t('molbio.primers.pairs')}
          rows={pairs}
          rowKey={(_, i) => String(i)}
          empty={t('molbio.primers.nonFound')}
          columns={[
            { key: 'n', head: '#', cell: (_, i) => i + 1 },
            {
              key: 'f',
              head: t('molbio.primers.forward'),
              className: 'font-mono',
              cell: (p) => (
                <span>
                  <span className="text-fg-muted">{tailF}</span>
                  {p.forward.seq}
                </span>
              ),
            },
            {
              key: 'ftm',
              head: t('molbio.primers.columns.tm'),
              align: 'right',
              cell: (p) => fixed(p.forward.tm),
            },
            {
              key: 'r',
              head: t('molbio.primers.reverse'),
              className: 'font-mono',
              cell: (p) => (
                <span>
                  <span className="text-fg-muted">{tailR}</span>
                  {p.reverse.seq}
                </span>
              ),
            },
            {
              key: 'rtm',
              head: t('molbio.primers.columns.tm'),
              align: 'right',
              cell: (p) => fixed(p.reverse.tm),
            },
            {
              key: 'size',
              head: t('molbio.primers.columns.product'),
              align: 'right',
              cell: (p) =>
                t('sequences.summary.length.dna', { count: p.productSize }),
            },
            {
              key: 'warn',
              head: t('molbio.primers.columns.checks'),
              cell: (p) => {
                const w = [
                  ...new Set([
                    ...p.forward.warnings,
                    ...p.reverse.warnings,
                    ...p.warnings,
                  ]),
                ]

                return w.length === 0
                  ? t('molbio.primers.clean')
                  : warningText(w)
              },
            },
            {
              key: 'keep',
              head: '',
              align: 'right',
              cell: (p, i) => (
                <Button
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => keep(p, i)}
                >
                  {t('molbio.primers.keep')}
                </Button>
              ),
            },
          ]}
        />
      ) : null}
    </Panel>
  )
}
