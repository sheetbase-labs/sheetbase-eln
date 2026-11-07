import { useState } from 'react'

import { GateDialog, describeConditions } from '#/components/notebook/gates'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from '#/lib/notebook-template'
import { t } from '#/copy'
import type { GateCondition } from '#/lib/experiment-gates'

export type TemplatePart = NonNullable<
  NotebookTemplateConfiguration['parts']
>[number]

/**
 * The days a template splits an experiment into. Reading shows them; editing
 * adds, reorders and removes them, and the Sections table says which part each
 * section belongs to.
 */
export function TemplatePartsSection({
  parts,
  placements,
  editable,
  disabled = false,
  signOff,
  onSignOffChange,
  onChange,
}: {
  parts: readonly TemplatePart[]
  placements: readonly NotebookTemplatePlacement[]
  editable: boolean
  disabled?: boolean
  /** Whether each part needs a signature (the lab's default when the template says nothing). */
  signOff?: boolean
  onSignOffChange?: (on: boolean) => void
  onChange: (parts: TemplatePart[]) => void
}) {
  const [ruleFor, setRuleFor] = useState<string | null>(null)
  const gateContext = {
    blocks: [],
    parts: parts.map((part, index) => ({
      id: part.id,
      number: index + 1,
      title: part.title,
      state: 'later' as const,
    })),
  }
  const ruleOf = (part: TemplatePart) =>
    [
      part.opensWhen?.length
        ? describeConditions(part.opensWhen as GateCondition[], gateContext)
        : t('library.templates.parts.opensImmediately'),
      part.gateMode === 'block' && part.opensWhen?.length
        ? t('library.templates.parts.blocksNote')
        : null,
      part.stepsInOrder ? t('library.templates.parts.inOrderNote') : null,
    ]
      .filter(Boolean)
      .join(' · ')
  const sectionCount = (partId: string) =>
    placements.filter(
      (placement) => 'partId' in placement && placement.partId === partId,
    ).length
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= parts.length) return
    const next = [...parts]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const columns: RegistryColumn<TemplatePart>[] = [
    {
      id: 'number',
      header: '#',
      meta: { cellClassName: 'num text-fg-muted' },
      cell: ({ row }) => row.index + 1,
    },
    {
      id: 'part',
      header: t('library.templates.parts.columns.part'),
      cell: ({ row }) => row.original.title,
    },
    {
      id: 'day',
      header: t('library.templates.parts.columns.day'),
      meta: { cellClassName: 'num' },
      cell: ({ row }) => row.original.dayOffset,
    },
    {
      id: 'opens',
      header: t('library.templates.parts.columns.opens'),
      cell: ({ row }) => ruleOf(row.original),
    },
    {
      id: 'sections',
      header: t('library.templates.parts.columns.sections'),
      meta: { cellClassName: 'num' },
      cell: ({ row }) => sectionCount(row.original.id),
    },
    ...(editable
      ? [
          {
            id: 'actions',
            header: t('library.templates.parts.columns.actions'),
            cell: ({ row }) => (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={disabled}
                  aria-label={t('library.templates.parts.editRule', {
                    title: row.original.title,
                  })}
                  onClick={() => setRuleFor(row.original.id)}
                >
                  {t('notebook.gates.addToPart')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={row.index === 0 || disabled}
                  aria-label={t('library.templates.parts.moveUp', {
                    title: row.original.title,
                  })}
                  onClick={() => move(row.index, -1)}
                >
                  {t('library.templates.overview.up')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={row.index === parts.length - 1 || disabled}
                  aria-label={t('library.templates.parts.moveDown', {
                    title: row.original.title,
                  })}
                  onClick={() => move(row.index, 1)}
                >
                  {t('library.templates.overview.down')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={disabled}
                  aria-label={t('library.templates.parts.remove', {
                    title: row.original.title,
                  })}
                  onClick={() =>
                    onChange(
                      parts.filter((part) => part.id !== row.original.id),
                    )
                  }
                >
                  {t('common.actions.remove')}
                </Button>
              </span>
            ),
          } satisfies RegistryColumn<TemplatePart>,
        ]
      : []),
  ]
  return (
    <Section title={t('library.templates.parts.title')} count={parts.length}>
      <Muted>{t('library.templates.parts.hint')}</Muted>
      {onSignOffChange ? (
        <label
          className="flex cursor-pointer items-center gap-2 text-label"
          title={t('notebook.partSignoff.templateSwitchHint')}
        >
          <Checkbox
            checked={signOff ?? false}
            disabled={disabled || !editable}
            onCheckedChange={(checked) => onSignOffChange(checked)}
          />
          {t('notebook.partSignoff.templateSwitch')}
        </label>
      ) : null}
      {parts.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.templates.parts.table')}
            rows={[...parts]}
            columns={columns}
            getRowId={(part) => part.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>{t('library.templates.parts.none')}</Muted>
      )}
      {editable && ruleFor
        ? (() => {
            const index = parts.findIndex((part) => part.id === ruleFor)
            const part = parts[index] as TemplatePart | undefined
            if (!part) return null
            const save = (patch: Partial<TemplatePart>) => {
              onChange(
                parts.map((p) => (p.id === part.id ? { ...p, ...patch } : p)),
              )
              setRuleFor(null)
            }
            return (
              <GateDialog
                part={index + 1}
                named={false}
                canStepsInOrder
                removable={Boolean(part.opensWhen?.length)}
                kinds={['part_done', 'samples_linked', 'field_set']}
                initial={{
                  mode: part.gateMode ?? 'warn',
                  conditions: part.opensWhen ?? [],
                  stepsInOrder: part.stepsInOrder ?? false,
                }}
                targets={{
                  tables: [],
                  steps: [],
                  parts: parts.slice(0, index).map((p, i) => ({
                    id: p.id,
                    number: i + 1,
                    title: p.title,
                  })),
                }}
                onSave={(draft) =>
                  save({
                    opensWhen: draft.conditions.length
                      ? (draft.conditions as TemplatePart['opensWhen'])
                      : undefined,
                    gateMode: draft.conditions.length ? draft.mode : undefined,
                    stepsInOrder: draft.stepsInOrder || undefined,
                  })
                }
                onRemove={() =>
                  save({ opensWhen: undefined, gateMode: undefined })
                }
                onClose={() => setRuleFor(null)}
              />
            )
          })()
        : null}
      {editable ? (
        <AddPartForm
          disabled={disabled}
          nextDay={parts.length ? parts[parts.length - 1].dayOffset + 1 : 0}
          onAdd={(title, dayOffset) =>
            onChange([...parts, { id: crypto.randomUUID(), title, dayOffset }])
          }
        />
      ) : null}
    </Section>
  )
}

function AddPartForm({
  disabled,
  nextDay,
  onAdd,
}: {
  disabled: boolean
  nextDay: number
  onAdd: (title: string, dayOffset: number) => void
}) {
  const [title, setTitle] = useState('')
  const [day, setDay] = useState<string | null>(null)
  const shownDay = day ?? String(nextDay)
  const dayNumber = Number(shownDay)
  const valid =
    title.trim().length > 0 &&
    Number.isInteger(dayNumber) &&
    dayNumber >= 0 &&
    dayNumber <= 3650
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={t('library.templates.parts.titleLabel')}
        required
        className="w-[260px]"
      >
        <Input
          value={title}
          placeholder={t('library.templates.parts.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field
        label={t('library.templates.parts.dayLabel')}
        className="w-[100px]"
      >
        <Input
          type="number"
          min={0}
          max={3650}
          value={shownDay}
          onChange={(event) => setDay(event.target.value)}
        />
      </Field>
      <Button
        icon="plus"
        disabled={disabled || !valid}
        onClick={() => {
          onAdd(title.trim(), dayNumber)
          setTitle('')
          setDay(null)
        }}
      >
        {t('library.templates.parts.add')}
      </Button>
    </div>
  )
}
