import type { Table } from '@tanstack/react-table'
import { Columns3 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export function DataGridColumnSelector<TData>({
  table,
}: {
  table: Table<TData>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-xs"
          aria-label="Choose visible columns"
        >
          <Columns3 className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {table.getAllLeafColumns().map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            disabled={!column.getCanHide()}
            onCheckedChange={(checked) =>
              column.toggleVisibility(Boolean(checked))
            }
          >
            {typeof column.columnDef.header === 'string'
              ? column.columnDef.header
              : column.id}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
