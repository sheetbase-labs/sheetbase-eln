import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/icons'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { addColumnToTemplateSheet } from '#/lib/template-sheet-column'
import type {
  SheetDefinition,
  SheetDefinitionVersion,
} from '#/lib/sheet-definition-data'
import {
  ADDABLE_COLUMN_TYPES,
  addSheetColumn,
} from '#/lib/sheet-definition-add-column'
import type { AddableColumnType } from '#/lib/sheet-definition-add-column'
import { t } from '#/copy'

const TYPE_LABELS: Record<AddableColumnType, () => string> = {
  text: () => t('library.templates.addSheetColumn.types.text'),
  integer: () => t('library.templates.addSheetColumn.types.integer'),
  decimal: () => t('library.templates.addSheetColumn.types.decimal'),
  boolean: () => t('library.templates.addSheetColumn.types.boolean'),
  date: () => t('library.templates.addSheetColumn.types.date'),
  timestamp: () => t('library.templates.addSheetColumn.types.timestamp'),
}

function numberOrUndefined(text: string): number | undefined {
  const trimmed = text.trim()

  if (trimmed === '') return undefined

  const value = Number(trimmed)

  return Number.isFinite(value) ? value : undefined
}

/**
 * "Add column" on a draft template's sheet section. The pinned sheet's layout
 * gets the new column as a new version of the sheet definition, which is
 * published (a template can only use a published version) and then the
 * section in this draft is pointed at it. Those are the same schema writes the
 * API, MCP and assistant already offer. Notebooks already made keep the
 * version they were made from.
 */
export function AddSheetColumnButton({
  templateVersion,
  placementId,
  sectionName,
  sheet,
  definition,
}: {
  templateVersion: NotebookTemplateVersion
  placementId: string
  sectionName: string
  sheet: SheetDefinitionVersion
  definition: SheetDefinition
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<AddableColumnType>('text')
  const [unit, setUnit] = useState('')
  const [required, setRequired] = useState(false)
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const numeric = type === 'integer' || type === 'decimal'
  const low = numeric ? numberOrUndefined(min) : undefined
  const high = numeric ? numberOrUndefined(max) : undefined
  const backwards = low !== undefined && high !== undefined && low > high

  const add = useMutation({
    mutationFn: async () => {
      const next = addSheetColumn(sheet.configuration, {
        label: name,
        type,
        unit,
        required,
        min: low,
        max: high,
      })

      await addColumnToTemplateSheet(
        {
          definitionId: definition.id,
          definitionRevision: definition.revision,
          templateVersionId: templateVersion.id,
          templateRevision: templateVersion.revision,
          placementId,
        },
        next,
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'templates'],
      })
      toast(
        t('library.templates.addSheetColumn.added', {
          name: name.trim(),
          section: sectionName,
        }),
      )
      setOpen(false)
      setName('')
      setUnit('')
      setMin('')
      setMax('')
      setRequired(false)
      setType('text')
      add.reset()
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (!next) add.reset()
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1 text-body text-fg-muted hover:bg-hover"
          />
        }
      >
        <Icon name="plus" size={14} />
        {t('library.templates.addSheetColumn.button')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader
          title={t('library.templates.addSheetColumn.title', {
            section: sectionName,
          })}
          description={t('library.templates.addSheetColumn.description')}
        />
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault()

            if (name.trim() && !backwards) add.mutate()
          }}
        >
          <DialogBody>
            <Field label={t('library.templates.addSheetColumn.name')} required>
              <Input
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t('library.templates.addSheetColumn.type')}>
              <Select
                value={type}
                onChange={(event) =>
                  setType(
                    ADDABLE_COLUMN_TYPES.find(
                      (option) => option === event.target.value,
                    ) ?? 'text',
                  )
                }
              >
                {ADDABLE_COLUMN_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {TYPE_LABELS[option]()}
                  </option>
                ))}
              </Select>
            </Field>
            {numeric ? (
              <>
                <Field
                  label={t('library.templates.addSheetColumn.unit')}
                  hint={t('library.templates.addSheetColumn.unitHint')}
                >
                  <Input
                    maxLength={40}
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('library.templates.addSheetColumn.min')}>
                    <Input
                      inputMode="decimal"
                      value={min}
                      onChange={(event) => setMin(event.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('library.templates.addSheetColumn.max')}
                    error={
                      backwards
                        ? t('library.templates.addSheetColumn.rangeBackwards')
                        : undefined
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={max}
                      onChange={(event) => setMax(event.target.value)}
                    />
                  </Field>
                </div>
              </>
            ) : null}
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={required}
                onCheckedChange={(next) => setRequired(next)}
              />
              {t('library.templates.addSheetColumn.required')}
            </label>
            {add.error ? (
              <Notice tone="bad">
                {add.error.message ||
                  t('library.templates.addSheetColumn.failed')}
              </Notice>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || backwards || add.isPending}
            >
              {add.isPending
                ? t('library.templates.addSheetColumn.adding')
                : t('library.templates.addSheetColumn.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
