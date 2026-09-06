/**
 * AnalysisFigureGuide entry-point tests (ASSIST-03). The studio mount
 * derives live guide state and routes accepts to the studio's canonical
 * paths: propose runs the identical promote hand-off (spec passes the
 * canonical validator), and the record-less embed accept navigates to the
 * notebook surface instead of writing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComparativeViewConfig } from '#/lib/comparative-view'
import { validateChartSpec } from '#/lib/chart-spec'

import { AnalysisFigureGuide } from './analysis-figure-guide'

afterEach(cleanup)

const DATASET_ID = '11111111-1111-4111-8111-111111111111'
const TEMP_ID = '22222222-2222-4222-8222-222222222222'
const COND_ID = '33333333-3333-4333-8333-333333333333'

function validConfig(): ComparativeViewConfig {
  return {
    configVersion: 1,
    datasetId: DATASET_ID,
    versionId: null,
    viewType: 'distribution',
    timeField: null,
    valueField: TEMP_ID,
    groupBy: [COND_ID],
    facetBy: null,
  }
}

function columns() {
  return [
    { id: TEMP_ID, label: 'Temperature', logicalType: 'number' },
    { id: COND_ID, label: 'Condition', logicalType: 'text' },
  ]
}

describe('AnalysisFigureGuide', () => {
  it('derives the dataset step from live studio state', () => {
    render(
      <AnalysisFigureGuide
        datasetId={DATASET_ID}
        columnCount={0}
        rowCount={0}
        compareConfig={null}
        chartSpecReady={false}
      />,
    )
    expect(screen.getByLabelText('Guide: Analysis to figure')).toBeTruthy()
    expect(
      screen.getByLabelText(/Step 1: Dataset ready \(Current\)/),
    ).toBeTruthy()
  })

  it('proposes through the canonical promote hand-off', () => {
    const onPromoteGuide = vi.fn()
    render(
      <AnalysisFigureGuide
        datasetId={DATASET_ID}
        columnCount={2}
        rowCount={10}
        compareConfig={validConfig()}
        columns={columns()}
        chartSpecReady={false}
        onPromoteGuide={onPromoteGuide}
      />,
    )
    expect(
      screen.getByLabelText(/Step 3: Chart proposed \(Current\)/),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Propose chart from compare config' }),
    )
    expect(onPromoteGuide).toHaveBeenCalledTimes(1)
    const spec = onPromoteGuide.mock.calls[0]?.[0]
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('does not promote an invalid compare config', () => {
    const onPromoteGuide = vi.fn()
    render(
      <AnalysisFigureGuide
        datasetId={DATASET_ID}
        columnCount={2}
        rowCount={10}
        compareConfig={null}
        chartSpecReady={false}
        onPromoteGuide={onPromoteGuide}
      />,
    )
    expect(
      screen.getByLabelText(/Step 2: Compare configured \(Current\)/),
    ).toBeTruthy()
    // The propose accept only exists on the chart step — an invalid config
    // offers navigation, never a promote executor.
    expect(
      screen.queryByRole('button', {
        name: 'Propose chart from compare config',
      }),
    ).toBeNull()
    expect(onPromoteGuide).not.toHaveBeenCalled()
  })

  it('navigates to the notebook surface for the record-less embed accept', () => {
    const onNavigateGuide = vi.fn()
    render(
      <AnalysisFigureGuide
        datasetId={DATASET_ID}
        columnCount={2}
        rowCount={10}
        compareConfig={validConfig()}
        columns={columns()}
        chartSpecReady
        onNavigateGuide={onNavigateGuide}
      />,
    )
    expect(
      screen.getByLabelText(/Step 4: Figure embedded \(Current\)/),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Embed figure in notebook' }),
    )
    expect(onNavigateGuide).toHaveBeenCalledWith('/')
  })
})
