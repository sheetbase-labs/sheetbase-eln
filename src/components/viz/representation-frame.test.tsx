/**
 * VIEW-01 — RepresentationFrame chrome tests: title, source/version badge,
 * frozen-vs-live badge, read-only/editable hint, and error state.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  SHEET_REPRESENTATION_CONFIG_VERSION,
  createRepresentationHandle,
} from '#/lib/representations'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import { RepresentationFrame } from './representation-frame'

afterEach(() => cleanup())

const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const VERSION_ID = '0198d970-e266-4000-8000-000000000010'
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000020'

function chartSpec(): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'line',
    datasets: [{ datasetId: DATASET_ID }],
    fields: {
      x: null,
      y: { fieldId: '0198d970-e266-4000-8000-000000000003' },
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
        x: { scale: 'linear' },
        y: { scale: 'linear' },
      },
      series: [],
    },
    overlays: { errorBars: null },
  }
}

describe('RepresentationFrame', () => {
  it('renders the title, a Live badge and the dataset source badge', () => {
    const handle = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: null },
      config: {
        kind: 'chart',
        configVersion: CHART_SPEC_VERSION,
        config: chartSpec(),
      },
      title: 'Assay trend',
    })
    render(
      <RepresentationFrame title="Assay trend" handle={handle}>
        <p>kind renderer output</p>
      </RepresentationFrame>,
    )
    expect(screen.getByText('Assay trend')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText(`Dataset ${DATASET_ID.slice(0, 8)}`)).toBeTruthy()
    expect(screen.queryByText('Snapshot')).toBeNull()
    expect(screen.getByText('kind renderer output')).toBeTruthy()
  })

  it('renders a Snapshot badge plus the pinned version when frozen', () => {
    const handle = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: VERSION_ID },
      config: {
        kind: 'chart',
        configVersion: CHART_SPEC_VERSION,
        config: chartSpec(),
      },
      title: 'Frozen trend',
    })
    render(
      <RepresentationFrame title="Frozen trend" handle={handle}>
        <p>snapshot output</p>
      </RepresentationFrame>,
    )
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    expect(
      screen.getByText(
        `Dataset ${DATASET_ID.slice(0, 8)} · v${VERSION_ID.slice(0, 8)}`,
      ),
    ).toBeTruthy()
  })

  it('marks editable sheet handles and keeps read-only kinds quiet', () => {
    const sheet = createRepresentationHandle({
      source: { datasetId: null, versionId: null },
      config: {
        kind: 'sheet',
        configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
        config: { instanceId: INSTANCE_ID },
      },
      title: 'Plate readings',
    })
    const { unmount } = render(
      <RepresentationFrame title="Plate readings" handle={sheet}>
        <p>grid</p>
      </RepresentationFrame>,
    )
    expect(screen.getByText(/editable/)).toBeTruthy()
    unmount()

    const chart = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: null },
      config: {
        kind: 'chart',
        configVersion: CHART_SPEC_VERSION,
        config: chartSpec(),
      },
      title: 'Trend',
    })
    render(
      <RepresentationFrame title="Trend" handle={chart}>
        <p>plot</p>
      </RepresentationFrame>,
    )
    expect(screen.queryByText(/editable/)).toBeNull()
  })

  it('renders the error state instead of children', () => {
    const handle = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: null },
      config: {
        kind: 'chart',
        configVersion: CHART_SPEC_VERSION,
        config: chartSpec(),
      },
      title: 'Trend',
    })
    render(
      <RepresentationFrame
        title="Trend"
        handle={handle}
        error="Source dataset is archived."
      >
        <p>should be hidden</p>
      </RepresentationFrame>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Source dataset is archived.')).toBeTruthy()
    expect(screen.queryByText('should be hidden')).toBeNull()
    // Chrome still identifies the representation behind the error.
    expect(screen.getByText('Trend')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
  })
})
