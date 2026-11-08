/**
 * Virtual digest: cut with the enzymes you choose, list the pieces and draw
 * the gel they would make next to a ladder.
 */
import { useMemo, useState } from 'react'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import { digest, formatBp, uniqueCutters } from '#/lib/molbio'
import type { Fragment } from '#/lib/molbio'
import { useAllSites } from './enzymes-tab'
import { EnzymePicker } from './enzyme-picker'
import { Gel } from './gel'
import { DataTable, Panel } from './shared'
import type { WorkbenchProps } from './shared'

function endLabel(e: Fragment['left'], enzyme: string | null): string {
  if (!enzyme) return t('molbio.digest.endOfSequence')
  if (e.kind === 'blunt') return t('molbio.digest.endBlunt', { enzyme })
  return t(e.kind === '5prime' ? 'molbio.digest.end5' : 'molbio.digest.end3', {
    enzyme,
    bases: e.sense,
  })
}

export function digestFragments(
  residues: string,
  topology: 'linear' | 'circular',
  enzymes: readonly string[],
): Fragment[] {
  if (enzymes.length === 0 || residues.length === 0) return []
  return digest(residues.toUpperCase(), topology, enzymes).sort(
    (a, b) => b.size - a.size,
  )
}

export function DigestTab({ draft, edit, canEdit }: WorkbenchProps) {
  const [enzymes, setEnzymes] = useState<string[]>([])
  const [ladder, setLadder] = useState<'1kb' | '100bp'>('1kb')
  const all = useAllSites(draft)
  const unique = useMemo(
    () => uniqueCutters(all).map((s) => s.enzyme.name),
    [all],
  )
  const frags = useMemo(
    () => digestFragments(draft.residues, draft.topology, enzymes),
    [draft.residues, draft.topology, enzymes],
  )
  const kept = draft.digests ?? []
  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>
  if (draft.residues.length === 0)
    return <Notice>{t('molbio.enzymes.empty')}</Notice>
  const keep = () =>
    edit((d) => ({
      ...d,
      digests: [...(d.digests ?? []), { enzymes: [...enzymes], ladder }],
    }))
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={t('molbio.digest.enzymes')}
        hint={t('molbio.digest.enzymesHint')}
      >
        <EnzymePicker
          selected={enzymes}
          uniqueCutters={unique}
          onChange={setEnzymes}
        />
      </Panel>
      {enzymes.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <Panel
            title={t('molbio.digest.fragments', { count: frags.length })}
            actions={
              canEdit ? (
                <Button size="sm" icon="plus" onClick={keep}>
                  {t('molbio.digest.keep')}
                </Button>
              ) : null
            }
          >
            <DataTable
              caption={t('molbio.digest.fragmentsCaption')}
              rows={frags}
              rowKey={(_, i) => String(i)}
              empty={t('molbio.digest.noFragments')}
              columns={[
                { key: 'n', head: '#', cell: (_, i) => i + 1 },
                {
                  key: 'size',
                  head: t('molbio.digest.columns.size'),
                  align: 'right',
                  cell: (f) => formatBp(f.size),
                },
                {
                  key: 'from',
                  head: t('molbio.digest.columns.from'),
                  cell: (f) => endLabel(f.left, f.leftEnzyme),
                },
                {
                  key: 'to',
                  head: t('molbio.digest.columns.to'),
                  cell: (f) => endLabel(f.right, f.rightEnzyme),
                },
              ]}
            />
          </Panel>
          <Panel
            title={t('molbio.digest.gel')}
            actions={
              <Tabs
                mode="state"
                variant="segment"
                label={t('molbio.digest.ladder')}
                value={ladder}
                onValueChange={(k) => setLadder(k as '1kb' | '100bp')}
                items={[
                  { key: '1kb', label: t('molbio.digest.ladder1kb') },
                  { key: '100bp', label: t('molbio.digest.ladder100') },
                ]}
              />
            }
          >
            <Gel
              ladder={ladder}
              lanes={[
                {
                  label: t('molbio.digest.uncut'),
                  sizes: [draft.residues.length],
                },
                { label: enzymes.join('+'), sizes: frags.map((f) => f.size) },
              ]}
            />
          </Panel>
        </div>
      ) : (
        <Notice>{t('molbio.digest.pickToStart')}</Notice>
      )}
      {kept.length > 0 ? (
        <Panel
          title={t('molbio.digest.kept')}
          hint={t('molbio.digest.keptHint')}
        >
          <div className="flex flex-wrap gap-4">
            {kept.map((k, i) => {
              const f = digestFragments(
                draft.residues,
                draft.topology,
                k.enzymes,
              )
              return (
                <div
                  key={`${k.enzymes.join('+')}-${i}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center gap-1 text-label text-fg-muted">
                    <span className="font-medium text-fg">
                      {k.enzymes.join(' + ')}
                    </span>
                    {canEdit ? (
                      <IconButton
                        label={t('molbio.digest.removeKept')}
                        icon="x"
                        onClick={() =>
                          edit((d) => ({
                            ...d,
                            digests: (d.digests ?? []).filter(
                              (_, j) => j !== i,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </div>
                  <Gel
                    ladder={k.ladder}
                    className="w-56"
                    lanes={[
                      {
                        label: t('molbio.digest.uncut'),
                        sizes: [draft.residues.length],
                      },
                      {
                        label: k.enzymes.join('+'),
                        sizes: f.map((x) => x.size),
                      },
                    ]}
                  />
                </div>
              )
            })}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
