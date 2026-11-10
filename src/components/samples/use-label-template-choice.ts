import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  activeLabelTemplates,
  fetchLabelTemplates,
} from '#/lib/label-templates'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import type { LabelTemplate } from '#/lib/labels'

const STORAGE_KEY = 'sheetbase.label-template'

function remembered(recordKind: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_KEY}.${recordKind}`)
  } catch {
    return null
  }
}

function remember(recordKind: string, id: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_KEY}.${recordKind}`, id)
  } catch {
    // Private windows can refuse storage; the choice then lasts the page.
  }
}

/** Last choice, workspace default, first active template, then built-in look. */
export function useLabelTemplateChoice(
  recordKind = 'sample',
  client: DataClient = notebookDataClient,
) {
  const templates = useQuery({
    queryKey: ['label-templates', 'picker'],
    queryFn: () => fetchLabelTemplates(client),
    staleTime: 60_000,
  })

  const own = activeLabelTemplates(templates.data ?? [], recordKind)

  const active =
    own.length || recordKind === 'sample' || recordKind === 'material'
      ? own
      : activeLabelTemplates(templates.data ?? [], 'record')

  const [pickedId, setPickedId] = useState<string | null>(() =>
    remembered(recordKind),
  )

  const chosen: LabelTemplate | undefined =
    active.find((template) => template.id === pickedId) ?? active.at(0)

  return {
    templates: active,
    chosen,
    choose: (id: string) => {
      setPickedId(id)
      remember(recordKind, id)
    },
  }
}
