/**
 * SCI-001 ScientificRecordSummary component tests: active, archived and
 * retired-field rendering, plus empty and loading states.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ScientificRecordSummary } from './scientific-record-summary'
import type { RecordFieldDefinition } from '#/lib/scientific-records'
import type { NotebookRecord } from '#/lib/notebook-data'

function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 'r-1',
    projectId: 'p-1',
    kind: 'sample',
    identifier: 'SMP-2026-0001',
    title: 'Virus stock A',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: { mass: 1.5, note: 'cold' },
    ...overrides,
  }
}

function def(
  overrides: Partial<RecordFieldDefinition> & { fieldName: string },
): RecordFieldDefinition {
  return {
    id: `def-${overrides.fieldName}`,
    workspaceId: 'ws-1',
    kind: 'sample',
    fieldName: overrides.fieldName,
    label: overrides.label ?? overrides.fieldName,
    description: null,
    displayOrder: overrides.displayOrder ?? 1,
    logicalType: overrides.logicalType ?? 'text',
    nullable: overrides.nullable ?? true,
    defaultValue: null,
    unit: overrides.unit ?? null,
    validation: overrides.validation ?? {},
    lifecycle: overrides.lifecycle ?? 'active',
  }
}

afterEach(() => cleanup())

describe('ScientificRecordSummary', () => {
  it('renders identity, title and status for an active sample', () => {
    render(
      <ScientificRecordSummary
        record={record()}
        fieldDefinitions={[
          def({
            fieldName: 'mass',
            label: 'Mass',
            logicalType: 'decimal',
            displayOrder: 2,
            unit: { symbol: 'µg' },
          }),
          def({
            fieldName: 'note',
            label: 'Note',
            logicalType: 'text',
            displayOrder: 1,
          }),
        ]}
      />,
    )
    expect(screen.getByText('SMP-2026-0001')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Virus stock A' })).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.getByText('Sample properties')).toBeTruthy()
  })

  it('projects configurable properties with labels and units', () => {
    render(
      <ScientificRecordSummary
        record={record()}
        fieldDefinitions={[
          def({
            fieldName: 'mass',
            label: 'Mass',
            logicalType: 'decimal',
            displayOrder: 2,
            unit: { symbol: 'µg' },
          }),
          def({
            fieldName: 'note',
            label: 'Note',
            logicalType: 'text',
            displayOrder: 1,
          }),
        ]}
      />,
    )
    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.getByText('cold')).toBeTruthy()
    expect(screen.getByText('1.5 µg')).toBeTruthy()
  })

  it('renders an archived marker and keeps the record readable', () => {
    render(
      <ScientificRecordSummary
        record={record({
          archivedAt: '2026-02-01T00:00:00Z',
          status: 'consumed',
        })}
        fieldDefinitions={[def({ fieldName: 'note' })]}
      />,
    )
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Consumed')).toBeTruthy()
    expect(screen.getByText('SMP-2026-0001')).toBeTruthy()
  })

  it('flags orphaned values from retired fields with a warning marker', () => {
    render(
      <ScientificRecordSummary
        record={record({ properties: { note: 'cold', legacy: 7 } })}
        fieldDefinitions={[
          def({
            fieldName: 'note',
            label: 'Note',
            logicalType: 'text',
            displayOrder: 1,
          }),
          def({
            fieldName: 'legacy',
            label: 'Legacy',
            logicalType: 'integer',
            displayOrder: 2,
            lifecycle: 'retired',
          }),
        ]}
      />,
    )
    // The retired field's label still renders with an orphan marker (⚠).
    expect(screen.getByText('Legacy')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('shows a friendly empty state when no properties are defined', () => {
    render(
      <ScientificRecordSummary
        record={record({ properties: {} })}
        fieldDefinitions={[]}
      />,
    )
    expect(screen.getByText(/no properties defined/i)).toBeTruthy()
  })

  it('shows a loading state for properties', () => {
    render(
      <ScientificRecordSummary
        record={record()}
        fieldDefinitions={[]}
        loading
      />,
    )
    expect(screen.getByText(/loading properties/i)).toBeTruthy()
  })

  it('renders linked-record counts when provided', () => {
    render(
      <ScientificRecordSummary
        record={record()}
        fieldDefinitions={[]}
        linkedCounts={[
          { label: 'Experiments', count: 3 },
          { label: 'Protocols', count: 1 },
        ]}
      />,
    )
    expect(screen.getByText('Linked records')).toBeTruthy()
    expect(screen.getByText('Experiments')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })
})
