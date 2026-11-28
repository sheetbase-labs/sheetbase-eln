import { use, useEffect, useRef, useState } from 'react'
import { Icon } from '#/components/icons'
import { Breadcrumb } from './breadcrumb'
import type { Crumb } from './breadcrumb'
import { Button } from './button'
import { SectionLayoutContext } from './section-layout'
import type { SectionLayoutMode } from './section-layout'
import { Sheet, SheetContent } from './sheet'
import { cn } from '#/lib/utils'

// Page structure: header plane, content, inspector (right = properties and provenance).
export function PageHeader({
  trail,
  title,
  meta,
  actions,
  tabs,
  notice,
  titleLevel = 1,
  paneTitle,
  compact = false,
  wrapTitle = false,
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
   * One line about the page's state (in review, expiring, read-only) between
   * the meta and the tabs. It takes the place of banners stacked above the
   * content, so the page says its state once, where the eye already is.
   */
  notice?: React.ReactNode
  /**
   * Heading level for `title`. Only for a header that sits under another
   * page's H1 — the client portal's project header, where the topbar owns the
   * page heading.
   */
  titleLevel?: 1 | 2 | 3
  /**
   * The name the pane tab and browser tab use when the heading says more
   * than the page's name, such as Home's "Good morning, Gareth".
   */
  paneTitle?: string
  /**
   * A phone header that gives the screen back to the page: the title on one
   * line with the actions beside it, one meta line, then the tabs. Scrolling
   * down folds it to the title and the actions; scrolling up brings it back.
   * Desktop is unchanged.
   */
  compact?: boolean
  /**
   * Let a long title run to a second line instead of ending in an ellipsis:
   * a record's name is how people tell it apart, so it is shown whole.
   */
  wrapTitle?: boolean
  className?: string
}) {
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
      <HeaderTrail trail={trail} compact={compact} />
      {/* On a phone the actions follow the meta on the same line, instead of
          taking a line of their own, so the header is a row shorter above the
          content. They wrap to the next line only when the meta is long. */}
      <div
        className={cn(
          'grid items-center gap-x-2 gap-y-1.5',
          gridClassName(compact),
        )}
      >
        <PageHeaderTitle
          titleLevel={titleLevel}
          paneTitle={paneTitle}
          hasMeta={Boolean(meta)}
          compact={compact}
          wrap={wrapTitle}
        >
          {title}
        </PageHeaderTitle>
        <HeaderActions compact={compact}>{actions}</HeaderActions>
        <HeaderMeta compact={compact}>{meta}</HeaderMeta>
      </div>
      {notice ? (
        <div
          data-page-notice
          className={cn(
            'mt-0.5',
            compact && 'max-md:group-data-[collapsed]/header:hidden',
          )}
        >
          {notice}
        </div>
      ) : null}
      <HeaderTabs compact={compact}>{tabs}</HeaderTabs>
    </header>
  )
}

const PAGE_TITLE_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3' } as const

function gridClassName(compact: boolean): string {
  return compact
    ? 'grid-cols-[minmax(10rem,1fr)_auto] max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-1'
    : 'grid-cols-[minmax(10rem,1fr)_auto] max-md:flex max-md:flex-wrap max-md:gap-x-3.5 max-md:gap-y-1'
}

function titleClassName(compact: boolean, hasMeta: boolean): string {
  if (compact) return 'max-md:truncate'

  return hasMeta
    ? 'max-md:mb-0.5 max-md:w-full'
    : 'max-md:flex-1 max-md:basis-40'
}

function PageHeaderTitle({
  titleLevel,
  paneTitle,
  hasMeta,
  compact,
  wrap,
  children,
}: {
  titleLevel: 1 | 2 | 3
  paneTitle?: string
  hasMeta: boolean
  compact: boolean
  wrap: boolean
  children: React.ReactNode
}) {
  const Title = PAGE_TITLE_TAGS[titleLevel]

  return (
    <Title
      data-pane-title={paneTitle}
      className={cn(
        'col-start-1 row-start-1 min-w-0 text-title max-md:text-[18px] max-md:leading-6',
        wrap ? 'line-clamp-2 text-balance break-words' : 'md:truncate',
        titleClassName(compact && !wrap, hasMeta),
      )}
    >
      {children}
    </Title>
  )
}

