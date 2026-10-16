import * as React from 'react'

import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import {
  ComparisonErrorState,
  ComparisonLoadingRows,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonFixture,
  ComparisonPair,
} from '#/components/component-compare/types'
import { cn } from '#/lib/utils'

/**
 * Pair 2 — the empty state.
 *
 * Ours: the 37-line `EmptyState` this change replaces (`35423ec2`), vendored
 * here unchanged. It carries `title` and `body` and a `children` slot that
 * nothing documents as the action slot, so 67 of the product's 92 sites close
 * it with `/>` and offer no next step at all — the reason the pair exists. This
 * column renders the code the product ships *before* the change; the change
 * replaces it with `#/components/v3/ui/empty-state`, which is the file the
 * record's "what we use now" becomes. The runbook's "our side renders the code
 * that ships" rule is bent deliberately and only for this pair: the measured
 * "before" is the evidence the decision rests on, and it is deleted otherwise.
 *
 * Theirs: the item the ReUI catalogue lists as Empty. The ReUI registry serves
 * no such item — `https://reui.io/r/base-nova/empty.json` answers 404 with
 * "empty is part of shadcn/ui, not a ReUI item. Install it with: npx
 * shadcn@latest add empty" — so the candidate is the **stock shadcn `empty`
 * item**, taken by bare name under the pinned new-york-v4 style, vendored here
 * from `https://ui.shadcn.com/r/styles/new-york-v4/empty.json` and restyled to
 * the app-3 token vocabulary (`src/styles.css:683-707`) as the runbook's
 * "an adoption means restyling anyway" allows. Structure, semantics and
 * `data-slot`s are the item's, unchanged: a centred, border-dashed container
 * with `EmptyHeader`, `EmptyMedia` (`variant="icon"` or `default`),
 * `EmptyTitle`, `EmptyDescription` and `EmptyContent`. Two facts that only
 * show up when it is rendered are recorded rather than fixed, because fixing
 * them is the adoption decision: `EmptyTitle` and `EmptyDescription` are
 * `<div>`s (the item's empty state is not in the document's heading outline),
 * and `border-dashed` on its own draws nothing without a border width.
 *
 * Both columns are handed the same scenario and render the same copy, derived
 * from the fixture's own hostile content: the long-labels fixture puts the
 * 200-character scientific name in the title and its unit in the description,
 * and the empty fixture is the nothing-yet case. The action is real in both
 * columns — pressing it clears the "filter" and the empty state changes to the
 * nothing-yet copy — so the keyboard item can be answered by doing it.
 */

/** The 37-line implementation this change replaces, copied from `35423ec2`. */
function LegacyEmptyState({
  icon,
  title,
  body,
  children,
  className,
}: {
  icon?: IconName
  title: React.ReactNode
  body?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex max-w-[440px] flex-col items-start gap-2 py-8',
        className,
      )}
    >
      {icon ? (
        <span className="text-fg-muted">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <h2 className="text-section">{title}</h2>
      {body ? (
        <p className="m-0 text-body leading-5 text-fg-muted">{body}</p>
      ) : null}
      {children ? <div className="mt-1 flex gap-2">{children}</div> : null}
    </div>
  )
}

/**
 * The stock shadcn `empty` item, restyled to the app-3 vocabulary: `bg-muted`
 * → `bg-surface-muted`, `text-muted-foreground` → `text-fg-muted`, `text-sm` →
 * `text-body`, `text-lg` → `text-section`, and `cn` re-pointed to
 * `#/lib/utils` (the helper that teaches `tailwind-merge` the Sheetbase type
 * scale). Nothing else is changed.
 */
function ShadcnEmpty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12',
        className,
      )}
      {...props}
    />
  )
}

function ShadcnEmptyHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        'flex max-w-sm flex-col items-center gap-2 text-center',
        className,
      )}
      {...props}
    />
  )
}

function ShadcnEmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'icon' }) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(
        'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
        variant === 'icon' &&
          'size-10 shrink-0 rounded-lg bg-surface-muted text-fg',
        className,
      )}
      {...props}
    />
  )
}

