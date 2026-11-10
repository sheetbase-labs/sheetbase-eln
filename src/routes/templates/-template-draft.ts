/**
 * The Sections view's draft: the edits a person makes to a template version
 * before they save it as a new version. A published version pins work already
 * made, so nothing here writes over the version it started from.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { toast } from '#/components/ui/sonner'
import {
  templateDataQueryKeys,
  useTemplate,
} from '#/components/templates/templates-data'
import type { TemplatePart } from '#/components/templates/template-parts'
import { createNotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import { notebookTemplateConfigurationSchema } from '#/lib/notebook-template'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from '#/lib/notebook-template'
import type { Parameter } from '#/lib/parameter'
import { t } from '#/copy'

/** The scalar value types a parameter may declare. */
type ScalarValueType = (typeof FIELD_LOGICAL_TYPES)[number]

/** Orders are unique positive integers, so every add, remove and move rewrites
 * them as 1..n. */
function withOrders(
  placements: NotebookTemplatePlacement[],
): NotebookTemplatePlacement[] {
  return placements.map((placement, index) => ({
    ...placement,
    order: index + 1,
  }))
}

/** The inline draft's state and every edit it accepts. */
export interface TemplateDraft {
  draft: NotebookTemplateConfiguration | null
  saveError: string | null
  saving: boolean
  /** The placements in display order, as the version or the draft holds them. */
  placements: NotebookTemplatePlacement[]
  /** The draft's placements in display order; empty while not editing. */
  editPlacements: NotebookTemplatePlacement[]
  parts: TemplatePart[]
  startEditing: () => void
  stopEditing: () => void
  saveDraft: () => void
  movePlacement: (index: number, delta: number) => void
  setPlacementPart: (id: string, partId: string | null) => void
  removePlacement: (id: string) => void
  addSection: (key: string, label: string) => void
  addParameter: (input: {
    key: string
    label: string
    required: boolean
    valueType: ScalarValueType
  }) => void
  removeParameter: (id: string) => void
  setParts: (next: TemplatePart[]) => void
  setSignOff: (on: boolean) => void
}

export function useTemplateDraft(
  templateId: string,
  version: NotebookTemplateVersion | undefined,
): TemplateDraft {
  const queryClient = useQueryClient()
  const template = useTemplate(templateId)
  const revision = template.data?.revision
  const [draft, setDraft] = useState<NotebookTemplateConfiguration | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const config = version?.configuration

  const placements = config
    ? [...config.placements].sort((a, b) => a.order - b.order)
    : []

  const save = useMutation({
    mutationFn: (configuration: NotebookTemplateConfiguration) => {
      if (revision === undefined)
        throw new Error(
          t('library.templates.overview.theTemplateIsStillLoading'),
        )

      return createNotebookTemplateVersion(templateId, revision, configuration)
    },
    onSuccess: (saved) => {
      // The header and the tab counts read this list, so show the saved version
      // now rather than after the invalidation's refetch lands. The refetch
      // still runs, so anything the server returns later wins.
      queryClient.setQueryData<NotebookTemplateVersion[]>(
        templateDataQueryKeys.versions(templateId),
        (current) =>
          [...(current ?? []).filter((v) => v.id !== saved.id), saved].sort(
            (a, b) => a.version - b.version,
          ),
      )
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.versions(templateId),
      })
      void queryClient.invalidateQueries({
        queryKey: templateDataQueryKeys.template(templateId),
      })
      setDraft(null)
      setSaveError(null)
      toast(
        t('library.templates.overview.savedAsV', { version: saved.version }),
        {
          description: t('library.templates.overview.itStaysADraftUntil'),
        },
      )
    },
    onError: (error) => {
      setSaveError(
        error instanceof Error
          ? error.message
          : t('library.templates.overview.couldNotSaveTheNew'),
      )
    },
  })

  const startEditing = () => {
    if (!config) return
    setSaveError(null)
    setDraft(structuredClone(config))
  }

  const stopEditing = () => {
    setDraft(null)
    setSaveError(null)
  }

  const editPlacements = draft
    ? [...draft.placements].sort((a, b) => a.order - b.order)
    : []

  const applyPlacements = (next: NotebookTemplatePlacement[]) => {
    if (!draft) return
    setDraft({ ...draft, placements: withOrders(next) })
  }

  const movePlacement = (index: number, delta: number) => {
    const target = index + delta

    if (target < 0 || target >= editPlacements.length) return

    const next = [...editPlacements]
    const moved = next[index]
    next[index] = next[target]
    next[target] = moved
    applyPlacements(next)
  }

  const parts = draft ? (draft.parts ?? []) : (config?.parts ?? [])

  const setParts = (next: TemplatePart[]) => {
    if (!draft) return

    const ids = new Set(next.map((part) => part.id))
    const { parts: _old, ...rest } = draft
    const nextDraft: NotebookTemplateConfiguration = { ...rest }

    if (next.length) nextDraft.parts = next

    setDraft({
      ...nextDraft,
      // A section whose part was removed goes back to the first part.
      placements: draft.placements.map((placement) =>
        placement.kind !== 'section_placeholder' &&
        placement.partId &&
        !ids.has(placement.partId)
          ? { ...placement, partId: undefined }
          : placement,
      ),
    })
  }

  const setPlacementPart = (id: string, partId: string | null) => {
    if (!draft) return

    setDraft({
      ...draft,
      placements: draft.placements.map((placement) =>
        placement.id === id && placement.kind !== 'section_placeholder'
          ? { ...placement, partId: partId ?? undefined }
          : placement,
      ),
    })
  }

  const addSection = (key: string, label: string) => {
    if (!draft) return

    const placement: NotebookTemplatePlacement = {
      id: crypto.randomUUID(),
      kind: 'section_placeholder',
      order: editPlacements.length + 1,
      key,
      label,
    }

    setDraft({
      ...draft,
      placements: withOrders([...editPlacements, placement]),
    })
  }

  const addParameter: TemplateDraft['addParameter'] = (input) => {
    if (!draft) return

    const parameter: Parameter = {
      id: crypto.randomUUID(),
      key: input.key,
      label: input.label,
      required: input.required,
      type: { kind: 'scalar', valueType: input.valueType },
      constraints: {},
    }

    setDraft({ ...draft, parameters: [...draft.parameters, parameter] })
  }

  const removeParameter = (id: string) => {
    if (!draft) return

    setDraft({
      ...draft,
      parameters: draft.parameters.filter((parameter) => parameter.id !== id),
    })
  }

  /** The RPC and the parser hold the same invariants, so the payload is checked
   * here first — the save error names the field that is wrong. */
  const saveDraft = () => {
    if (!draft) return

    const parsed = notebookTemplateConfigurationSchema.safeParse(draft)

    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setSaveError(
        `${issue.path.join('.') || t('library.templates.overview.configuration')}: ${issue.message}`,
      )

      return
    }

    setSaveError(null)
    save.mutate(parsed.data)
  }

  const setSignOff = (on: boolean) => {
    if (draft) setDraft({ ...draft, signOffParts: on })
  }

  return {
    draft,
    saveError,
    saving: save.isPending,
    placements,
    editPlacements,
    parts,
    startEditing,
    stopEditing,
    saveDraft,
    movePlacement,
    setPlacementPart,
    removePlacement: (id) =>
      applyPlacements(editPlacements.filter((row) => row.id !== id)),
    addSection,
    addParameter,
    removeParameter,
    setParts,
    setSignOff,
  }
}