function HeaderTrail({
  trail,
  compact,
}: {
  trail?: readonly Crumb[]
  compact: boolean
}) {
  if (!trail?.length) return null

  return (
    <div
      className={cn(compact && 'max-md:group-data-[collapsed]/header:hidden')}
    >
      <Breadcrumb trail={trail} />
    </div>
  )
}

function HeaderActions({
  compact,
  children,
}: {
  compact: boolean
  children?: React.ReactNode
}) {
  if (!children) return null

  return (
    <div
      data-page-actions
      className={cn(
        'col-start-2 row-start-1 flex max-w-full flex-wrap justify-end gap-2',
        compact
          ? 'max-md:flex-nowrap max-md:items-center'
          : 'max-md:order-last max-md:ml-auto',
      )}
    >
      {children}
    </div>
  )
}

function HeaderMeta({
  compact,
  children,
}: {
  compact: boolean
  children?: React.ReactNode
}) {
  if (!children) return null

  return (
    <div
      data-page-meta
      className={cn(
        'col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-label text-fg-muted',
        compact
          ? 'max-md:group-data-[collapsed]/header:hidden'
          : 'max-md:contents',
      )}
    >
      {children}
    </div>
  )
}

function HeaderTabs({
  compact,
  children,
}: {
  compact: boolean
  children?: React.ReactNode
}) {
  if (!children) return null

  return (
    <div
      data-page-tabs
      className={cn(
        '-mx-4 mt-1 max-md:-mt-1 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6',
        compact && 'max-md:group-data-[collapsed]/header:hidden',
      )}
    >
      {children}
    </div>
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
 * True while the person is reading down a page. The floating Details button
 * folds away then, so it never sits over the text or table they are reading,
 * and comes back as soon as they scroll up or stop at the top.
 */
function useTuckedAwayWhileScrollingDown(enabled: boolean): boolean {
  const [tucked, setTucked] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const last = new WeakMap<EventTarget, number>()

    const onScroll = (event: Event) => {
      const target = event.target

      const y =
        target instanceof HTMLElement ? target.scrollTop : window.scrollY

      const before = last.get(target ?? window) ?? 0

      if (Math.abs(y - before) < 8) return

      last.set(target ?? window, y)
      setTucked(y > before && y > 80)
    }

    // Scroll does not bubble: listen in the capture phase to hear the page's
    // own scroller, wherever it is.
    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })

    return () =>
      window.removeEventListener('scroll', onScroll, { capture: true })
  }, [enabled])

  return tucked
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

  const tuckedAway = useTuckedAwayWhileScrollingDown(
    controlledOpen === undefined,
  )

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
          'hidden w-inspector shrink-0 flex-col gap-6 overflow-auto border-l border-border bg-surface px-5 py-5 xl:flex',
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
          data-tucked={tuckedAway || undefined}
          className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] right-4 z-30 rounded-full shadow-overlay transition-[opacity,translate] duration-200 data-[tucked]:pointer-events-none data-[tucked]:translate-y-24 data-[tucked]:opacity-0 data-[tucked]:focus-visible:pointer-events-auto data-[tucked]:focus-visible:translate-y-0 data-[tucked]:focus-visible:opacity-100 xl:hidden print:hidden"
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
  action,
  children,
}: {
  title?: React.ReactNode
  /** A link or control at the end of the heading's rule. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      {title ? (
        // Inspector sections sit beside the page's `Section`s, not inside one:
        // they are the page's top-level sections, so they take the same H2
        // level. An H3 here made inspector-only pages (e.g. /protocols) jump
        // straight from the page H1 to H3.
        // The title leads a hairline across the panel, like a page Section,
        // so each group of facts reads as its own block.
        <h2
          data-section-heading
          className="mb-2.5 flex items-center gap-2.5 font-display text-[13px] font-semibold leading-5 text-fg"
        >
          <span className="min-w-0 truncate">{title}</span>
          <span aria-hidden className="h-px min-w-4 flex-1 bg-border-subtle" />
          {action ? (
            <span className="shrink-0 font-sans text-label font-normal">
              {action}
            </span>
          ) : null}
        </h2>
      ) : null}
      {children}
    </section>
  )
}

export function SectionLayout({
  mode,
  children,
}: {
  mode: SectionLayoutMode
  children: React.ReactNode
}) {
  return <SectionLayoutContext value={mode}>{children}</SectionLayoutContext>
}

export function Section({
  title,
  count,
  description,
  action,
  wide = false,
  children,
  className,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  /** One or two muted lines on what the section is for, under the heading. */
  description?: React.ReactNode
  action?: React.ReactNode
  /**
   * Settings only: a section whose content is a wide table (many columns or
   * long text) keeps its heading above the table instead of beside it, so
   * the table gets the pane's whole width.
   */
  wide?: boolean
  children: React.ReactNode
  className?: string
}) {
  const mode = use(SectionLayoutContext)

  if (mode === 'settings') {
    return (
      <SettingsSection
        title={title}
        count={count}
        description={description}
        action={action}
        wide={wide}
        className={className}
      >
        {children}
      </SettingsSection>
    )
  }

  if (mode === 'nested') {
    return (
      <section className={cn('flex flex-col gap-2.5', className)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 data-section-heading className="text-body font-medium text-fg">
            {title}
          </h3>
          {count != null ? (
            <span className="num -ml-1.5 text-label text-fg-muted">
              {count}
            </span>
          ) : null}
          <span className="flex-1" />
          {action ? (
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          ) : null}
        </div>
        {description ? (
          <p className="-mt-1.5 text-label text-fg-muted text-pretty">
            {description}
          </p>
        ) : null}
        {children}
      </section>
    )
  }

  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      {/* The heading leads a hairline that runs to the section's actions, so
          each section reads as its own block without a box around it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 data-section-heading className="text-section">
          {title}
        </h2>
        {count != null ? (
          <span className="num -ml-1 text-label text-fg-muted">{count}</span>
        ) : null}
        <span
          aria-hidden
          data-section-rule
          className="h-px min-w-4 flex-1 bg-border-subtle"
        />
        {/* Actions wrap beneath the heading when the pane is too narrow for
            both, rather than running off its edge. */}
        {action ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {action}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="-mt-1 max-w-[72ch] text-label text-fg-muted text-pretty">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A settings section: heading, description and actions in a fixed column on
 * the left, the controls on the right. Forms in the right column keep to a
 * readable measure; a table there takes the full width. Under 48rem of pane
 * the two columns stack. Sections are divided by a hairline (styles.css).
 */
function SettingsSection({
  title,
  count,
  description,
  action,
  wide,
  children,
  className,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  wide: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      data-settings-section
      data-wide={wide || undefined}
      className={cn(
        'grid gap-x-10 gap-y-3',
        !wide && '@3xl/settings:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5',
          wide &&
            '@3xl/settings:grid @3xl/settings:grid-cols-[minmax(0,1fr)_auto] @3xl/settings:items-start @3xl/settings:gap-x-6',
        )}
      >
        <h2 data-section-heading className="text-section text-pretty">
          {title}
          {count != null ? (
            <span className="num ml-2 font-sans text-label font-normal text-fg-muted">
              {count}
            </span>
          ) : null}
        </h2>
        {description ? (
          <p
            className={cn(
              'text-label leading-[18px] text-fg-muted text-pretty',
              wide && 'max-w-[72ch]',
            )}
          >
            {description}
          </p>
        ) : null}
        {action ? (
          <div
            className={cn(
              'mt-1.5 flex flex-wrap items-center gap-2',
              wide &&
                '@3xl/settings:col-start-2 @3xl/settings:row-span-2 @3xl/settings:row-start-1 @3xl/settings:mt-0',
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
      <SectionLayoutContext value="nested">
        <div data-settings-controls className="flex min-w-0 flex-col gap-4">
          {children}
        </div>
      </SectionLayoutContext>
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
      className={cn('m-0 grid gap-x-3 gap-y-2 text-label', className)}
      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
    >
      {items.map(([k, v], i) => (
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Each row's identity is its position in the caller's fixed label/value table; labels are display text and need not be unique, so a row can only be identified by where the caller placed it.
        <div key={i} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="m-0 min-w-0 font-medium text-fg">{v}</dd>
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
