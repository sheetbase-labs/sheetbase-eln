import { Kbd } from '#/components/v3/ui/kbd'
import { Kbd as RegistryKbd, KbdGroup } from '#/components/reui/kbd'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair 3 — the keyboard-shortcut cap.
 *
 * Ours: `src/components/v3/ui/kbd.tsx`, a nine-line `<kbd>` bound to the v3
 * tokens (border, surface, fg-muted, 10px mono). A chord is three of them in
 * the flex row the call sites already write — the shortcuts dialog, the help
 * page, the search palette.
 *
 * Theirs: the stock shadcn `kbd` item (bare name on the same index as the ReUI
 * items; §11.3.4), placed under `src/components/reui/kbd.tsx` with the `cn`
 * import re-pointed and its classes restyled to the v3 tokens. It adds
 * `KbdGroup`, a `<kbd>` wrapper for a chord, and a treatment for caps sitting
 * inside tooltip content.
 *
 * Both columns render the same rows: one shortcut line per fixture row, the
 * row's name as the command and a chord derived from its index, so the long
 * label and the 5,000-row fixtures measure clipping and cost rather than
 * decoration.
 */

/** Deterministic chord per row: a modifier, sometimes a second, and a letter. */
function chordFor(index: number): readonly string[] {
  const letters = ['K', 'P', 'S', 'E', 'N', 'B']
  const letter = letters[index % letters.length] ?? 'K'
  switch (index % 4) {
    case 0:
      return ['⌘', letter]
    case 1:
      return ['⌘', '⇧', letter]
    case 2:
      return ['⌥', letter]
    default:
      return [letter]
  }
}

export function OursShortcutColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  const rows = scenario.fixture.rows
  return (
    <div
      className="flex flex-col"
      data-comparison-list="ours"
      data-shortcut-caps="v3-kbd"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row, index) => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="flex items-center gap-3 py-1"
        >
          <span className="min-w-0 flex-1 truncate text-body" title={row.name}>
            {row.name}
          </span>
          {/* The chord, as the call sites write it: a flex span of caps. */}
          <span className="flex shrink-0 items-center gap-1">
            {chordFor(index).map((key, keyIndex) => (
              <Kbd key={`${key}-${keyIndex}`}>{key}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TheirsShortcutColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  const rows = scenario.fixture.rows
  return (
    <div
      className="flex flex-col"
      data-comparison-list="theirs"
      data-shortcut-caps="registry-kbd"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row, index) => (
        <div
          key={row.id}
          data-row-id={row.id}
          className="flex items-center gap-3 py-1"
        >
          <span className="min-w-0 flex-1 truncate text-body" title={row.name}>
            {row.name}
          </span>
          {/* The candidate's own grouping: KbdGroup wraps the chord. */}
          <KbdGroup className="shrink-0">
            {chordFor(index).map((key, keyIndex) => (
              <RegistryKbd key={`${key}-${keyIndex}`}>{key}</RegistryKbd>
            ))}
          </KbdGroup>
        </div>
      ))}
    </div>
  )
}

export const shortcutKeysPair: ComparisonPair = {
  id: 'shortcut-keys',
  title: 'Keyboard shortcut cap',
  job: 'Show the keys that trigger a command',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — the v3 Kbd',
    source: 'src/components/v3/ui/kbd.tsx',
    Column: OursShortcutColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — the registry kbd (stock shadcn)',
    source: 'src/components/reui/kbd.tsx (registry: kbd)',
    Column: TheirsShortcutColumn,
  },
}
