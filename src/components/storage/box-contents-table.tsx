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
    <section
      className="min-w-0 overflow-auto rounded-lg border bg-card"
      aria-labelledby="box-contents-title"
    >
      <div className="border-b px-3 py-2">
        <h3 id="box-contents-title" className="text-sm font-semibold">
          Box contents
        </h3>
        <p className="text-xs text-muted-foreground">{rows.length} samples</p>
      </div>
      <Table className="min-w-[44rem] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Position</TableHead>
            <TableHead className="w-40">Sample identifier</TableHead>
            <TableHead className="w-52">Name</TableHead>
            <TableHead className="w-36">Type</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-20">Volume</TableHead>
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
                aria-current={
                  selectedPositionId === position.id ? 'true' : undefined
                }
                className={cn(
                  'cursor-pointer',
                  selectedPositionId === position.id && 'bg-primary/10',
                )}
                onClick={() => onSelectPosition(position.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectPosition(position.id)
                  }
                }}
              >
                <TableCell>{position.label}</TableCell>
                <TableCell
                  className="truncate font-mono text-primary"
                  title={sample.identifier}
                >
                  {sample.identifier}
                </TableCell>
                <TableCell className="truncate" title={sample.title}>
                  {sample.title}
                </TableCell>
                <TableCell
                  className="truncate"
                  title={sample.sampleType ?? undefined}
                >
                  {sample.sampleType ?? '—'}
                </TableCell>
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
    </section>
  )
}
