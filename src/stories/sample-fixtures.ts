import type { SampleRecord } from '#/lib/samples'
import type {
  BoxChoice,
  PositionCell,
  PositionStatus,
} from '#/lib/storage-positions'
import { rowLetter } from '#/lib/storage-positions'

/**
 * Static samples and storage boxes the sample-area stories share. Nothing here
 * is read from a server: the stories seed these into a query cache or pass them
 * as props.
 */
export const SAMPLE_ID = '0198d970-e266-4000-8000-0000000005a1'
export const PROJECT_ID = '0198d970-e266-4000-8000-000000000b01'
export const WORKSPACE_ID = '0198d970-e266-4000-8000-000000000001'

export const sampleFixture = (
  overrides: Partial<SampleRecord> = {},
): SampleRecord => ({
  id: SAMPLE_ID,
  projectId: PROJECT_ID,
  kind: 'sample',
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  status: 'active',
  tags: ['harvest', 'lot-0934'],
  structureVersion: 1,
  metadataVersion: 3,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-24T10:30:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u-1',
  updatedByUserId: 'u-1',
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
  customFields: { batch: 'HL-0934' },
  sampleType: 'Cell harvest',
  quantity: 4600,
  quantityUnit: 'mL',
  storageLocation: 'Freezer F-02 / Shelf 3 / Box B4',
  barcode: 'SMP-LVV-0020',
  lowStockThreshold: 500,
  notes: 'Clarified harvest, held at 2–8 °C pending depth filtration.',
  holdCondition: '2–8 °C',
  holdStartedAt: '2026-09-20T00:00:00.000Z',
  holdDurationDays: 14,
  holdUntil: '2026-10-04T00:00:00.000Z',
  allowedUseExperimentIds: null,
  quarantineReason: null,
  quarantinedAt: null,
  disposalReason: null,
  disposedAt: null,
  releasedAt: null,
  releaseChecks: null,
  ...overrides,
})

export const BOX_ID = '0198d970-e266-4000-8000-000000000c01'

export const boxFixtures: BoxChoice[] = [
  {
    id: BOX_ID,
    name: 'Box B4',
    code: 'B4',
    rows: 4,
    cols: 6,
    held: 9,
    free: 15,
    above: ['Main site', 'Cold room', 'Freezer F-02', 'Shelf 3'],
    path: 'Main site / Cold room / Freezer F-02 / Shelf 3 / Box B4',
  },
  {
    id: '0198d970-e266-4000-8000-000000000c02',
    name: 'Box B5',
    code: 'B5',
    rows: 4,
    cols: 6,
    held: 24,
    free: 0,
    above: ['Main site', 'Cold room', 'Freezer F-02', 'Shelf 3'],
    path: 'Main site / Cold room / Freezer F-02 / Shelf 3 / Box B5',
  },
  {
    id: '0198d970-e266-4000-8000-000000000c03',
    name: 'Rack R1',
    code: 'R1',
    rows: 4,
    cols: 6,
    held: 3,
    free: 21,
    above: ['Main site', 'Cold room', 'Fridge F-07'],
    path: 'Main site / Cold room / Fridge F-07 / Rack R1',
  },
]

const OCCUPIED = new Map<number, string>([
  [0, 'SMP-2201'],
  [1, 'SMP-2202'],
  [2, 'SMP-2203'],
  [6, 'SMP-2210'],
  [7, 'SMP-2211'],
  [8, 'SMP-2212'],
  [12, 'SMP-2220'],
  [13, 'SMP-2221'],
  [14, 'SMP-2222'],
])

/** A 4 × 6 grid with nine positions held and one flagged missing. */
export function positionCells(boxId: string): PositionCell[] {
  return Array.from({ length: 24 }, (_, index) => {
    const rowIndex = Math.floor(index / 6)
    const colIndex = index % 6
    const identifier = OCCUPIED.get(index)

    const status: PositionStatus = identifier
      ? 'occupied'
      : index === 20
        ? 'missing'
        : 'available'

    return {
      id: `${boxId}-p${index}`,
      boxId,
      rowIndex,
      colIndex,
      label: `${rowLetter(rowIndex)}${colIndex + 1}`,
      status,
      occupant: identifier
        ? { id: `occ-${index}`, identifier, title: 'Harvest aliquot' }
        : null,
    }
  })
}
