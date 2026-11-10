/**
 * The registry grid's columns: the lot's identity, its storage facts, its
 * hazards and its status, plus whatever added fields the material model
 * carries.
 */
import { useMemo } from 'react'

import { ObjectLink } from '#/components/ui/object-link'
import { Status } from '#/components/ui/status'
import { HazardPictograms } from '#/components/materials/material-safety'
import { rightAligned } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { useAddedFieldListColumns } from '#/components/models/added-fields'
import { withAddedColumns } from '#/components/models/added-field-columns'
import type { MaterialSafety } from '#/lib/material-safety'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

import { NARROW_HIDE } from './-materials-page-model'

/** The lot columns the registry always states. */
function baseMaterialColumns(
  safetyMap: Map<string, MaterialSafety> | undefined,
): RegistryColumn<MaterialListRow>[] {
  return [
    {
      id: 'identifier',
      header: 'ID',
      accessorFn: (m) => m.id,
      enableHiding: false,
      cell: ({ row }) => (
        <ObjectLink
          kind="material"
          id={row.original.uuid}
          identifier={row.original.id}
        />
      ),
    },
    {
      id: 'material',
      header: 'Material',
      accessorFn: (m) => m.name,
      cell: ({ row }) => (
        <span
          className="block max-w-[9.5rem] truncate"
          title={row.original.name}
        >
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'supplier',
      header: 'Supplier',
      accessorFn: (m) => m.supplier,
      meta: NARROW_HIDE,
    },
    { id: 'lot', header: 'Lot', accessorFn: (m) => m.lot },
    {
      id: 'stock',
      header: 'Stock',
      accessorFn: (m) => m.stock,
      enableSorting: false,
      meta: rightAligned<MaterialListRow>().meta,
    },
    {
      id: 'location',
      header: 'Location',
      accessorFn: (m) => m.location,
      cell: ({ row }) => (
        <span
          className="block max-w-[7rem] truncate"
          title={row.original.location}
        >
          {row.original.location}
        </span>
      ),
    },
    {
      id: 'expiry',
      header: t('library.materials.page.expiry'),
      accessorFn: (m) => m.expiry ?? undefined,
      cell: ({ row }) =>
        row.original.expiry ? (
          formatDate(row.original.expiry)
        ) : (
          <span className="text-fg-muted">—</span>
        ),
      meta: { exportValue: (m: MaterialListRow) => m.expiry ?? '' },
    },
    {
      id: 'hazards',
      header: t('safety.badge.column'),
      enableSorting: false,
      meta: NARROW_HIDE,
      cell: ({ row }) => (
        <HazardPictograms
          pictograms={safetyMap?.get(row.original.uuid)?.pictograms ?? []}
          size={20}
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (m) => m.status.label,
      cell: ({ row }) => (
        <Status tone={row.original.status.tone}>
          {row.original.status.label}
        </Status>
      ),
    },
  ]
}

/** Every column the grid shows: the lot's own, then the added fields. */
export function useMaterialColumns(
  safetyMap: Map<string, MaterialSafety> | undefined,
): RegistryColumn<MaterialListRow>[] {
  const addedColumns = useAddedFieldListColumns<MaterialListRow>(
    'material',
    'uuid',
  )

  const baseColumns = useMemo(() => baseMaterialColumns(safetyMap), [safetyMap])

  return useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
  )
}
