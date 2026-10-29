/**
 * ChartConfigurator Propose-chart tests (ASSIST-02). The entry point builds
 * a chart_config proposal from the current dataset/fields, previews it
 * marked-generated, and loads the spec through the ordinary onSpecChange
 * on Accept; Discard leaves zero state.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { proposeChartSpec } from '#/lib/assist-drafts'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { ChartSpec } from '#/lib/chart-spec'

import { ChartConfigurator } from './chart-configurator'

afterEach(cleanup)

const TEMP_ID = '22222222-2222-4222-8222-222222222222'
const COND_ID = '33333333-3333-4333-8333-333333333333'

function source(): CanonicalDatasetSource {
  return {
    datasetId: '11111111-1111-4111-8111-111111111111',
    name: 'Assay',
    workspaceId: 'ws-1',
    schemaVersionId: '44444444-4444-4444-8444-444444444444',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [
      { id: TEMP_ID, label: 'Temperature', logicalType: 'number' },
      { id: COND_ID, label: 'Condition', logicalType: 'text' },
    ],
  }
}

function initialSpec() {
  const proposal = proposeChartSpec({
    datasetId: source().datasetId,
    fields: [{ fieldId: TEMP_ID, label: 'Temperature', logicalType: 'number' }],
  })
  if (!proposal) throw new Error('fixture spec must build')
  return proposal.spec
}

describe('ChartConfigurator Propose chart', () => {
  it('previews a generated proposal from the current dataset and loads it on Accept', () => {
    const onSpecChange = vi.fn()
    render(
      <ChartConfigurator
        source={source()}
        spec={initialSpec()}
        onSpecChange={onSpecChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Propose chart' }))
    expect(screen.getByRole('note', { name: 'Generated draft' })).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Accept and load chart' }),
    )
    expect(onSpecChange).toHaveBeenCalledTimes(1)
    expect(onSpecChange.mock.calls[0]?.[0]).toMatchObject({ type: 'bar' })
    // Accept clears the proposal.
    expect(screen.queryByRole('note', { name: 'Generated draft' })).toBeNull()
  })

  it('Discard leaves the spec untouched with zero state', () => {
    const onSpecChange = vi.fn()
    render(
      <ChartConfigurator
        source={source()}
        spec={initialSpec()}
        onSpecChange={onSpecChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Propose chart' }))
    expect(screen.getByRole('note', { name: 'Generated draft' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onSpecChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('note', { name: 'Generated draft' })).toBeNull()
  })
})

const X_ID = '55555555-5555-4555-8555-555555555555'
const Y_ID = '66666666-6666-4666-8666-666666666666'
const SD_ID = '77777777-7777-4777-8777-777777777777'

function errorSource(withErrorColumn: boolean): CanonicalDatasetSource {
  return {
    datasetId: '11111111-1111-4111-8111-111111111111',
    name: 'Assay',
    workspaceId: 'ws-1',
    schemaVersionId: '44444444-4444-4444-8444-444444444444',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [
      { id: Y_ID, label: 'Response', logicalType: 'decimal' },
      { id: X_ID, label: 'Temperature', logicalType: 'decimal' },
      ...(withErrorColumn
        ? [{ id: SD_ID, label: 'SD', logicalType: 'decimal' }]
        : []),
    ],
  }
}

function specFor(datasetSource: CanonicalDatasetSource) {
  const proposal = proposeChartSpec({
    datasetId: datasetSource.datasetId,
    fields: datasetSource.columns.map((column) => ({
      fieldId: column.id,
      label: column.label,
      logicalType: column.logicalType,
    })),
  })
  if (!proposal) throw new Error('fixture spec must build')
  return proposal.spec
}

describe('ChartConfigurator error-bar interval', () => {
  it('binds the explicit field option to a real column', () => {
    const onSpecChange = vi.fn()
    const datasetSource = errorSource(true)
    render(
      <ChartConfigurator
        source={datasetSource}
        spec={specFor(datasetSource)}
        onSpecChange={onSpecChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Error bar interval'), {
      target: { value: 'field' },
    })

    // Choosing the option used to return without touching the spec, so the
    // select snapped back to the previous interval.
    expect(onSpecChange).toHaveBeenCalledTimes(1)
    expect(onSpecChange.mock.calls[0]?.[0]?.overlays.errorBars).toMatchObject({
      fieldId: SD_ID,
    })
  })

  it('does not offer the explicit field option without an error column', () => {
    const datasetSource = errorSource(false)
    render(
      <ChartConfigurator
        source={datasetSource}
        spec={specFor(datasetSource)}
        onSpecChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('option', { name: 'Explicit field' })).toBeNull()
  })
})

describe('ChartConfigurator chart-type switching', () => {
  it('restores an X dimension when a heatmap follows a box plot', () => {
    // Box plots clear the X mapping (they reject one). Selecting heatmap next
    // used to leave the grid without a dimension, which threw inside the
    // materialiser and replaced the whole studio with the error surface.
    const onSpecChange = vi.fn()
    const datasetSource = errorSource(false)
    const boxSpec: ChartSpec = {
      ...specFor(datasetSource),
      type: 'box',
      fields: { ...specFor(datasetSource).fields, x: null },
    }
    render(
      <ChartConfigurator
        source={datasetSource}
        spec={boxSpec}
        onSpecChange={onSpecChange}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'heatmap' }))

    const next = onSpecChange.mock.calls[0]?.[0] as ChartSpec
    expect(next.type).toBe('heatmap')
    // The first measured field becomes the grid's X dimension.
    expect(next.fields.x).toEqual({ fieldId: Y_ID })
    expect(next.fields.series).toBeNull()
  })

  it('keeps the mapped X when a heatmap follows a chart that carries one', () => {
    const onSpecChange = vi.fn()
    const datasetSource = errorSource(false)
    render(
      <ChartConfigurator
        source={datasetSource}
        spec={specFor(datasetSource)}
        onSpecChange={onSpecChange}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'heatmap' }))

    const next = onSpecChange.mock.calls[0]?.[0] as ChartSpec
    expect(next.fields.x).toEqual({ fieldId: X_ID })
  })
})
