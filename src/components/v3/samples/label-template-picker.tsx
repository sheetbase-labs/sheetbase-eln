import { t } from '#/copy'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
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

/**
 * The label templates a person can print with, and the one they have chosen:
 * the one they used last, else the workspace's default, else the first. When
 * the workspace has set up no templates the label keeps its built-in look.
 */
export function useLabelTemplateChoice(
  recordKind = 'sample',
  client: DataClient = notebookDataClient,
) {
  const templates = useQuery({
    queryKey: ['label-templates', 'picker'],
    queryFn: () => fetchLabelTemplates(client),
    staleTime: 60_000,
  })
  const active = activeLabelTemplates(templates.data ?? [], recordKind)
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

export function LabelTemplatePicker({
  templates,
  chosen,
  onChoose,
}: {
  templates: readonly LabelTemplate[]
  chosen: LabelTemplate | undefined
  onChoose: (id: string) => void
}) {
  if (templates.length < 2) return null
  return (
    <Field label={t('library.labelTemplatePicker.label')}>
      <Select
        size="sm"
        value={chosen?.id ?? ''}
        onChange={(event) => onChoose(event.target.value)}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} · {template.widthMm} × {template.heightMm} mm
          </option>
        ))}
      </Select>
    </Field>
  )
}