function ShadcnEmptyTitle({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-title"
      className={cn('text-section font-medium tracking-tight', className)}
      {...props}
    />
  )
}

function ShadcnEmptyDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-description"
      className={cn('text-body/relaxed text-fg-muted', className)}
      {...props}
    />
  )
}

function ShadcnEmptyContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        'flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-body text-balance',
        className,
      )}
      {...props}
    />
  )
}

/** The copy both columns render, from the scenario's own fixture. */
const NOTHING_YET = {
  title: 'Nothing here yet',
  description:
    'Rows appear here once the list has something in it. This fixture has no rows.',
  action: 'Add the first row',
}

function copyFor(fixture: ComparisonFixture, restricted: boolean) {
  if (restricted) {
    return {
      title: 'You don’t have access to this list',
      description:
        'Its rows would appear here. Ask a workspace admin to add you.',
      action: null,
    }
  }
  const first = fixture.rows.at(0)
  if (!first) return NOTHING_YET
  return {
    title: `No rows match “${first.name}”`,
    description: `${first.unit} — nothing in this fixture matches the filter. Search looks at names, units and notes.`,
    action: 'Clear search',
  }
}

/** The scenario's copy, or the nothing-yet copy once the action has cleared it. */
function useEmptyCopy(scenario: ComparisonColumnProps['scenario']) {
  const [cleared, setCleared] = React.useState(false)
  const restricted = scenario.state === 'restricted'
  return {
    copy: cleared ? NOTHING_YET : copyFor(scenario.fixture, restricted),
    restricted,
    clear: () => setCleared(true),
  }
}

/**
 * Ours. The pre-change component takes the action through its `children` slot,
 * because that is the only place it can go; the column says so with
 * `data-action-slot="none"` rather than pretending the component offers one.
 */
function LegacyEmptyStateColumn({ scenario }: ComparisonColumnProps) {
  const { copy, restricted, clear } = useEmptyCopy(scenario)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-empty="ours" data-action-slot="none">
      <LegacyEmptyState
        icon={restricted ? 'lock' : copy.action ? 'search' : 'table'}
        title={copy.title}
        body={copy.description}
      >
        {copy.action ? <Button onClick={clear}>{copy.action}</Button> : null}
      </LegacyEmptyState>
    </div>
  )
}

/** Theirs: the item as published, restyled to tokens. */
function ShadcnEmptyColumn({ scenario }: ComparisonColumnProps) {
  const { copy, restricted, clear } = useEmptyCopy(scenario)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div data-comparison-empty="theirs" data-action-slot="empty-content">
      <ShadcnEmpty>
        <ShadcnEmptyHeader>
          <ShadcnEmptyMedia variant="icon">
            <Icon name={restricted ? 'lock' : 'search'} size={24} />
          </ShadcnEmptyMedia>
          <ShadcnEmptyTitle>{copy.title}</ShadcnEmptyTitle>
          <ShadcnEmptyDescription>{copy.description}</ShadcnEmptyDescription>
        </ShadcnEmptyHeader>
        {copy.action ? (
          <ShadcnEmptyContent>
            <Button onClick={clear}>{copy.action}</Button>
          </ShadcnEmptyContent>
        ) : null}
      </ShadcnEmpty>
    </div>
  )
}

export const emptyStatePair: ComparisonPair = {
  id: 'empty-state',
  title: 'Empty state — say what is absent and offer the next action',
  job:
    'Explain why a list, panel or table has nothing in it, and offer the one ' +
    'relevant next step (DESIGN.md, Application states).',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — the 37-line EmptyState this change replaces',
    source: 'src/components/v3/ui/empty-state.tsx @ 35423ec2 (vendored above)',
    Column: LegacyEmptyStateColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — stock shadcn `empty`, restyled to app-3 tokens',
    source:
      'shadcn registry:ui `empty` (ui.shadcn.com/r/styles/new-york-v4/empty.json), by bare name; ReUI serves no empty item (404)',
    Column: ShadcnEmptyColumn,
  },
}
