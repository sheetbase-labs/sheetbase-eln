import { useQuery } from '@tanstack/react-query'
import { ObjectLink } from '#/components/ui/object-link'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import { InspectorSection } from '#/components/ui/layout'
import { closenessLabel } from '#/components/search/semantic-hits'
import { SearchResultIcon } from '#/components/search/result-icon'
import { notebookDataClient } from '#/lib/notebook-data'
import { openAssistant } from '#/lib/assistant-context'
import { fetchSimilarWork } from '#/lib/similar-work'
import { getSemanticSettingsFn } from '#/lib/semantic-search-actions'
import type { SearchResultType } from '#/lib/search'
import { t } from '#/copy'

function toneFor(similarity: number) {
  if (similarity >= 0.6) return 'ok' as const

  if (similarity >= 0.45) return 'progress' as const

  return 'none' as const
}

/**
 * "Have we done this before?": earlier work that reads like this experiment or
 * dataset, from the vectors already stored (no model call), under the person's
 * own access. Absent when the lab has not turned on search by meaning.
 */
export function SimilarWorkPanel({
  workspaceId,
  objectType,
  objectId,
  identifier,
  title,
}: {
  workspaceId: string
  objectType: SearchResultType
  objectId: string
  identifier: string
  title: string
}) {
  const settings = useQuery({
    queryKey: ['semantic-settings', workspaceId],
    queryFn: () => getSemanticSettingsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const enabled = settings.data?.settings.enabled === true

  const similar = useQuery({
    queryKey: ['similar-work', workspaceId, objectType, objectId],
    queryFn: () => fetchSimilarWork(notebookDataClient, objectType, objectId),
    enabled: enabled && Boolean(objectId),
    staleTime: 60_000,
  })

  if (!enabled) return null
  const hits = similar.data ?? []

  return (
    <InspectorSection title={t('projects.searchMeaning.similarTitle')}>
      <div data-testid="similar-work" className="flex flex-col gap-1">
        {similar.isPending ? (
          <p className="m-0 text-label text-fg-muted">
            {t('projects.searchMeaning.similarLoading')}
          </p>
        ) : hits.length === 0 ? (
          <p className="m-0 text-label text-fg-muted">
            {t('projects.searchMeaning.similarEmpty')}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {hits.map((hit) => (
              <li
                key={`${hit.type}-${hit.id}`}
                className="flex items-center gap-2 border-b border-border-subtle py-1.5 last:border-b-0"
              >
                <SearchResultIcon
                  result={{
                    resultType: hit.type,
                    kind: hit.kind,
                    matchedField: 'description',
                  }}
                />
                <ObjectLink
                  kind={hit.type === 'record' ? hit.kind : hit.type}
                  id={hit.id}
                  identifier={hit.identifier}
                  className="shrink-0 text-fg-muted"
                />
                <Link
                  to={hit.deepLink}
                  className="line-clamp-2 min-w-0 flex-1 text-fg hover:text-link"
                  title={hit.passage}
                >
                  {hit.title}
                </Link>
                <Status tone={toneFor(hit.similarity)}>
                  {closenessLabel(hit.similarity)}
                </Status>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            size="sm"
            variant="quiet"
            icon="spark"
            onClick={() =>
              openAssistant({
                prompt: t('projects.searchMeaning.askPrompt', {
                  identifier,
                  title,
                }),
              })
            }
          >
            {t('projects.searchMeaning.askAbout')}
          </Button>
        </div>
      </div>
    </InspectorSection>
  )
}
