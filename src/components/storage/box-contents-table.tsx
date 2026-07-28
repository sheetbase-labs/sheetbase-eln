import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import { positionStatusDef } from '#/lib/storage'
import type { BoxPositionWithSample } from '#/lib/storage'
import { cn } from '#/lib/utils'

export function BoxContentsTable({
  positions,
  selectedPositionId,
  onSelectPosition,
}: {
  positions: BoxPositionWithSample[]
  selectedPositionId?: string | null
  onSelectPosition: (id: string) => void
}) {
  const rows = positions.filter((position) => position.sample)
  return (
    <div className="min-w-0 overflow-auto rounded-lg border bg-card">
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Box contents</h3>
        <p className="text-xs text-muted-foreground">{rows.length} samples</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Position</TableHead>
            <TableHead>Sample ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Volume</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((position) => {
            const sample = position.sample!
            const def = positionStatusDef(position.status)
            const props = (
              sample as unknown as { properties?: Record<string, unknown> }
            ).properties
            return (
              <TableRow
                key={position.id}
                tabIndex={0}
                className={cn(
                  'cursor-pointer',
                  selectedPositionId === position.id && 'bg-primary/10',
                )}
                onClick={() => onSelectPosition(position.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelectPosition(position.id)
                }}
              >
                <TableCell>{position.label}</TableCell>
                <TableCell className="font-mono text-primary">
                  {sample.identifier}
                </TableCell>
                <TableCell>{sample.title}</TableCell>
                <TableCell>{sample.sampleType ?? '—'}</TableCell>
                <TableCell>
                  <Badge
                    variant={def.tone === 'neutral' ? 'outline' : def.tone}
                  >
                    {def.glyph} {def.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {props?.quantity == null ? '—' : String(props.quantity)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
