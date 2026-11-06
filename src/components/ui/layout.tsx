import { useEffect, useRef, useState } from 'react'
import { Icon } from '#/components/icons'
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
  compact = false,
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
  /**
   * A phone header that gives the screen back to the page: the title on one
   * line with the actions beside it, one meta line, then the tabs. Scrolling
   * down folds it to the title and the actions; scrolling up brings it back.
   * Desktop is unchanged.
   */
  compact?: boolean
  className?: string
}) {
  const Title = `h${titleLevel}` as 'h1'
  const ref = useRef<HTMLElement>(null)
  const collapsed = useCollapsedOnScroll(ref, compact)
  return (
    <header
      ref={ref}
      data-page-header
      data-compact={compact || undefined}
      data-collapsed={collapsed || undefined}
      className={cn(
        'group/header flex flex-col gap-1.5 border-b border-border bg-surface px-4 pt-3 md:px-6 md:pt-3.5',
        !tabs && 'pb-3',
        compact && 'max-md:data-[collapsed]:py-2',
        className,
      )}
    >
      {trail?.length ? (
        <div
          className={cn(
            compact && 'max-md:group-data-[collapsed]/header:hidden',
          )}
        >
          <Breadcrumb trail={trail} />
        </div>
      ) : null}
      {/* On a phone the actions follow the meta on the same line, instead of
          taking a line of their own, so the header is a row shorter above the
          content. They wrap to the next line only when the meta is long. */}
      <div
        className={cn(
          'grid grid-cols-[minmax(10rem,1fr)_auto] items-center gap-x-2 gap-y-1.5',
          compact
            ? 'max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-1'
            : 'max-md:flex max-md:flex-wrap max-md:gap-x-3.5 max-md:gap-y-1',
        )}
      >
        <Title
          className={cn(
            'col-start-1 row-start-1 min-w-0 text-title max-md:text-[18px] max-md:leading-6 md:truncate',
            compact
              ? 'max-md:truncate'
              : meta
                ? 'max-md:mb-0.5 max-md:w-full'
                : 'max-md:flex-1 max-md:basis-40',
          )}
        >
          {title}
        </Title>
        {actions ? (
          <div
            data-page-actions
            className={cn(
              'col-start-2 row-start-1 flex max-w-full flex-wrap justify-end gap-2',
              compact
                ? 'max-md:flex-nowrap max-md:items-center'
                : 'max-md:order-last max-md:ml-auto',
            )}
          >
            {actions}
          </div>
        ) : null}
        {meta ? (
          <div
            data-page-meta
            className={cn(
              'col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-label text-fg-muted',
              compact
                ? 'max-md:group-data-[collapsed]/header:hidden'
                : 'max-md:contents',
            )}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {tabs ? (
        <div
          data-page-tabs
          className={cn(
            '-mx-4 mt-1 max-md:-mt-1 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6',
            compact && 'max-md:group-data-[collapsed]/header:hidden',
          )}
        >
          {tabs}
        </div>
      ) : null}
    </header>
  )
}

/**
 * Whether a compact header has folded away. Scrolling down through the page
 * below it folds it; scrolling back up, or reaching the top, unfolds it. The
 * gaps between the two thresholds keep it from flickering as its own height
 * moves the content.
 */
function useCollapsedOnScroll(
  header: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const root = header.current?.parentElement
    if (!enabled || !root) return
    const last = new WeakMap<EventTarget, number>()
    // Folding the header changes the height of the page under it, which moves
    // the scroll position by itself. Those scrolls are the layout settling,
    // not the person scrolling, so they are ignored for a moment after each
    // change; otherwise the header can fold and unfold in a loop.
    let settledAt = 0
    const change = (next: boolean) => {
      settledAt = Date.now() + 350
      setCollapsed(next)
    }
    const typing = () => {
      const active = document.activeElement
      return (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          /^(input|textarea|select)$/i.test(active.tagName))
      )
    }
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || header.current?.contains(target))
        return
      const top = target.scrollTop
      const previous = last.get(target) ?? 0
      last.set(target, top)
      // While writing, the page scrolls to keep the caret in view; the header
      // stays as it is rather than moving under the person's hands.
      if (typing() || Date.now() < settledAt) return
      if (top < 24) change(false)
      else if (top - previous > 6 && top > 96) change(true)
      else if (previous - top > 6) change(false)
    }
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', onScroll, { capture: true })
  }, [header, enabled])
  return enabled && collapsed
}

/**
 * Right-hand panel for properties and provenance. Inline when its pane is at least 1100px wide; below that it folds away
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
          aria-label={label}
          title={label}
          className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] right-4 z-30 rounded-full shadow-overlay xl:hidden"
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
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
        <h2 className="text-section">{title}</h2>
        {count != null ? (
          <span className="num text-label text-fg-muted">{count}</span>
        ) : null}
        {/* Actions wrap beneath the heading when the pane is too narrow for
            both, rather than running off its edge. */}
        {action ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {action}
          </div>
        ) : null}
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
