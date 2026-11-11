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

/** One linked term: its page in the ontology, its source and, for an editor,
 * the control that detaches it. */
function LinkedTermRow({
  annotation,
  canEdit,
  onRemove,
}: {
  annotation: OntologyAnnotation
  canEdit: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-body">
      <a
        href={annotation.iri}
        target="_blank"
        rel="noreferrer"
        title={annotation.iri}
        className="min-w-0 truncate"
      >
        {annotation.label}
      </a>
      <span className="text-label text-fg-muted uppercase">
        {annotation.ontology}
      </span>
      {canEdit ? (
        <Button
          size="sm"
          variant="quiet"
          className="ml-auto"
          aria-label={`${t('openData.picker.remove')}: ${annotation.label}`}
          onClick={onRemove}
        >
          {t('openData.picker.remove')}
        </Button>
      ) : null}
    </div>
  )
}

/** The term search: the box, the debounced lookup and its hits. */
function OntologyTermSearch({
  onPick,
  onCancel,
}: {
  onPick: (term: OntologyTermHit) => void
  onCancel: () => void
}) {
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
        .catch((e) => {
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

  return (
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
          {hits.map((hit) => (
            <li key={hit.iri}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-surface-hover"
                onClick={() => onPick(hit)}
              >
                <span className="line-clamp-2 break-words">
                  {hit.label}{' '}
                  <span className="text-label text-fg-muted uppercase">
                    {hit.ontology}
                  </span>
                </span>
                {hit.description ? (
                  <span className="line-clamp-2 text-label text-fg-muted">
                    {hit.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          {t('common.actions.cancel')}
        </Button>
      </div>
    </div>
  )
}

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

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: openDataKeys.annotations(kind, targetId),
    })

  const link = useMutation({
    mutationFn: (term: OntologyTermHit) =>
      linkOntologyTerm(dataClient, { workspaceId, kind, targetId, term }),
    onSuccess: () => {
      setAdding(false)
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
      {rows.map((annotation) => (
        <LinkedTermRow
          key={annotation.id}
          annotation={annotation}
          canEdit={canEdit}
          onRemove={() => unlink.mutate(annotation.id)}
        />
      ))}
      {canEdit && lookupOn ? (
        adding ? (
          <OntologyTermSearch
            onPick={(term) => link.mutate(term)}
            onCancel={() => setAdding(false)}
          />
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
