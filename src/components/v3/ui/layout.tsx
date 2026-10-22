import { useState } from 'react'
import { Icon } from '#/components/v3/icons'
import { Breadcrumb } from './breadcrumb'
import type { Crumb } from './breadcrumb'
import { Button } from './button'
import { Sheet, SheetContent } from './sheet'
import { cn } from '#/lib/utils'

// Page structure: header plane, content, inspector (right = properties and provenance).
export function PageHeader({
  trail,
  title,
  meta,
  actions,
  tabs,
  titleLevel = 1,
  className,
}: {
  /**
   * The page's location as data, rendered by `Breadcrumb`: `ol`/`li`, a
   * separator the accessibility tree does not read, and `aria-current="page"`
   * on the crumb you are on.
   */
  trail?: readonly Crumb[]
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  /**
   * Heading level for `title`. Only for a header that sits under another
   * page's H1 — the client portal's project header, where the topbar owns the
   * page heading.
   */
  titleLevel?: 1 | 2 | 3
  className?: string
}) {
  const Title = `h${titleLevel}` as 'h1'
  return (
    <header
      data-page-header
      className={cn(
        'flex flex-col gap-1.5 border-b border-border bg-surface px-4 pt-3 md:px-6 md:pt-3.5',
        !tabs && 'pb-3',
        className,
      )}
    >
      {trail?.length ? <Breadcrumb trail={trail} /> : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Title className="min-w-0 flex-1 text-title max-md:basis-full max-md:text-[18px] max-md:leading-6 md:truncate">
          {title}
        </Title>
        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap gap-2">
            {actions}
          </div>
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
 *
 * `width` matches the screen's design canvas, which is the parity reference and is not always the
 * `--inspector-width` token (canvases use 280–340px). It is applied inline because the token's
 * `w-inspector` utility wins over a caller-supplied width class.
 */
export function Inspector({
  className,
  children,
  label = 'Details',
  width,
  open: controlledOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<'aside'> & {
  label?: string
  width?: number
  /** With an external toolbar trigger, omit the floating button. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  function setOpen(next: boolean) {
    setInternalOpen(next)
    onOpenChange?.(next)
  }
  return (
    <>
      <aside
        data-local-inspector
        aria-label={label}
        style={width === undefined ? undefined : { width }}
        className={cn(
          'hidden w-inspector shrink-0 flex-col gap-5 overflow-auto border-l border-border bg-surface p-4 xl:flex',
          className,
        )}
        {...props}
      >
        {children}
      </aside>
      {controlledOpen === undefined ? (
        <Button
          data-local-inspector-trigger
          type="button"
          size="lg"
          variant="secondary"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="fixed bottom-4 right-4 z-30 rounded-full shadow-overlay max-md:bottom-[76px] xl:hidden"
        >
          <Icon name="info" size={14} />
          {label}
        </Button>
      ) : null}
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
        // Inspector sections sit beside the page's `Section`s, not inside one:
        // they are the page's top-level sections, so they take the same H2
        // level. An H3 here made inspector-only pages (e.g. /protocols) jump
        // straight from the page H1 to H3.
        <h2 className="mb-1.5 font-sans text-label font-semibold">{title}</h2>
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
