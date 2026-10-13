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
      screen.getByRole('button', { name: 'Accept and load spec' }),
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

    expect(
      screen.queryByRole('option', { name: 'Explicit field' }),
    ).toBeNull()
  })
})
