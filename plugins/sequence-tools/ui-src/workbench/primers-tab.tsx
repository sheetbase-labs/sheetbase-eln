/**
 * Primers: design pairs for a region, check any primer you already have, keep
 * the ones you will order, and simulate the PCR to see what they make.
 */
import { useMemo, useState } from 'react'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { IconButton } from '#/components/ui/icon-button'
import { Input, Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  analysePrimer,
  cleanDna,
  designPrimers,
  findBindingSites,
  simulatePcr,
} from '#/lib/molbio'
import type { PrimerPair } from '#/lib/molbio'
import { MAX_PRIMERS, newId } from '#/lib/sequence-block'
import type { SavedPrimer } from '#/lib/sequence-block'
import { DataTable, Panel, fixed } from './shared'
import type { WorkbenchProps } from './shared'

function warningText(codes: readonly string[]): string {
  return codes
    .map((c) => t(`molbio.primers.warning.${c}` as 'molbio.primers.warning.gc'))
    .join(', ')
}

function numberOr(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function PrimersTab({ draft, edit, canEdit }: WorkbenchProps) {
  const len = draft.residues.length
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(Math.min(len, 1000) || 1))
  const [flank, setFlank] = useState(false)
  const [tm, setTm] = useState('60')
  const [maxProduct, setMaxProduct] = useState('2000')
  const [tailF, setTailF] = useState('')
  const [tailR, setTailR] = useState('')
  const [pairs, setPairs] = useState<PrimerPair[] | null>(null)
  const [own, setOwn] = useState('')
  const [ownName, setOwnName] = useState('')
  const [fwdId, setFwdId] = useState('')
  const [revId, setRevId] = useState('')
  const primers = draft.primers ?? []
  const circular = draft.topology === 'circular'
  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>
  if (len === 0) return <Notice>{t('molbio.enzymes.empty')}</Notice>

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

  const ownSeq = cleanDna(own)
  const ownReport =
    ownSeq.length >= 10 && /^[ACGT]+$/.test(ownSeq)
      ? analysePrimer(ownSeq)
      : null
  const addOwn = () => {
    if (!ownReport) return
    edit((d) => ({
      ...d,
      primers: [
        ...(d.primers ?? []),
        {
          id: newId('primer'),
          name:
            ownName.trim() ||
            t('molbio.primers.unnamed', {
              number: (d.primers?.length ?? 0) + 1,
            }),
          seq: ownSeq,
        },
      ],
    }))
    setOwn('')
    setOwnName('')
  }

  const f = primers.find((p) => p.id === fwdId)
  const r = primers.find((p) => p.id === revId)
  const products = useMemo(
    () =>
      f && r
        ? simulatePcr(draft.residues.toUpperCase(), f.seq, r.seq, circular)
        : null,
    [f, r, draft.residues, circular],
  )

  const bindings = (p: SavedPrimer) =>
    /^[ACGT]+$/i.test(p.seq)
      ? findBindingSites(draft.residues.toUpperCase(), p.seq, circular)
      : []

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? (
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
      ) : null}

      <Panel
        title={t('molbio.primers.kept', { count: primers.length })}
        hint={t('molbio.primers.keptHint')}
      >
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input
              aria-label={t('molbio.primers.name')}
              placeholder={t('molbio.primers.name')}
              className="w-40"
              value={ownName}
              onChange={(e) => setOwnName(e.target.value)}
            />
            <Input
              aria-label={t('molbio.primers.sequence')}
              placeholder={t('molbio.primers.sequencePlaceholder')}
              className="min-w-56 flex-1 font-mono"
              value={own}
              onChange={(e) => setOwn(e.target.value)}
            />
            <Button disabled={!ownReport} onClick={addOwn}>
              {t('molbio.primers.add')}
            </Button>
          </div>
        ) : null}
        {ownReport ? (
          <p className="num text-label text-fg-muted">
            {t('molbio.primers.report', {
              length: ownReport.length,
              tm: fixed(ownReport.tm),
              gc: fixed(ownReport.gc),
            })}
            {ownReport.warnings.length > 0
              ? ` · ${warningText(ownReport.warnings)}`
              : ` · ${t('molbio.primers.clean')}`}
          </p>
        ) : null}
        <DataTable
          caption={t('molbio.primers.keptCaption')}
          rows={primers}
          rowKey={(p) => p.id}
          empty={t('molbio.primers.noneKept')}
          columns={[
            {
              key: 'name',
              head: t('molbio.primers.name'),
              cell: (p) => (
                <span className="font-medium text-fg">{p.name}</span>
              ),
            },
            {
              key: 'seq',
              head: t('molbio.primers.sequence'),
              className: 'font-mono',
              cell: (p) => p.seq,
            },
            {
              key: 'len',
              head: t('molbio.primers.columns.length'),
              align: 'right',
              cell: (p) => p.seq.length,
            },
            {
              key: 'tm',
              head: t('molbio.primers.columns.tm'),
              align: 'right',
              cell: (p) =>
                /^[ACGT]+$/i.test(p.seq) ? fixed(analysePrimer(p.seq).tm) : '—',
            },
            {
              key: 'gc',
              head: t('molbio.primers.columns.gc'),
              align: 'right',
              cell: (p) =>
                /^[ACGT]+$/i.test(p.seq)
                  ? `${fixed(analysePrimer(p.seq).gc)}%`
                  : '—',
            },
            {
              key: 'binds',
              head: t('molbio.primers.columns.binds'),
              cell: (p) => {
                const b = bindings(p)
                if (b.length === 0) return t('molbio.primers.noSite')
                return b
                  .map(
                    (x) =>
                      `${x.start + 1}..${x.end}${x.strand === -1 ? ' ←' : ' →'}`,
                  )
                  .join(', ')
              },
            },
            {
              key: 'checks',
              head: t('molbio.primers.columns.checks'),
              cell: (p) => {
                if (!/^[ACGT]+$/i.test(p.seq)) return '—'
                const w = analysePrimer(p.seq).warnings
                return w.length === 0
                  ? t('molbio.primers.clean')
                  : warningText(w)
              },
            },
            ...(canEdit
              ? [
                  {
                    key: 'x',
                    head: '',
                    align: 'right' as const,
                    cell: (p: SavedPrimer) => (
                      <IconButton
                        label={t('molbio.primers.remove')}
                        icon="x"
                        onClick={() =>
                          edit((d) => ({
                            ...d,
                            primers: (d.primers ?? []).filter(
                              (q) => q.id !== p.id,
                            ),
                          }))
                        }
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      {primers.length >= 2 ? (
        <Panel
          title={t('molbio.primers.pcr')}
          hint={t('molbio.primers.pcrHint')}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('molbio.primers.forward')} className="w-48">
              <Select value={fwdId} onChange={(e) => setFwdId(e.target.value)}>
                <option value="">{t('molbio.primers.choose')}</option>
                {primers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('molbio.primers.reverse')} className="w-48">
              <Select value={revId} onChange={(e) => setRevId(e.target.value)}>
                <option value="">{t('molbio.primers.choose')}</option>
                {primers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {products ? (
            <DataTable
              caption={t('molbio.primers.products')}
              rows={products}
              rowKey={(p) => `${p.start}-${p.end}-${p.size}`}
              empty={t('molbio.primers.noProduct')}
              columns={[
                {
                  key: 'size',
                  head: t('molbio.primers.columns.product'),
                  align: 'right',
                  cell: (p) =>
                    t('sequences.summary.length.dna', { count: p.size }),
                },
                {
                  key: 'span',
                  head: t('molbio.primers.columns.span'),
                  cell: (p) => `${p.start + 1}..${p.end}`,
                },
              ]}
            />
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
