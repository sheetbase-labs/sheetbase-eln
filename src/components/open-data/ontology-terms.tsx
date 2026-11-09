import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  fetchAnnotations,
  fetchOntologySettings,
  linkOntologyTerm,
  openDataKeys,
  searchOntology,
  unlinkOntologyTerm,
  describeOpenDataError,
} from '#/lib/open-data/client'
import type {
  OntologyAnnotation,
  OntologyTermHit,
} from '#/lib/open-data/client'
import { t } from '#/copy'

const dataClient = createDataClient()

/**
 * Standard terms attached to a field or a vocabulary term. The search box only
 * appears when the workspace has turned ontology lookup on; existing links are
 * always listed. Each term links to its page in the ontology.
 */
export function OntologyTerms({
  workspaceId,
  kind,
  targetId,
  canEdit,
}: {
  workspaceId: string
  kind: OntologyAnnotation['target_kind']
  targetId: string
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: openDataKeys.ontology(workspaceId),
    queryFn: () => fetchOntologySettings(dataClient, workspaceId),
  })

  const linked = useQuery({
    queryKey: openDataKeys.annotations(kind, targetId),
    queryFn: () => fetchAnnotations(dataClient, kind, targetId),
  })

  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [hits, setHits] = useState<OntologyTermHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (text.trim().length < 2) {
      setHits(null)

      return
    }

    const controller = new AbortController()

    const timer = setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      searchOntology(text.trim(), controller.signal)
        .then(setHits)
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setSearchError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => setSearching(false))
    }, 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: openDataKeys.annotations(kind, targetId),
    })

  const link = useMutation({
    mutationFn: (term: OntologyTermHit) =>
      linkOntologyTerm(dataClient, { workspaceId, kind, targetId, term }),
    onSuccess: () => {
      setAdding(false)
      setText('')
      void invalidate()
    },
    onError: (e) =>
      toast(`${t('openData.picker.failed')}: ${describeOpenDataError(e)}`),
  })

  const unlink = useMutation({
    mutationFn: (id: string) => unlinkOntologyTerm(dataClient, id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast(describeOpenDataError(e)),
  })

  const rows = linked.data ?? []
  const lookupOn = settings.data?.enabled === true

  if (!lookupOn && rows.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 ? <Muted>{t('openData.picker.none')}</Muted> : null}
      {rows.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-body">
          <a
            href={a.iri}
            target="_blank"
            rel="noreferrer"
            title={a.iri}
            className="min-w-0 truncate"
          >
            {a.label}
          </a>
          <span className="text-label text-fg-muted uppercase">
            {a.ontology}
          </span>
          {canEdit ? (
            <Button
              size="sm"
              variant="quiet"
              className="ml-auto"
              aria-label={`${t('openData.picker.remove')}: ${a.label}`}
              onClick={() => unlink.mutate(a.id)}
            >
              {t('openData.picker.remove')}
            </Button>
          ) : null}
        </div>
      ))}
      {canEdit && lookupOn ? (
        adding ? (
          <div className="flex flex-col gap-1.5">
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('openData.picker.search')}
              aria-label={t('openData.picker.search')}
            />
            {searching ? <Muted>{t('openData.picker.searching')}</Muted> : null}
            {searchError ? <Muted role="alert">{searchError}</Muted> : null}
            {hits && !searching && hits.length === 0 ? (
              <Muted>{t('openData.picker.noMatch')}</Muted>
            ) : null}
            {hits && hits.length > 0 ? (
              <ul className="m-0 flex max-h-56 list-none flex-col overflow-y-auto rounded-md border border-border p-0">
                {hits.map((h) => (
                  <li key={h.iri}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-surface-hover"
                      onClick={() => link.mutate(h)}
                    >
                      <span className="line-clamp-2 break-words">
                        {h.label}{' '}
                        <span className="text-label text-fg-muted uppercase">
                          {h.ontology}
                        </span>
                      </span>
                      {h.description ? (
                        <span className="line-clamp-2 text-label text-fg-muted">
                          {h.description}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setAdding(false)}
              >
                {t('common.actions.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              {t('openData.picker.add')}
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}
