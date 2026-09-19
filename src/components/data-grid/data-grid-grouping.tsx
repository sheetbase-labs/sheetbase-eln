import { Plus, X } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { RowData } from '@tanstack/react-table'

import type { DataGridField } from './data-grid-types'

export interface DataGridGroupingProps<TData extends RowData> {
  fields: DataGridField<TData>[]
  grouping: string[]
  onGroupingChange: (grouping: string[]) => void
}

export function DataGridGrouping<TData extends RowData>({
  fields,
  grouping,
  onGroupingChange,
}: DataGridGroupingProps<TData>) {
  const available = fields.filter(
    (field) => field.groupable && !grouping.includes(field.id),
  )
  if (available.length === 0 && grouping.length === 0) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Row grouping"
    >
      {available.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs" aria-label="Add grouping">
              <Plus />
              Add grouping
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Add grouping</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {available.map((field) => (
              <DropdownMenuItem
                key={field.id}
                onSelect={() => onGroupingChange([...grouping, field.id])}
              >
                {field.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {grouping.map((id) => {
        const field = fields.find((candidate) => candidate.id === id)
        return field ? (
          <ButtonGroup key={id}>
            <ButtonGroupText className="h-7 px-2.5 text-xs font-medium">
              Group: {field.label}
            </ButtonGroupText>
            <Button
              variant="outline"
              size="icon-xs"
              aria-label={`Remove ${field.label} grouping`}
              onClick={() =>
                onGroupingChange(grouping.filter((active) => active !== id))
              }
            >
              <X />
            </Button>
          </ButtonGroup>
        ) : null
      })}
    </div>
  )
}
