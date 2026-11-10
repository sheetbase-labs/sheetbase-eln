/**
 * CRISPR guides: the sites next to a nuclease's PAM in a region, with a plain
 * screen and a count of near matches inside this sequence.
 */
import { useState } from 'react'

import { Button, Field, Input, Notice, Select, toast } from '../ui/kit'
import { t } from '#/copy'
import { NUCLEASES, addFeature, findGuides, nucleaseByKey } from '#/lib/molbio'
import type { Guide } from '#/lib/molbio'
import { DataTable, Panel } from './shared'
import type { WorkbenchProps } from './shared'

function numberOr(text: string, fallback: number): number {
  const n = Number.parseInt(text, 10)

  return Number.isFinite(n) ? n : fallback
}

export function GuidesTab({ draft, edit, canEdit }: WorkbenchProps) {
  const len = draft.residues.length
  const [nuclease, setNuclease] = useState<string>(NUCLEASES[0].key)
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(len || 1))
  const [guides, setGuides] = useState<Guide[] | null>(null)

  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>

  if (len === 0) return <Notice>{t('molbio.enzymes.empty')}</Notice>

  const run = () => {
    const start = Math.max(1, Math.min(len, numberOr(from, 1)))
    const end = Math.max(start, Math.min(len, numberOr(to, len)))
    setGuides(
      findGuides(
        draft.residues,
        draft.topology,
        nucleaseByKey(nuclease) ?? NUCLEASES[0],
        { region: { start, end }, limit: 25 },
      ),
    )
  }

  const mark = (g: Guide) => {
    edit((d) => {
      const next = addFeature(
        {
          residues: d.residues,
          topology: d.topology,
          features: d.features,
        },
        {
          type: 'misc_feature',
          label: `gRNA ${g.protospacer.slice(0, 8)}`,
          strand: g.strand,
          start: g.start,
          end: g.end,
          qualifiers: { note: `${g.protospacer} ${g.pam}` },
        },
      )

      return { ...d, features: next.features }
    })
    toast(t('molbio.guides.marked'))
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('molbio.guides.title')} hint={t('molbio.guides.hint')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('molbio.guides.nuclease')} className="w-52">
            <Select
              value={nuclease}
              onChange={(e) => setNuclease(e.target.value)}
            >
              {NUCLEASES.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('molbio.guides.from')} className="w-28">
            <Input
              inputMode="numeric"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={t('molbio.guides.to')} className="w-28">
            <Input
              inputMode="numeric"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Button variant="primary" icon="spark" onClick={run}>
            {t('molbio.guides.run')}
          </Button>
        </div>
      </Panel>
      {guides ? (
        <DataTable
          caption={t('molbio.guides.title')}
          rows={guides}
          rowKey={(g) => `${g.strand}-${g.start}`}
          empty={t('molbio.guides.none')}
          columns={[
            {
              key: 'guide',
              head: t('molbio.guides.columns.guide'),
              className: 'font-mono',
              cell: (g) => g.protospacer,
            },
            {
              key: 'pam',
              head: t('molbio.guides.columns.pam'),
              className: 'font-mono',
              cell: (g) => g.pam,
            },
            {
              key: 'strand',
              head: t('molbio.guides.columns.strand'),
              cell: (g) =>
                g.strand === 1
                  ? t('molbio.guides.forward')
                  : t('molbio.guides.reverse'),
            },
            {
              key: 'pos',
              head: t('molbio.guides.columns.position'),
              cell: (g) => `${g.start}..${g.end}`,
            },
            {
              key: 'cut',
              head: t('molbio.guides.columns.cut'),
              align: 'right',
              cell: (g) => g.cutAfter,
            },
            {
              key: 'gc',
              head: t('molbio.guides.columns.gc'),
              align: 'right',
              cell: (g) => `${Math.round(g.gc * 100)}%`,
            },
            {
              key: 'score',
              head: t('molbio.guides.columns.score'),
              align: 'right',
              cell: (g) => g.score,
            },
            {
              key: 'off',
              head: (
                <span title={t('molbio.guides.offTargetsHint')}>
                  {t('molbio.guides.columns.offTargets')}
                </span>
              ),
              className: 'font-mono',
              cell: (g) => g.offTargets.join(' · '),
            },
            {
              key: 'notes',
              head: t('molbio.guides.columns.notes'),
              cell: (g) =>
                g.warnings
                  .map((w) => t(`molbio.guides.warnings.${w}`))
                  .join(', ') || '—',
            },
            ...(canEdit
              ? [
                  {
                    key: 'mark',
                    head: '',
                    cell: (g: Guide) => (
                      <Button onClick={() => mark(g)}>
                        {t('molbio.guides.mark')}
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </div>
  )
}
