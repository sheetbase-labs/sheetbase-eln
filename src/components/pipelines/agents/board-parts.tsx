import { t } from '#/copy'
import { cn } from '#/lib/utils'
import type { Risk } from '#/lib/agent-registry'

export { linkifyIdentifiers } from './board-links'

const RISK: Record<Risk, { label: string; bars: number }> = {
  high: { label: t('data.boardParts.high'), bars: 3 },
  medium: { label: t('data.boardParts.medium'), bars: 2 },
  low: { label: t('data.boardParts.low'), bars: 1 },
}

/** Three small bars filled to the level, then its name. */
export function RiskGlyph({
  risk,
  label = true,
  className,
}: {
  risk: string
  label?: boolean
  className?: string
}) {
  const level =
    new Map(Object.entries(RISK)).get(risk.toLowerCase()) ?? RISK.medium

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted',
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex items-end gap-px">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn(
              'w-[3px] rounded-[1px]',
              n === 1 ? 'h-[6px]' : n === 2 ? 'h-[9px]' : 'h-[12px]',
              n <= level.bars ? 'bg-fg-muted' : 'bg-border',
            )}
          />
        ))}
      </span>
      {label ? (
        <span>{level.label}</span>
      ) : (
        <span className="sr-only">{level.label}</span>
      )}
    </span>
  )
}
