import * as React from 'react'

import { cn } from '#/lib/utils'

interface PageHeaderProps {
  compact?: boolean
  eyebrow?: string
  title: string
  description: string
  children?: React.ReactNode
  className?: string
}

function PageHeader({
  compact = false,
  eyebrow,
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between',
        compact && 'gap-2 pb-3 md:items-center',
        className,
      )}
    >
      <div data-slot="page-header-content" className="max-w-2xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1
          className={cn(
            'font-display font-semibold tracking-tight',
            compact ? 'text-base' : 'text-2xl',
          )}
        >
          {title}
        </h1>
        <p
          className={cn(
            'text-muted-foreground',
            compact ? 'mt-0.5 text-xs leading-5' : 'mt-2 text-sm leading-6',
          )}
        >
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}

export { PageHeader, type PageHeaderProps }
