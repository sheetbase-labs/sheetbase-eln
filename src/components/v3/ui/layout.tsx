import { useState } from 'react'
import { Icon } from '#/components/v3/icons'
import { Sheet, SheetContent } from './sheet'
import { cn } from '#/lib/utils'

// Page structure: header plane, content, inspector (right = properties and provenance).
export function PageHeader({
  crumbs,
  title,
  meta,
  actions,
  tabs,
  className,
}: {
  crumbs?: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-1.5 border-b border-border bg-surface px-4 pt-3 md:px-6 md:pt-3.5',
        !tabs && 'pb-3',
        className,
      )}
    >
      {crumbs ? (
        <nav
          aria-label="Breadcrumb"
          className="truncate text-label text-fg-muted"
        >
          {crumbs}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <h1 className="min-w-0 flex-1 text-title max-md:basis-full max-md:text-[18px] max-md:leading-6 md:truncate">
          {title}
        </h1>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-label text-fg-muted">
          {meta}
        </div>
      ) : null}
      {tabs ? (
        <div className="-mx-4 mt-1 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6">
          {tabs}
        </div>
      ) : null}
    </header>
  )
}

/**
 * Right-hand panel for properties and provenance. Inline at desktop width (≥1280px); below that it folds away
 * behind a "Details" button and opens as a side panel on laptops and a bottom sheet on tablets and phones.
 */
export function Inspector({
  className,
  children,
  label = 'Details',
  ...props
}: React.ComponentProps<'aside'> & { label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <aside
        aria-label={label}
        className={cn(
          'hidden w-inspector shrink-0 flex-col gap-5 overflow-auto border-l border-border bg-surface p-4 xl:flex',
          className,
        )}
        {...props}
      >
        {children}
      </aside>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed bottom-4 right-4 z-30 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-body font-medium text-fg shadow-overlay hover:bg-surface-hover max-md:bottom-[76px] xl:hidden"
      >
        <Icon name="info" size={14} />
        {label}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={label}>
          <div className="flex flex-col gap-5 p-4">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  )
}
export function InspectorSection({
  title,
  children,
}: {
  title?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      {title ? (
        <h3 className="mb-1.5 font-sans text-label font-semibold">{title}</h3>
      ) : null}
      {children}
    </section>
  )
}

export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-section">{title}</h2>
        {count != null ? (
          <span className="num text-label text-fg-muted">{count}</span>
        ) : null}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

export function DescriptionList({
  items,
  labelWidth = 104,
  className,
}: {
  items: [React.ReactNode, React.ReactNode][]
  labelWidth?: number
  className?: string
}) {
  return (
    <dl
      className={cn('num m-0 grid gap-x-2 gap-y-1.5 text-label', className)}
      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
    >
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Muted({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('m-0 text-label leading-[18px] text-fg-muted', className)}
      {...props}
    />
  )
}
