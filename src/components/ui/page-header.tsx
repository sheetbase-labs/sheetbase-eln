import * as React from 'react'

import { cn } from '#/lib/utils'

interface PageHeaderProps {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
        className,
      )}
    >
      <div data-slot="page-header-content" className="max-w-2xl">
        <h1 className="font-display font-heading tracking-tight text-headline">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export { PageHeader, type PageHeaderProps }
