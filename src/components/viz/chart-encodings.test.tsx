/**
 * R5-STUDIO-02 — encoding authoring tests.
 *
 * Both authoring paths (drag onto a role slot, keyboard through the role
 * select or a field's role menu) must build the same ChartSpec; an assignment
 * a role cannot take is refused with a stated reason and leaves the spec
 * untouched; and every role is reachable without a pointer.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChartConfigurator } from '#/components/viz/chart-configurator'
import {
  CHART_ROLES,
  FIELD_DRAG_TYPE,
  ROLE_LABEL,
  checkAssignment,
  columnsForRole,
} from '#/lib/chart-encodings'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec, ChartType } from '#/lib/chart-spec'
import type { CanonicalDatasetSource } from '#/lib/chart-data'

afterEach(cleanup)

const TIME_ID = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const PH_ID = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const BUFFER_ID = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const COLUMNS: ChartColumn[] = [
  { id: TIME_ID, label: 'Time (h)', logicalType: 'decimal' },
  { id: PH_ID, label: 'pH', logicalType: 'decimal' },
  { id: BUFFER_ID, label: 'Buffer', logicalType: 'category' },
]

const SOURCE: CanonicalDatasetSource = {
  datasetId: '11111111-1111-1111-8111-111111111111',
  name: 'Stability',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 1,
  columns: COLUMNS,
}

function baseSpec(type: ChartType = 'scatter'): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type,
    datasets: [{ datasetId: SOURCE.datasetId }],
    fields: {
      x: { fieldId: TIME_ID },
      y: { fieldId: PH_ID },
      series: null,
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Time (h)', scale: 'linear' },
        y: { label: 'pH', scale: 'linear' },
      },
      series: [{ identifier: 'all', label: 'all', color: '#006EDC' }],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
}

/** Controlled harness: records every emitted spec and re-renders from it. */
function Harness({
  initial,
  emitted,
}: {
  initial: ChartSpec
  emitted: ChartSpec[]
}) {
  const [spec, setSpec] = useState(initial)
  return (
    <ChartConfigurator
      source={SOURCE}
      spec={spec}
      onSpecChange={(next) => {
        emitted.push(next)
        setSpec(next)
      }}
    />
  )
}

/** The `DataTransfer` surface a drop handler reads; jsdom builds none itself. */
function transfer(fieldId: string) {
  const store: Record<string, string> = { [FIELD_DRAG_TYPE]: fieldId }
  return {
    types: [FIELD_DRAG_TYPE],
    effectAllowed: 'copy',
    dropEffect: 'copy',
    setData: (type: string, value: string) => {
      store[type] = value
    },
    getData: (type: string) => store[type] ?? '',
  }
}

function renderConfigurator(initial = baseSpec()) {
  const emitted: ChartSpec[] = []
  const { container } = render(<Harness initial={initial} emitted={emitted} />)
  const view = within(container)
  const slotOf = (role: string) => {
    const slot = container.querySelector(`[data-drop-role="${role}"]`)
    if (!slot) throw new Error(`role slot ${role} is not rendered`)
    return slot
  }
  return {
    emitted,
    view,
    slotOf,
    drag: (label: string) => {
      const row = view
        .getByRole('button', { name: `Assign ${label} to a role` })
        .closest('li')
      if (!row) throw new Error(`no field row for ${label}`)
      const id = COLUMNS.find((column) => column.label === label)?.id ?? ''
      fireEvent.dragStart(row, { dataTransfer: transfer(id) })
    },
    dropOn: (role: string, fieldId: string) =>
      fireEvent.drop(slotOf(role), { dataTransfer: transfer(fieldId) }),
  }
}

