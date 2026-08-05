import * as React from 'react'

import { cn } from '#/lib/utils'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description: string
  children?: React.ReactNode
  className?: string
}

function PageHeader({
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
        className,
      )}
    >
      <div data-slot="page-header-content" className="max-w-2xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}

export { PageHeader, type PageHeaderProps }
