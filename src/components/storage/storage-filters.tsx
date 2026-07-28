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
    ['siteId', 'Site', sites],
    ['roomId', 'Room', rooms],
    ['unitId', 'Freezer', units],
    ['shelfId', 'Shelf', shelves],
    ['rackId', 'Rack', racks],
    ['boxId', 'Box', boxes],
  ] as const
  const keys = fields.map(([key]) => key)
  return (
    <div
      className="flex flex-wrap gap-2 rounded-lg border bg-card p-2"
      aria-label="Storage filters"
    >
      {fields.map(([key, label, options], index) => (
        <Select
          key={key}
          aria-label={label}
          className="h-8 min-w-28"
          value={value[key]}
          onChange={(event) => {
            const next = { ...value, [key]: event.target.value }
            keys.slice(index + 1).forEach((child) => (next[child] = ''))
            onChange(next)
          }}
        >
          <option value="">All {label.toLowerCase()}s</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      ))}
      <Select
        aria-label="Status"
        className="h-8 min-w-32"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value })}
      >
        <option value="">All statuses</option>
        {['available', 'occupied', 'quarantined', 'missing'].map((status) => (
          <option key={status} value={status}>
            {status[0].toUpperCase() + status.slice(1)}
          </option>
        ))}
      </Select>
    </div>
  )
}
