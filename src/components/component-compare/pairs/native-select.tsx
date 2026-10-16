import * as React from 'react'

import { Field } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '#/components/reui/native-select'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonFixture,
  ComparisonPair,
  ComparisonRow,
} from '#/components/component-compare/types'

/**
 * Pair 2 — the option picker.
 *
 * Ours: `Select` (`src/components/v3/ui/select.tsx`), the v3 kit's **native**
 * `<select>` styled like `Input` — what ships, and what the change that added
 * this row hoisted into `src/components/v3/ui/` out of `projects/select.tsx`.
 * Native is the repository's stated choice, for the reasons the component's own
 * doc comment gives: keyboard handling, typeahead, `<optgroup>`, disabled
 * options, form participation and the platform picker are the element's, and a
 * JS listbox would have to rebuild all of it.
 *
 * Theirs: the **stock shadcn** `native-select` item, installed by bare name
 * from the shadcn registry and placed at
 * `src/components/reui/native-select.tsx`. The ReUI registry serves neither
 * `native-select` nor `select`, so this is not a ReUI item and there is no
 * base-nova build of it to install — the comparison record's row says so. It is
 * restyled to Sheetbase tokens, because an adoption means restyling anyway, and
 * it keeps its own structure: a `div` wrapper, a lucide chevron,
 * `size="default"|"sm"` heights of 36/32px, `data-slot`s, and
 * `NativeSelectOption`/`NativeSelectOptGroup` wrappers that pin the popup's
 * colours to the OS `Canvas`/`CanvasText` system colours.
 *
 * Both columns render the same controls against the same fixture option list: a
 * form-sized select inside `<Field>` so its accessible name comes from the
 * label, a compact select beside it, and value/disabled readouts. In the
 * restricted state each column disables its own control, so what a disabled
 * picker looks like stays the component's own business. The 5,000-row fixture
 * is the hostile cost case: 5,000 `<option>`s in one select.
 */

interface ControlProps {
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}

interface ColumnBodyProps {
  readonly scenario: ComparisonColumnProps['scenario']
  readonly side: 'ours' | 'theirs'
  /** The form-sized control, inside the same `<Field>` in both columns. */
  readonly field: (props: ControlProps) => React.ReactNode
  /** The compact toolbar control. */
  readonly compact: (props: ControlProps) => React.ReactNode
}

/** The column's own chrome: a labelled field, a compact control, the value. */
function ColumnBody({ scenario, side, field, compact }: ColumnBodyProps) {
  const [value, setValue] = React.useState(
    () => scenario.fixture.rows[0]?.id ?? '',
  )
  const disabled = scenario.state === 'restricted'
  const props: ControlProps = {
    value,
    disabled,
    onChange: (next) => setValue(next),
  }

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col gap-4" data-comparison-select={side}>
      {disabled ? <ComparisonRestrictedNotice /> : null}
      {scenario.fixture.rows.length === 0 ? <ComparisonEmptyState /> : null}
      <Field label="Sample">{field(props)}</Field>
      <div className="flex items-center gap-2">
        <span className="text-label text-fg-muted">Toolbar</span>
        {compact(props)}
      </div>
      <p className="text-label text-fg-muted">
        Selected{' '}
        <span className="font-mono" data-comparison-selection={side}>
          {value || '—'}
        </span>
      </p>
      <p
        className="text-label text-fg-muted"
        data-comparison-select-disabled={disabled}
      >
        {disabled ? 'Editing is refused: view only.' : 'Editing is available.'}
      </p>
    </div>
  )
}

/** Fixture rows grouped by kind, plus the disabled option. */
function optionsFor(fixture: ComparisonFixture): Array<{
  readonly group: string
  readonly rows: readonly ComparisonRow[]
}> {
  const byKind = new Map<string, ComparisonRow[]>()
  for (const row of fixture.rows) {
    const key = row.kind ?? 'Unclassified'
    const bucket = byKind.get(key)
    if (bucket) bucket.push(row)
    else byKind.set(key, [row])
  }
  return [...byKind].map(([group, rows]) => ({ group, rows }))
}

/** One option's label: the hostile axes land here (long names, null values). */
function optionLabel(row: ComparisonRow): string {
  const value =
    typeof row.value === 'number' ? String(row.value) : (row.value ?? '—')
  return `${row.name} · ${value} ${row.unit}`
}

/** The empty fixture gets one honest option rather than an empty popup. */
function OursOptions({ fixture }: { fixture: ComparisonFixture }) {
  if (fixture.rows.length === 0) {
    return <option value="">No rows in this fixture</option>
  }
  return (
    <>
      {optionsFor(fixture).map(({ group, rows }) => (
        <optgroup key={group} label={group}>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {optionLabel(row)}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="custom" disabled>
        Custom (set by the assay)
      </option>
    </>
  )
}

/** The candidate's own wrappers, so its option/optgroup rendering is what runs. */
function TheirsOptions({ fixture }: { fixture: ComparisonFixture }) {
  if (fixture.rows.length === 0) {
    return (
      <NativeSelectOption value="">No rows in this fixture</NativeSelectOption>
    )
  }
  return (
    <>
      {optionsFor(fixture).map(({ group, rows }) => (
        <NativeSelectOptGroup key={group} label={group}>
          {rows.map((row) => (
            <NativeSelectOption key={row.id} value={row.id}>
              {optionLabel(row)}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
      <NativeSelectOption value="custom" disabled>
        Custom (set by the assay)
      </NativeSelectOption>
    </>
  )
}

function OursColumn({ scenario }: ComparisonColumnProps) {
  return (
    <ColumnBody
      scenario={scenario}
      side="ours"
      field={({ value, disabled, onChange }) => (
        <Select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-comparison-select-control="field"
        >
          <OursOptions fixture={scenario.fixture} />
        </Select>
      )}
      compact={({ value, disabled, onChange }) => (
        <Select
          aria-label="Filter samples"
          size="sm"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-comparison-select-control="compact"
        >
          <OursOptions fixture={scenario.fixture} />
        </Select>
      )}
    />
  )
}

function TheirsColumn({ scenario }: ComparisonColumnProps) {
  return (
    <ColumnBody
      scenario={scenario}
      side="theirs"
      field={({ value, disabled, onChange }) => (
        <NativeSelect
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-comparison-select-control="field"
        >
          <TheirsOptions fixture={scenario.fixture} />
        </NativeSelect>
      )}
      compact={({ value, disabled, onChange }) => (
        <NativeSelect
          aria-label="Filter samples"
          size="sm"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-comparison-select-control="compact"
        >
          <TheirsOptions fixture={scenario.fixture} />
        </NativeSelect>
      )}
    />
  )
}

export const nativeSelectPair: ComparisonPair = {
  id: 'native-select',
  title: 'Option picker (native select)',
  job: 'Choose one option from a list, with grouping, disabled options and a label',
  controls: ['picker'],
  ours: {
    id: 'ours',
    label: 'Ours — v3 native Select',
    source:
      'src/components/v3/ui/select.tsx (hoisted from projects/select.tsx)',
    Column: OursColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — stock shadcn native-select',
    source:
      'src/components/reui/native-select.tsx (shadcn registry item `native-select`; the ReUI registry serves neither `native-select` nor `select`)',
    Column: TheirsColumn,
  },
}
