import * as React from 'react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'

/**
 * Block insertion control (ELN-005). A keyboard-accessible picker that
 * inserts one of the editable block types. Familiar labels (Text, Checklist,
 * Linked record) rather than internal codes; each item is
 * keyboard-operable through the DropdownMenu and announces its type.
 *
 * The picker is the only insertion affordance on the canvas; it does not
 * own the mutation. On select it calls `onInsert(type)` and the parent
 * performs the insert_block RPC and refetch/optimistic update.
 */

export interface BlockPickerOption {
  type: string
  label: string
  description: string
  icon: IconName
  group: 'writing' | 'structure' | 'evidence'
  aliases: readonly string[]
}

export const BLOCK_PICKER_GROUPS = [
  { id: 'writing', label: 'Writing' },
  { id: 'structure', label: 'Sheets and references' },
  { id: 'evidence', label: 'Files and figures' },
] as const

export const BLOCK_PICKER_OPTIONS: readonly BlockPickerOption[] = [
  {
    type: 'rich_text',
    label: 'Text',
    description: 'Headings, paragraphs, and prose lists.',
    icon: 'edit',
    group: 'writing',
    aliases: ['heading', 'paragraph', 'note', 'prose'],
  },
  {
    type: 'checklist',
    label: 'Checklist',
    description: 'A list of checkable items.',
    icon: 'check',
    group: 'writing',
    aliases: ['todo', 'tasks'],
  },
  {
    type: 'linked_record',
    label: 'Linked record',
    description:
      'A reference to another experiment, Dataset, sample or reagent.',
    icon: 'link',
    group: 'structure',
    aliases: ['dataset', 'record', 'sample', 'reagent', 'link'],
  },
  {
    type: 'sheet',
    label: 'Sheet',
    description: 'Start a new Sheet on this Notebook.',
    icon: 'table',
    group: 'structure',
    aliases: ['table', 'grid', 'spreadsheet'],
  },
  {
    type: 'sheet_shared',
    label: 'Link existing Sheet',
    description:
      'Show a Sheet that already exists. Edits stay shared with every Notebook that uses it.',
    icon: 'link',
    group: 'structure',
    aliases: ['embed', 'reuse'],
  },
  {
    type: 'protocol_reference',
    label: 'Protocol',
    description: 'Pin an exact protocol version and its procedure.',
    icon: 'flask',
    group: 'structure',
    aliases: ['sop', 'method'],
  },
  {
    type: 'materials',
    label: 'Materials',
    description: 'Linked samples and reagents with quantities and units.',
    icon: 'box',
    group: 'structure',
    aliases: ['samples', 'reagents', 'inventory'],
  },
  {
    type: 'file',
    label: 'File',
    description: 'Attach a file with provenance and lifecycle states.',
    icon: 'download',
    group: 'evidence',
    aliases: ['image', 'photo', 'pdf', 'attachment'],
  },
  {
    type: 'chart',
    label: 'Chart',
    description:
      'A line, scatter or bar chart from a saved dataset, with a live or frozen snapshot.',
    icon: 'chart',
    group: 'evidence',
    aliases: ['plot', 'graph'],
  },
  {
    type: 'analysis',
    label: 'Analysis',
    description:
      'A saved analysis — grouped statistics or a regression fit — run against live dataset rows, freezable as evidence.',
    icon: 'code',
    group: 'evidence',
    aliases: ['statistics', 'regression', 'fit'],
  },
  {
    type: 'plate_map',
    label: 'Plate map',
    description:
      'A 96-well plate layout with sample assignments, controls, replicates and volumes.',
    icon: 'table',
    group: 'evidence',
    aliases: ['plate', 'wells'],
  },
  {
    type: 'pipeline_output',
    label: 'Pipeline output',
    description:
      'Reference a Pipeline run and pin the Dataset Version it produced into the notebook.',
    icon: 'pipeline',
    group: 'evidence',
    aliases: ['pipeline', 'automation', 'run'],
  },
]

export interface BlockPickerProps {
  onInsert: (type: string) => void
  /** Insert after this block id; the parent decides positioning. */
  afterBlockId?: string
  disabled?: boolean
  className?: string
  /** Variant: a full "Add block" button (default) or a compact icon trigger. */
  variant?: 'button' | 'icon'
  label?: string
  triggerId?: string
}

export function BlockPicker({
  onInsert,
  afterBlockId,
  disabled,
  className,
  variant = 'button',
  label = 'Add block',
  triggerId,
}: BlockPickerProps) {
  const [open, setOpen] = React.useState(false)
  void afterBlockId // captured by the parent when wiring onInsert

  const trigger =
    variant === 'icon' ? (
      <Button
        id={triggerId}
        variant="quiet"
        size="icon"
        aria-label={label}
        disabled={disabled}
        className="rounded-full border bg-background shadow-xs"
      >
        <Icon name="plus" size={14} />
      </Button>
    ) : (
      <Button
        id={triggerId}
        variant="quiet"
        size="sm"
        disabled={disabled}
        aria-label={label}
        className="w-full justify-start text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <Icon name="plus" size={16} aria-hidden="true" />
        {label}
      </Button>
    )

  return (
    <div className={cn('relative', className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Insert block</DropdownMenuLabel>
          {BLOCK_PICKER_GROUPS.map((group) => {
            const items = BLOCK_PICKER_OPTIONS.filter(
              (opt) => opt.group === group.id,
            )
            return (
              <div key={group.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {items.map((opt) => (
                  <DropdownMenuItem
                    key={opt.type}
                    onSelect={() => onInsert(opt.type)}
                    className="flex items-start gap-2"
                  >
                    <Icon
                      name={opt.icon}
                      size={16}
                      className="mt-0.5 shrink-0 text-fg-muted"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {opt.label}
                      </span>
                      <span className="block text-xs text-fg-muted">
                        {opt.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
