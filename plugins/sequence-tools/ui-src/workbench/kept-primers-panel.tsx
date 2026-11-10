import { useState } from 'react'

import { Button, IconButton, Input } from '../ui/kit'
import { t } from '#/copy'
import { analysePrimer, cleanDna, findBindingSites } from '#/lib/molbio'
import { newId } from '#/lib/sequence-block'
import type { SavedPrimer, SequenceBlockPayload } from '#/lib/sequence-block'
import type { WorkbenchProps } from './shared'
import { DataTable, Panel, fixed } from './shared'
import { warningText } from './primer-format'

/**
 * The primers kept on this sequence: add one you already have (by name and
 * sequence), read back its length, melting temperature, GC and warnings, see
 * where each binds, and remove the ones that will not do.
 */
export function KeptPrimersPanel({
  draft,
  edit,
  canEdit,
}: {
  draft: SequenceBlockPayload
  edit: WorkbenchProps['edit']
  canEdit: boolean
}) {
  const [own, setOwn] = useState('')
  const [ownName, setOwnName] = useState('')
  const primers = draft.primers ?? []
  const circular = draft.topology === 'circular'

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

  const bindings = (p: SavedPrimer) =>
    /^[ACGT]+$/i.test(p.seq)
      ? findBindingSites(draft.residues.toUpperCase(), p.seq, circular)
      : []

  return (
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
            cell: (p) => <span className="font-medium text-fg">{p.name}</span>,
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

              return w.length === 0 ? t('molbio.primers.clean') : warningText(w)
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
  )
}
