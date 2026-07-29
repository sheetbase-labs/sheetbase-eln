import * as React from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description: string
  children?: React.ReactNode
}

function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between"
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
