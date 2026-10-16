import * as React from 'react'

import { Field, Input } from '#/components/v3/ui/input'
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldScrubArea,
} from '#/components/reui/number-field'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair 2 — the numeric quantity field.
 *
 * Ours: there is no shared numeric component. Every quantity, volume and
 * parameter value is the kit's `Input` carrying `type="number"` (or
 * `inputMode="decimal"`), labelled by `Field`, with a per-screen check written
 * inline. This column reproduces `src/routes/materials.tsx`'s received-quantity
 * field — `Field` + `Input type="number"` + a submit-time finite-and-positive
 * test — because that is the pattern the other twenty-odd numeric call sites
 * repeat with their own wording.
 *
 * Theirs: ReUI's `@reui/number-field` (base-nova pin), a wrapper over Base
 * UI's `NumberField`: a group holding a decrement button, the input and an
 * increment button, plus a scrub area whose label drags the value. Installed
 * with the shadcn CLI and placed under `src/components/reui/` with the `cn`
 * import re-pointed at `#/lib/utils` and its classes restyled to the v3 token
 * vocabulary.
 *
 * The two columns are given the same rows. A row's `value` is what the field is
 * asked to hold: the `mixed-types` fixture hands both sides a numeric string, a
 * date, a non-numeric label, a null, and `NaN`/`Infinity`, and the
 * `high-precision` fixture hands them digits that a careless formatter drops.
 */

/** The inline check the screens write for themselves (materials.tsx:783-790). */
function quantityError(raw: string): string | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '') return 'Enter the quantity received, greater than zero.'
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'Enter the quantity received, greater than zero.'
  }
  return null
}

/** What a numeric field can be handed from the fixture: a number, or nothing. */
function initialNumber(row: ComparisonRow): number | null {
  return typeof row.value === 'number' && Number.isFinite(row.value)
    ? row.value
    : null
}

/** The same row content on both sides: name, unit, and what the field holds. */
function RowFrame({
  row,
  held,
  children,
}: {
  row: ComparisonRow
  held: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-1" data-row-id={row.id}>
      <span
        className="w-2/5 min-w-0 truncate pt-1 text-label"
        title={row.name}
        data-slot="comparison-row-name"
      >
        {row.name}
      </span>
      <div className="w-44 shrink-0">{children}</div>
      <span
        className="min-w-0 flex-1 pt-1 text-label text-fg-muted"
        title={row.unit}
      >
        {row.unit}
      </span>
      <span
        className="w-32 shrink-0 pt-1 text-right font-mono text-label text-fg-muted"
        data-held-value
      >
        {held}
      </span>
    </div>
  )
}

/**
 * Ours. The field is uncontrolled-input-plus-state, exactly as the screens hold
 * it: a string in state, the browser's own number parsing on the way in, and a
 * message under the field once the value cannot be a quantity.
 */
export function OursQuantityColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [raw, setRaw] = React.useState<readonly string[]>(() =>
    rows.map((row) => (row.value == null ? '' : String(row.value))),
  )
  const restricted = scenario.state === 'restricted'

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div
      className="flex flex-col"
      data-comparison-list="ours"
      data-numeric-control="input-type-number"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row, index) => {
        const value = raw[index] ?? ''
        const error = restricted ? null : quantityError(value)
        return (
          <RowFrame key={row.id} row={row} held={value === '' ? '—' : value}>
            <Field label="Quantity" error={error}>
              <Input
                type="number"
                aria-invalid={error !== null}
                value={value}
                disabled={restricted}
                onChange={(event) => {
                  const next = [...raw]
                  next[index] = event.target.value
                  setRaw(next)
                }}
              />
            </Field>
          </RowFrame>
        )
      })}
    </div>
  )
}

/**
 * Theirs. The value is the candidate's own `number | null` contract rather than
 * a string, so a fixture value the field cannot hold arrives as an empty field —
 * which is itself one of the things being compared.
 */
export function TheirsQuantityColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const [values, setValues] = React.useState<readonly (number | null)[]>(() =>
    rows.map(initialNumber),
  )
  const restricted = scenario.state === 'restricted'

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div
      className="flex flex-col"
      data-comparison-list="theirs"
      data-numeric-control="base-ui-number-field"
    >
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {rows.map((row, index) => {
        const value = values[index] ?? null
        return (
          <RowFrame
            key={row.id}
            row={row}
            held={value === null ? '—' : String(value)}
          >
            <NumberField
              value={value}
              onValueChange={(next) => {
                const copy = [...values]
                copy[index] = next
                setValues(copy)
              }}
              disabled={restricted}
              size="sm"
            >
              <NumberFieldScrubArea label="Quantity" />
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label={`Decrease ${row.name}`} />
                {/* No `aria-label` here: the item labels its own input from the
                    scrub area's `<label>`, and that is what axe checks. The
                    step buttons take a per-row name the way pair 1's handle
                    does, because they are not on the keyboard path. */}
                <NumberFieldInput />
                <NumberFieldIncrement aria-label={`Increase ${row.name}`} />
              </NumberFieldGroup>
            </NumberField>
          </RowFrame>
        )
      })}
    </div>
  )
}

export const quantityFieldPair: ComparisonPair = {
  id: 'quantity-field',
  title: 'Numeric quantity field',
  job: 'Enter a numeric quantity that carries a unit',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — the v3 Input with type="number"',
    source:
      'src/components/v3/ui/input.tsx, as written in src/routes/materials.tsx',
    Column: OursQuantityColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — ReUI number field (base-nova)',
    source:
      'src/components/reui/number-field.tsx (registry: @reui/number-field)',
    Column: TheirsQuantityColumn,
  },
}
