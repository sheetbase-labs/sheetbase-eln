'use client'

// Adapted from the ReUI Radix Filters registry primitive (reui.io).
import { Check, Plus, X } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { InputGroup, InputGroupInput } from '#/components/ui/input-group'

export interface Filter<T = unknown> {
  id: string
  field: string
  operator: string
  values: T[]
}

export interface FilterOperator {
  value: string
  label: string
}

export interface FilterOption<T = unknown> {
  value: T
  label: string
}

export interface FilterFieldConfig<T = unknown> {
  key: string
  label: string
  type?: 'text' | 'select'
  placeholder?: string
  options?: FilterOption<T>[]
  operators?: FilterOperator[]
  defaultOperator?: string
}

interface FiltersProps<T = unknown> {
  filters: Filter<T>[]
  fields: FilterFieldConfig<T>[]
  onChange: (filters: Filter<T>[]) => void
  allowMultiple?: boolean
  size?: 'sm' | 'default' | 'lg'
  i18n?: { addFilter?: string; clear?: string }
}

/** The ReUI controlled filter builder, trimmed to the text/select field types used by registries. */
export function Filters<T = unknown>({
  filters,
  fields,
  onChange,
  allowMultiple = true,
  size = 'default',
  i18n,
}: FiltersProps<T>) {
  const available = fields.filter(
    (field) =>
      allowMultiple || !filters.some((filter) => filter.field === field.key),
  )

  const update = (id: string, updates: Partial<Filter<T>>) =>
    onChange(
      filters.map((filter) =>
        filter.id === id ? { ...filter, ...updates } : filter,
      ),
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {available.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size={size === 'sm' ? 'sm' : 'default'}>
              <Plus />
              {i18n?.addFilter ?? 'Add filter'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>
              {i18n?.addFilter ?? 'Add filter'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {available.map((field) => (
              <DropdownMenuItem
                key={field.key}
                onSelect={() =>
                  onChange([
                    ...filters,
                    {
                      id: field.key,
                      field: field.key,
                      operator: field.defaultOperator ?? 'is',
                      values: field.type === 'text' ? ([''] as T[]) : [],
                    },
                  ])
                }
              >
                {field.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {filters.map((filter) => {
        const field = fields.find((candidate) => candidate.key === filter.field)
        if (!field) return null
        const operators = field.operators ?? [{ value: 'is', label: 'is' }]
        return (
          <ButtonGroup key={filter.id}>
            <ButtonGroupText
              className={
                size === 'sm' ? 'h-8 px-3 text-xs font-medium' : undefined
              }
            >
              {field.label}
            </ButtonGroupText>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size={size === 'sm' ? 'sm' : 'default'}
                >
                  {operators.find((item) => item.value === filter.operator)
                    ?.label ?? filter.operator}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {operators.map((operator) => (
                  <DropdownMenuItem
                    key={operator.value}
                    onSelect={() =>
                      update(filter.id, { operator: operator.value })
                    }
                  >
                    {operator.value === filter.operator ? <Check /> : null}
                    {operator.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {field.type === 'select' ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size={size === 'sm' ? 'sm' : 'default'}
                  >
                    {field.options?.find(
                      (option) => option.value === filter.values[0],
                    )?.label ??
                      field.placeholder ??
                      'Select'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {field.options?.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={String(option.value)}
                      checked={option.value === filter.values[0]}
                      onCheckedChange={() =>
                        update(filter.id, { values: [option.value] })
                      }
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <InputGroup
                className={
                  size === 'sm' ? 'h-8 w-40 rounded-none' : 'w-40 rounded-none'
                }
              >
                <InputGroupInput
                  aria-label={field.label}
                  value={String(filter.values[0] ?? '')}
                  placeholder={field.placeholder}
                  className={size === 'sm' ? 'h-8 text-xs' : undefined}
                  onChange={(event) =>
                    update(filter.id, { values: [event.target.value as T] })
                  }
                />
              </InputGroup>
            )}
            <Button
              variant="outline"
              size={size === 'sm' ? 'icon-sm' : 'icon'}
              aria-label={`Remove ${field.label} filter`}
              onClick={() =>
                onChange(
                  filters.filter((candidate) => candidate.id !== filter.id),
                )
              }
            >
              <X />
            </Button>
          </ButtonGroup>
        )
      })}
    </div>
  )
}
