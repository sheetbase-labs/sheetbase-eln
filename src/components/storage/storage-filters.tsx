import { Select } from '#/components/ui'
import type {
  StorageBox,
  StorageRack,
  StorageRoom,
  StorageShelf,
  StorageSite,
  StorageUnit,
} from '#/lib/storage'

export interface StorageFilterValue {
  siteId: string
  roomId: string
  unitId: string
  shelfId: string
  rackId: string
  boxId: string
  status: string
}

export function StorageFilters({
  value,
  onChange,
  sites,
  rooms,
  units,
  shelves,
  racks,
  boxes,
}: {
  value: StorageFilterValue
  onChange: (value: StorageFilterValue) => void
  sites: StorageSite[]
  rooms: StorageRoom[]
  units: StorageUnit[]
  shelves: StorageShelf[]
  racks: StorageRack[]
  boxes: StorageBox[]
}) {
  const fields = [
    ['siteId', 'Site', 'all', sites],
    ['roomId', 'Room', 'all', rooms],
    ['unitId', 'Freezer', 'all', units],
    ['shelfId', 'Shelf', 'all', shelves],
    ['rackId', 'Rack', 'all', racks],
    ['boxId', 'Box', 'all', boxes],
  ] as const
  const keys = fields.map(([key]) => key)
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Storage filters"
    >
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Scope
      </span>
      {fields.map(([key, label, empty, options], index) => (
        <span
          key={key}
          className="flex h-7 items-center gap-1 rounded-md border bg-card pl-2 text-xs shadow-xs"
        >
          <span className="text-muted-foreground">{label}</span>
          <Select
            aria-label={label}
            className="h-7 w-auto border-0 bg-transparent px-0 pr-5 text-xs shadow-none"
            style={{ backgroundPosition: 'right 0.25rem center' }}
            value={value[key]}
            onChange={(event) => {
              const next = { ...value, [key]: event.target.value }
              keys.slice(index + 1).forEach((child) => (next[child] = ''))
              onChange(next)
            }}
          >
            <option value="">{empty}</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </span>
      ))}
      <span className="flex h-7 items-center gap-1 rounded-md border bg-card pl-2 text-xs shadow-xs">
        <span className="text-muted-foreground">Status</span>
        <Select
          aria-label="Status"
          className="h-7 w-auto border-0 bg-transparent px-0 pr-5 text-xs shadow-none"
          style={{ backgroundPosition: 'right 0.25rem center' }}
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
        >
          <option value="">all</option>
          {['available', 'occupied', 'quarantined', 'missing'].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </span>
    </div>
  )
}
