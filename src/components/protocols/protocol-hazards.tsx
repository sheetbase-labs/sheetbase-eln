import { useQuery } from '@tanstack/react-query'

import {
  HazardPictograms,
  SignalWordBadge,
  sheetHref,
} from '#/components/materials/material-safety'
import { ObjectLink } from '#/components/ui/object-link'
import { Section } from '#/components/ui/layout'
import { t } from '#/copy'
import { listByIds } from '#/lib/chunk-ids'
import {
  fetchMaterialSafetyFor,
  hazardStatementText,
  isHazardous,
  materialSafetyKeys,
} from '#/lib/material-safety'
import type { GhsPictogram } from '#/lib/material-safety'
import { notebookDataClient } from '#/lib/notebook-data'

interface MaterialName {
  id: string
  identifier: string
  title: string
}

/**
 * The hazards of the materials a protocol uses, taken from its material links, so a
 * person reading the protocol sees what they will be handling before they start.
 * Nothing shows for a protocol that links no materials.
 */
export function ProtocolHazards({
  links,
}: {
  links: readonly { targetKind: string; targetRecordId: string | null }[]
}) {
  const ids = [
    ...new Set(
      links
        .filter((link) => link.targetKind === 'material')
        .map((link) => link.targetRecordId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const names = useQuery({
    queryKey: ['protocol-hazards', 'names', ids.join(',')],
    queryFn: () =>
      listByIds(ids, (inList) =>
        notebookDataClient.list<MaterialName>(
          'records',
          `?id=in.(${inList})&select=id,identifier,title`,
        ),
      ),
    enabled: ids.length > 0,
  })

  const safety = useQuery({
    queryKey: materialSafetyKeys.many(ids),
    queryFn: () => fetchMaterialSafetyFor(notebookDataClient, ids),
    enabled: ids.length > 0,
  })

  if (ids.length === 0 || !names.data || !safety.data) return null

  const rows = names.data
    .map((material) => ({ material, safety: safety.data.get(material.id) }))
    .filter(({ safety: s }) => isHazardous(s))
    .sort((a, b) => a.material.title.localeCompare(b.material.title))

  const all: GhsPictogram[] = []
  const seen = new Set<GhsPictogram>()

  for (const { safety: s } of rows) {
    for (const code of s?.pictograms ?? []) {
      if (seen.has(code)) continue

      seen.add(code)
      all.push(code)
    }
  }

  return (
    <Section title={t('safety.protocol.title')} count={rows.length}>
      {rows.length === 0 ? (
        <p className="text-label text-fg-muted">{t('safety.protocol.none')}</p>
      ) : (
        <div className="flex flex-col gap-3" data-slot="protocol-hazards">
          <div className="flex items-center gap-3">
            <HazardPictograms pictograms={all} size={34} />
            <span className="text-label text-fg-muted">
              {t('safety.protocol.description')}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border">
            {rows.map(({ material, safety: s }) => (
              <li
                key={material.id}
                className="flex flex-col gap-1 px-3 py-2 text-label"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ObjectLink kind="material" id={material.id} mono={false}>
                    <span className="font-medium">{material.title}</span>
                  </ObjectLink>
                  <span className="mono text-fg-muted">
                    {material.identifier}
                  </span>
                  {s?.signalWord ? (
                    <SignalWordBadge word={s.signalWord} />
                  ) : null}
                  <HazardPictograms
                    pictograms={s?.pictograms ?? []}
                    size={20}
                    className="ml-auto"
                  />
                </div>
                {s && s.hazardStatements.length > 0 ? (
                  <p className="text-fg-muted">
                    {s.hazardStatements
                      .map((code) => `${code} ${hazardStatementText(code)}`)
                      .join(' · ')}
                  </p>
                ) : null}
                {s?.sheet ? (
                  <a
                    href={sheetHref(s.sheet.fileRecordId)}
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit hover:underline"
                  >
                    {t('safety.protocol.sheet')}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}
