/**
 * SCI-010 Phase 3: Bound schema badge + upgrade indicator for the sheet
 * editor header. Shows the bound schema name and revision, and an
 * "Upgrade available" indicator when a newer published revision exists.
 */
import { ArrowUpCircle } from 'lucide-react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Spinner } from '#/components/v3/ui/spinner'
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
      <Badge variant="chg" className="gap-1.5">
        <Icon name="database" className="size-3" aria-hidden="true" />
        {schema.name}
        <span className="text-fg-muted">
          {t('data.schemaBadge.revision', { revision: schema.revision })}
        </span>
      </Badge>
      {upgradeAvailable && onUpgrade && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onUpgrade}
          disabled={upgrading}
          className="rounded-full"
        >
          {upgrading ? (
            <Spinner size={12} />
          ) : (
            <ArrowUpCircle className="size-3" aria-hidden="true" />
          )}
          {upgrading
            ? t('data.schemaBadge.upgrading')
            : t('data.schemaBadge.upgradeRev', {
                latestPublishedRevision: schema.latest_published_revision ?? 0,
              })}
        </Button>
      )}
      {upgradeAvailable && !onUpgrade && (
        <Badge variant="chg" className="gap-1.5 text-warning-foreground">
          <ArrowUpCircle className="size-3" aria-hidden="true" />
          {t('data.schemaBadge.upgradeAvailable')}
        </Badge>
      )}
    </div>
  )
}
