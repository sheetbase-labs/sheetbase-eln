import { useState } from 'react'

import { Button } from '#/components/ui/button'
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
  onChange,
}: {
  parts: readonly TemplatePart[]
  placements: readonly NotebookTemplatePlacement[]
  editable: boolean
  disabled?: boolean
  onChange: (parts: TemplatePart[]) => void
}) {
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
