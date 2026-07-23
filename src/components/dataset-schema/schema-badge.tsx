/**
 * SCI-010 Phase 3: Bound schema badge + upgrade indicator for the sheet
 * editor header. Shows the bound schema name and revision, and an
 * "Upgrade available" indicator when a newer published revision exists.
 */
import { ArrowUpCircle, Database } from 'lucide-react'

import { Badge, Button } from '#/components/ui'
import type { ScientificDatasetSchemaBinding } from '#/lib/scientific-sheet-data'

export interface SchemaBadgeProps {
  schema: ScientificDatasetSchemaBinding | null
  onUpgrade?: () => void
  upgrading?: boolean
}

export function SchemaBadge({
  schema,
  onUpgrade,
  upgrading,
}: SchemaBadgeProps) {
  if (!schema) return null

  const upgradeAvailable =
    schema.latest_published_revision !== null &&
    schema.latest_published_revision > schema.revision

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="gap-1.5">
        <Database className="size-3" aria-hidden="true" />
        {schema.name}
        <span className="text-muted-foreground">rev {schema.revision}</span>
      </Badge>
      {upgradeAvailable && onUpgrade && (
        <Button
          variant="outline"
          size="sm"
          onClick={onUpgrade}
          disabled={upgrading}
          className="gap-1.5"
        >
          <ArrowUpCircle className="size-3.5" aria-hidden="true" />
          {upgrading
            ? 'Upgrading…'
            : `Upgrade to rev ${schema.latest_published_revision}`}
        </Button>
      )}
      {upgradeAvailable && !onUpgrade && (
        <Badge variant="outline" className="gap-1.5 text-amber-600">
          <ArrowUpCircle className="size-3" aria-hidden="true" />
          Upgrade available
        </Badge>
      )}
    </div>
  )
}
