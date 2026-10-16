import {
  Avatar,
  AvatarStack,
  initialsFromName,
} from '#/components/v3/ui/avatar'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair — a person's initials, drawn the same way wherever they appear.
 *
 * Ours: the forward kit's `Avatar` and `AvatarStack`
 * (`src/components/v3/ui/avatar.tsx`). One rule derives initials from a name
 * (`initialsFromName`: the first letter of the first two words — `Gareth
 * Price` → `GP`), every surface renders through the one component, and the
 * stack owns the overlap ring and the `+N` chip. This pair is the change's
 * evidence that the same person now reads identically in a bare avatar, in a
 * stack and in a comment chip.
 *
 * Theirs: what the registry serves for this job is not a ReUI item —
 * `reui.io/r/base-nova/avatar.json` returns 404, and the catalogue lists
 * `avatar` as a stock shadcn component installed by bare name. The column
 * reproduces that stock avatar: `Avatar`/`AvatarImage`/`AvatarFallback` on
 * Radix, a fixed `size-8` box, `bg-muted text-xs font-medium` on the fallback
 * and no derivation — the caller supplies the string. It is shown with the
 * three spellings the six sites used before this change (the record header's
 * `name.slice(0, 2)`, the presence stack's two-word rule, and the comment
 * thread's `label.slice(0, 2)`), which is what that API leaves to its callers:
 * one person reads as three different initials. Reproduced rather than
 * vendored, because the decision is to decline the install.
 *
 * The fixture's rows are scientific samples; the pair treats each row's `name`
 * as a person's name, and its `note` as the person's display label where the
 * old comment thread used one (the label, not the name, which is how `Reviewer`
 * became `RE`). Both columns are handed the same fixture object.
 */

interface PersonRow {
  id: string
  name: string
  label: string
}

function peopleFor(rows: readonly ComparisonRow[]): PersonRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: row.note ?? row.name,
  }))
}

/** Ours: one component, one rule. */
function SharedInitialsColumn({ scenario }: ComparisonColumnProps) {
  const people = peopleFor(scenario.fixture.rows)
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div className="flex flex-col gap-3" data-comparison-list="ours">
      {people.length === 0 ? <ComparisonEmptyState /> : null}
      {people.slice(0, 3).map((person) => (
        <span key={person.id} className="inline-flex items-center gap-2">
          <Avatar name={person.name} size="sm" />
          <span className="text-xs">{person.name}</span>
        </span>
      ))}
      <AvatarStack
        label={`${people.length} here`}
        max={4}
        people={people.map((person) => ({
          id: person.id,
          name: person.name,
        }))}
      />
      {people.slice(0, 2).map((person) => (
        <span
          key={`chip-${person.id}`}
          className="inline-flex items-center gap-2"
        >
          <Avatar name={person.name} size="sm" />
          <span className="text-xs font-medium">{person.name}</span>
        </span>
      ))}
      <p className="text-label text-fg-muted">
        One rule: `{initialsFromName(people[0]?.name ?? '')}` for the first
        person, wherever they are drawn.
      </p>
    </div>
  )
}

/**
 * Theirs: the stock shadcn avatar, with each surface's caller-supplied
 * fallback string. Nothing derives anything.
 */
function StockAvatarColumn({ scenario }: ComparisonColumnProps) {
  const people = peopleFor(scenario.fixture.rows)
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  const visible = people.slice(0, 4)
  const overflow = people.length - visible.length
  return (
    <div className="flex flex-col gap-3" data-comparison-list="theirs">
      {people.length === 0 ? <ComparisonEmptyState /> : null}
      {people.slice(0, 3).map((person) => (
        <span key={person.id} className="inline-flex items-center gap-2">
          {/* The record header spelled it `name.slice(0, 2)`. */}
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">
            {person.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="text-xs">{person.name}</span>
        </span>
      ))}
      <span className="inline-flex -space-x-1.5">
        {visible.map((person) => (
          <span
            key={person.id}
            className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium ring-2 ring-surface"
          >
            {/* The presence stack took the first letter of two words. */}
            {initialsFromName(person.name)}
          </span>
        ))}
        {overflow > 0 ? (
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium ring-2 ring-surface">
            +{overflow}
          </span>
        ) : null}
      </span>
      {people.slice(0, 2).map((person) => (
        <span
          key={`chip-${person.id}`}
          className="inline-flex items-center gap-2"
        >
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">
            {/* The comment thread sliced the display label, not the name. */}
            {person.label.slice(0, 2).toUpperCase()}
          </span>
          <span className="text-xs font-medium">{person.label}</span>
        </span>
      ))}
    </div>
  )
}

export const avatarInitialsPair: ComparisonPair = {
  id: 'avatar-initials',
  title: 'Avatar initials across surfaces',
  job: "Draw a person's initials the same way wherever they appear",
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — one v3 Avatar and one initials rule',
    source: 'src/components/v3/ui/avatar.tsx',
    Column: SharedInitialsColumn,
  },
  theirs: {
    id: 'theirs',
    label:
      'Theirs — stock shadcn avatar, caller-supplied fallbacks (reproduced)',
    source:
      'registry: no @reui/avatar item (404); stock shadcn avatar, reproduced here',
    Column: StockAvatarColumn,
  },
}
