/**
 * The restriction map: pick enzymes, see where each one cuts, and which cut
 * the sequence once.
 */
import { useMemo, useState } from 'react'

import { Notice } from '#/components/ui/alert'
import { Tabs } from '#/components/ui/tabs'
import { t } from '#/copy'
import {
  COMMON_ENZYMES,
  ENZYMES,
  mapSites,
  overhangOf,
  uniqueCutters,
} from '#/lib/molbio'
import { EnzymePicker } from './enzyme-picker'
import { DataTable, Panel } from './shared'
import type { WorkbenchProps } from './shared'
import { SiteMap, sitesFromCuts } from './site-map'

type Show = 'chosen' | 'unique' | 'all'

export function useAllSites(draft: WorkbenchProps['draft']) {
  return useMemo(
    () =>
      draft.molecule === 'protein' || draft.residues.length === 0
        ? []
        : mapSites(draft.residues.toUpperCase(), draft.topology),
    [draft.residues, draft.topology, draft.molecule],
  )
}

export function EnzymesTab({ draft, edit, canEdit }: WorkbenchProps) {
  const all = useAllSites(draft)
  const chosen = draft.mapEnzymes ?? [...COMMON_ENZYMES]
  const [show, setShow] = useState<Show>('chosen')
  const unique = useMemo(
    () => uniqueCutters(all).map((s) => s.enzyme.name),
    [all],
  )
  const set = new Set(chosen)
  const rows = all.filter((s) =>
    show === 'chosen'
      ? set.has(s.enzyme.name)
      : show === 'unique'
        ? s.cuts.length === 1
        : true,
  )
  const mapped = all.filter((s) => set.has(s.enzyme.name) && s.cuts.length > 0)
  if (draft.molecule === 'protein')
    return <Notice>{t('molbio.enzymes.dnaOnly')}</Notice>
  if (draft.residues.length === 0)
    return <Notice>{t('molbio.enzymes.empty')}</Notice>
  return (
    <div className="flex flex-col gap-4">
      <SiteMap
        length={draft.residues.length}
        topology={draft.topology}
        name={draft.name || draft.title || t('molbio.sequenceFallback')}
        sites={sitesFromCuts(
          mapped.map((s) => ({ name: s.enzyme.name, cuts: s.cuts })),
        )}
      />
      <Panel
        title={t('molbio.enzymes.pick')}
        hint={t('molbio.enzymes.pickHint')}
      >
        <EnzymePicker
          selected={chosen}
          uniqueCutters={unique}
          disabled={!canEdit}
          onChange={(names) => edit((d) => ({ ...d, mapEnzymes: names }))}
        />
      </Panel>
      <Panel
        title={t('molbio.enzymes.sites')}
        actions={
          <Tabs
            mode="state"
            variant="segment"
            label={t('molbio.enzymes.show')}
            value={show}
            onValueChange={(k) => setShow(k as Show)}
            items={[
              { key: 'chosen', label: t('molbio.enzymes.showChosen') },
              { key: 'unique', label: t('molbio.enzymes.showUnique') },
              {
                key: 'all',
                label: t('molbio.enzymes.showAll', { count: ENZYMES.length }),
              },
            ]}
          />
        }
      >
        <DataTable
          caption={t('molbio.enzymes.sites')}
          rows={rows}
          rowKey={(r) => r.enzyme.name}
          empty={t('molbio.enzymes.noSites')}
          columns={[
            {
              key: 'enzyme',
              head: t('molbio.enzymes.columns.enzyme'),
              cell: (r) => (
                <span className="font-medium text-fg">{r.enzyme.name}</span>
              ),
            },
            {
              key: 'site',
              head: t('molbio.enzymes.columns.site'),
              cell: (r) => r.enzyme.site,
            },
            {
              key: 'ends',
              head: t('molbio.enzymes.columns.ends'),
              cell: (r) => {
                const d = overhangOf(r.enzyme)
                return d === 0
                  ? t('molbio.enzymes.blunt')
                  : d > 0
                    ? t('molbio.enzymes.fivePrime', { count: d })
                    : t('molbio.enzymes.threePrime', { count: -d })
              },
            },
            {
              key: 'cuts',
              head: t('molbio.enzymes.columns.cuts'),
              align: 'right',
              cell: (r) => r.cuts.length,
            },
            {
              key: 'positions',
              head: t('molbio.enzymes.columns.positions'),
              className: 'max-w-72 truncate',
              cell: (r) => r.cuts.map((c) => c.top).join(', ') || '—',
            },
          ]}
        />
      </Panel>
    </div>
  )
}
