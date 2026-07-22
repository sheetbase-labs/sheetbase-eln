import * as React from 'react'
import {
  CheckSquare,
  FlaskConical,
  Link2,
  PackageOpen,
  Pilcrow,
  Sheet,
  Paperclip,
  LineChart,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui'

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
  icon: LucideIcon
}

export const BLOCK_PICKER_OPTIONS: readonly BlockPickerOption[] = [
  {
    type: 'rich_text',
    label: 'Text',
    description: 'Headings, paragraphs, and prose lists.',
    icon: Pilcrow,
  },
  {
    type: 'checklist',
    label: 'Checklist',
    description: 'A list of checkable items.',
    icon: CheckSquare,
  },
  {
    type: 'linked_record',
    label: 'Linked record',
    description: 'A reference to another record.',
    icon: Link2,
  },
  {
    type: 'sheet',
    label: 'Sheet',
    description: 'A PostgreSQL-backed scientific table.',
    icon: Sheet,
  },
  {
    type: 'protocol_reference',
    label: 'Protocol',
    description: 'Pin an exact protocol version and its procedure.',
    icon: FlaskConical,
  },
  {
    type: 'materials',
    label: 'Materials',
    description: 'Linked samples and reagents with quantities and units.',
    icon: PackageOpen,
  },
  {
    type: 'file',
    label: 'File',
    description: 'Attach a file with provenance and lifecycle states.',
    icon: Paperclip,
  },
  {
    type: 'chart',
    label: 'Chart',
    description:
      'A line, scatter or bar chart from a saved dataset, with a live or frozen snapshot.',
    icon: LineChart,
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
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
      >
        <Pilcrow className="size-4" />
      </Button>
    ) : (
      <Button
        id={triggerId}
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={label}
        className="w-full justify-start border-dashed"
      >
        + {label}
      </Button>
    )

  return (
    <div className={cn('relative', className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Insert block</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {BLOCK_PICKER_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <DropdownMenuItem
                key={opt.type}
                onSelect={() => onInsert(opt.type)}
                className="flex items-start gap-2"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