describe('chart encoding authoring paths', () => {
  it('produces the same spec by dropping a field and by choosing it', async () => {
    const byKeyboard = renderConfigurator()
    await userEvent.selectOptions(
      byKeyboard.view.getByLabelText('X-axis field'),
      PH_ID,
    )
    const keyboardSpec = byKeyboard.emitted.at(-1)
    cleanup()

    const byDrop = renderConfigurator()
    byDrop.dropOn('x', PH_ID)

    expect(keyboardSpec?.fields.x?.fieldId).toBe(PH_ID)
    expect(byDrop.emitted.at(-1)).toEqual(keyboardSpec)
  })

  it('refuses a category on a measured role with a stated reason', () => {
    const { emitted, view, dropOn } = renderConfigurator()

    dropOn('y', BUFFER_ID)

    const alert = view.getByRole('alert')
    expect(alert.textContent).toMatch(/measured number/i)
    expect(alert.textContent).toContain('Buffer')
    expect(emitted).toHaveLength(0)
    expect(view.getByLabelText('Y-axis field')).toHaveProperty(
      'value',
      PH_ID,
    )
  })

  it('keeps the spec unchanged when the role has no such encoding', () => {
    const { emitted, view } = renderConfigurator(baseSpec('heatmap'))

    expect(view.queryByLabelText('Colour field')).toBeNull()
    expect(view.queryByLabelText('Size field')).toBeNull()
    expect(emitted).toHaveLength(0)
    expect(checkAssignment('colour', COLUMNS[2], 'heatmap')).toEqual({
      ok: false,
      reason: expect.stringMatching(/heatmap/i),
    })
  })

  it('reaches every role through the keyboard-only controls', async () => {
    const { emitted, view } = renderConfigurator()

    await userEvent.selectOptions(
      view.getByLabelText('X-axis field'),
      TIME_ID,
    )
    await userEvent.selectOptions(view.getByLabelText('Y-axis field'), PH_ID)
    await userEvent.selectOptions(
      view.getByLabelText('Colour field'),
      BUFFER_ID,
    )
    await userEvent.selectOptions(view.getByLabelText('Size field'), TIME_ID)
    await userEvent.selectOptions(
      view.getByLabelText('Facet field'),
      BUFFER_ID,
    )

    const spec = emitted.at(-1)
    expect(spec?.fields.x?.fieldId).toBe(TIME_ID)
    expect(spec?.fields.y.fieldId).toBe(PH_ID)
    expect(spec?.fields.color?.fieldId).toBe(BUFFER_ID)
    expect(spec?.fields.size?.fieldId).toBe(TIME_ID)
    expect(spec?.fields.facet?.fieldId).toBe(BUFFER_ID)
    // Every role the shelf offers is bound: none is reachable only by drop.
    for (const role of CHART_ROLES)
      expect(columnsForRole(role, COLUMNS, 'scatter').length > 0).toBe(true)
  })

  it('assigns a field from its role menu', async () => {
    const { emitted, view } = renderConfigurator()

    view.getByRole('button', { name: 'Assign pH to a role' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    // The menu renders in a portal on document.body, outside the container.
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /size/i }),
    )

    expect(emitted.at(-1)?.fields.size?.fieldId).toBe(PH_ID)
  })

  it('announces the drag state, the result and the refusal', () => {
    const { view, drag, dropOn } = renderConfigurator()

    drag('pH')
    expect(view.getByRole('status').textContent).toMatch(/Picked up pH/i)

    dropOn('x', PH_ID)
    expect(view.getByRole('status').textContent).toContain(
      `pH assigned to ${ROLE_LABEL.x}`,
    )

    dropOn('y', BUFFER_ID)
    expect(view.getByRole('alert').textContent).toMatch(/measured number/i)
  })

  it('lists a draggable row for every column, grouped honestly', () => {
    const { view } = renderConfigurator()

    const measured = view.getByRole('list', { name: 'Measured fields' })
    expect(within(measured).getByText('pH')).toBeTruthy()
    const metadata = view.getByRole('list', { name: 'Run metadata fields' })
    expect(within(metadata).getByText('Buffer')).toBeTruthy()
    // No calculated marker exists on the chart source, so nothing is claimed.
    expect(view.queryByRole('list', { name: 'Derived fields' })).toBeNull()
  })
})
