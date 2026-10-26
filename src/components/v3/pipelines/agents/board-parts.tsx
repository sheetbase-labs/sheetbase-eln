import { Fragment } from 'react'

import { cn } from '#/lib/utils'
import type { Risk } from '#/lib/agent-registry'

const RISK: Record<Risk, { label: string; bars: number }> = {
  high: { label: 'High', bars: 3 },
  medium: { label: 'Medium', bars: 2 },
  low: { label: 'Low', bars: 1 },
}

/** Three small bars filled to the level, then its name. */
export function RiskGlyph({
  risk,
  label = true,
  className,
}: {
  risk: Risk | string
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

const ROUTES: Record<string, string> = {
  EXP: '/experiments/',
  DS: '/datasets/',
  PRT: '/protocols/',
  SMP: '/samples/',
}

/** Turn record identifiers in a sentence into links to those records. */
export function linkifyIdentifiers(text: string): React.ReactNode {
  const parts = text.split(/\b((?:EXP|DS|PRT|SMP)-\d{4})\b/)
  return parts.map((part, index) => {
    const prefix = part.slice(0, part.indexOf('-'))
    const route = ROUTES[prefix]
    return index % 2 === 1 && route ? (
      <a key={index} href={`${route}${part}`} className="text-link">
        {part}
      </a>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  })
}
