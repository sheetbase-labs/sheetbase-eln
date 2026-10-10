import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * Source badge (DSYS-04). Shows where a sheet column or value comes from —
 * a dataset snapshot, a linked record, a calculation or local entry — at the
 * design's 10px muted treatment; `local` is the one link-coloured case.
 */
export type SourceKind = 'dataset' | 'record' | 'calc' | 'local'

const SOURCE_ICON: Record<SourceKind, IconName> = {
  dataset: 'database',
  record: 'link',
  calc: 'code',
  local: 'edit',
}

const SOURCE_LABEL: Record<SourceKind, string> = {
  dataset: 'Dataset',
  record: 'Record',
  calc: 'Calculated',
  local: 'Local',
}

export interface SourceProps {
  kind: SourceKind
  title?: string
  className?: string
}

export function Source({ kind, title, className }: SourceProps) {
  return (
    <span
      data-slot="source"
      title={title ?? SOURCE_LABEL[kind]}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] leading-[14px] whitespace-nowrap text-muted-foreground',
        kind === 'local' && 'text-link',
        className,
      )}
    >
      <Icon name={SOURCE_ICON[kind]} size={10} />
      {SOURCE_LABEL[kind]}
    </span>
  )
}
