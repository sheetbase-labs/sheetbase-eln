import { useMemo, useState } from 'react'

import { Field, Select } from '../ui/kit'
import { t } from '#/copy'
import { simulatePcr } from '#/lib/molbio'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { DataTable, Panel } from './shared'

/**
 * Simulate the PCR: choose a forward and a reverse primer from the kept ones
 * and see the products they would make on this sequence. It only appears once
 * two primers are kept, because one primer makes nothing.
 */
export function PrimerPcrPanel({ draft }: { draft: SequenceBlockPayload }) {
  const [fwdId, setFwdId] = useState('')
  const [revId, setRevId] = useState('')
  const primers = draft.primers ?? []
  const circular = draft.topology === 'circular'
  const f = primers.find((p) => p.id === fwdId)
  const r = primers.find((p) => p.id === revId)

  const products = useMemo(
    () =>
      draft.molecule !== 'protein' && draft.residues.length > 0 && f && r
        ? simulatePcr(draft.residues.toUpperCase(), f.seq, r.seq, circular)
        : null,
    [f, r, draft.molecule, draft.residues, circular],
  )

  return (
    <Panel title={t('molbio.primers.pcr')} hint={t('molbio.primers.pcrHint')}>
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
              cell: (p) => t('sequences.summary.length.dna', { count: p.size }),
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
  )
}
