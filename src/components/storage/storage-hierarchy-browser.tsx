import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronRight } from 'lucide-react'

import {
  Alert,
  AlertDescription,
  Badge,
  Empty,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  Skeleton,
} from '#/components/ui'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchStorageBoxes,
  fetchStorageRacks,
  fetchStorageRooms,
  fetchStorageShelves,
  fetchStorageUnits,
  storageQueryKeys,
  temperatureLabel,
} from '#/lib/storage'
import type {
  StorageBox,
  StorageRack,
  StorageRoom,
  StorageShelf,
  StorageSite,
  StorageUnit,
} from '#/lib/storage'
import { cn } from '#/lib/utils'

type Node =
  | StorageSite
  | StorageRoom
  | StorageUnit
  | StorageShelf
  | StorageRack
  | StorageBox

function details(node: Node) {
  const code = 'code' in node ? node.code : `Position ${node.position}`
  const environment =
    'temperatureMinC' in node
      ? temperatureLabel(node.temperatureMinC, node.temperatureMaxC)
      : null
  return { code, environment }
}

function TreeButton({
  node,
  level,
  expanded,
  selected,
  childCount,
  leaf,
  onClick,
}: {
  node: Node
  level: number
  expanded?: boolean
  selected: boolean
  childCount?: number
  leaf?: boolean
  onClick: () => void
}) {
  const info = details(node)
  return (
    <button
      type="button"
      className={cn(
        'relative flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        level > 0 &&
          'before:absolute before:top-1/2 before:left-[-1rem] before:h-px before:w-4 before:bg-border',
        selected && 'bg-primary/10 text-primary',
      )}
      aria-expanded={leaf ? undefined : expanded}
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
    >
      <ChevronRight
        className={cn(
          'mt-0.5 size-3.5 shrink-0 transition-transform',
          leaf && 'invisible',
          expanded && 'rotate-90',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{node.name}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {info.code}
        </span>
      </span>
      {childCount != null ? (
        <Badge variant="outline">{childCount}</Badge>
      ) : null}
    </button>
  )
}

interface BranchProps<T extends Node, TChild extends Node> {
  node: T
  level: number
  selectedId: string | null
  onSelect: (node: Node) => void
  queryKey: readonly unknown[]
  fetchChildren: () => Promise<TChild[]>
  renderChild: (child: TChild, level: number) => React.ReactNode
}

function Branch<T extends Node, TChild extends Node>(
  props: BranchProps<T, TChild>,
) {
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({
    queryKey: props.queryKey,
    queryFn: props.fetchChildren,
    enabled: expanded,
  })
  return (
    <li>
      <TreeButton
        node={props.node}
        level={props.level}
        expanded={expanded}
        selected={props.selectedId === props.node.id}
        childCount={query.data?.length}
        onClick={() => {
          props.onSelect(props.node)
          setExpanded((value) => !value)
        }}
      />
      {expanded ? (
        query.isLoading ? (
          <Skeleton className="ml-8 my-1 h-7 w-36" />
        ) : query.error ? (
          <Alert variant="destructive" className="mx-2 my-1 py-2 text-xs">
            <AlertDescription>
              Couldn&apos;t load this location.
            </AlertDescription>
          </Alert>
        ) : (
          <ul className="ml-4 border-l border-border">
            {query.data?.map((child) =>
              props.renderChild(child, props.level + 1),
            )}
          </ul>
        )
      ) : null}
    </li>
  )
}

export interface StorageHierarchyBrowserProps {
  sites: StorageSite[]
  loading?: boolean
  selectedBoxId?: string | null
  onSelectBox: (boxId: string) => void
  onSelectRack?: (rackId: string) => void
}

export function StorageHierarchyBrowser({
  sites,
  loading,
  selectedBoxId,
  onSelectBox,
  onSelectRack,
}: StorageHierarchyBrowserProps) {
  const [selected, setSelected] = useState<Node | null>(null)
  const select = (node: Node) => {
    setSelected(node)
    if ('shelfId' in node) onSelectRack?.(node.id)
  }
  const renderBox = (box: StorageBox, level: number) => (
    <li key={box.id}>
      <TreeButton
        node={box}
        level={level}
        leaf
        selected={selectedBoxId === box.id}
        onClick={() => {
          setSelected(box)
          onSelectBox(box.id)
        }}
      />
    </li>
  )
  const renderRack = (rack: StorageRack, level: number) => (
    <Branch
      key={rack.id}
      node={rack}
      level={level}
      selectedId={selected?.id ?? null}
      onSelect={select}
      queryKey={storageQueryKeys.boxes(rack.id)}
      fetchChildren={() => fetchStorageBoxes(notebookDataClient, rack.id)}
      renderChild={renderBox}
    />
  )
  const renderShelf = (shelf: StorageShelf, level: number) => (
    <Branch
      key={shelf.id}
      node={shelf}
      level={level}
      selectedId={selected?.id ?? null}
      onSelect={select}
      queryKey={storageQueryKeys.racks(shelf.id)}
      fetchChildren={() => fetchStorageRacks(notebookDataClient, shelf.id)}
      renderChild={renderRack}
    />
  )
  const renderUnit = (unit: StorageUnit, level: number) => (
    <Branch
      key={unit.id}
      node={unit}
      level={level}
      selectedId={selected?.id ?? null}
      onSelect={select}
      queryKey={storageQueryKeys.shelves(unit.id)}
      fetchChildren={() => fetchStorageShelves(notebookDataClient, unit.id)}
      renderChild={renderShelf}
    />
  )
  const renderRoom = (room: StorageRoom, level: number) => (
    <Branch
      key={room.id}
      node={room}
      level={level}
      selectedId={selected?.id ?? null}
      onSelect={select}
      queryKey={storageQueryKeys.units(room.id)}
      fetchChildren={() => fetchStorageUnits(notebookDataClient, room.id)}
      renderChild={renderUnit}
    />
  )

  return (
    <nav
      className="flex h-full min-h-80 flex-col rounded-lg border bg-card"
      aria-label="Storage hierarchy"
    >
      <div className="border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Storage hierarchy</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading ? (
          <Skeleton className="m-2 h-8" />
        ) : sites.length ? (
          <ul>
            {sites.map((site) => (
              <Branch
                key={site.id}
                node={site}
                level={0}
                selectedId={selected?.id ?? null}
                onSelect={select}
                queryKey={storageQueryKeys.rooms(site.id)}
                fetchChildren={() =>
                  fetchStorageRooms(notebookDataClient, site.id)
                }
                renderChild={renderRoom}
              />
            ))}
          </ul>
        ) : (
          <Empty className="min-h-52 border-0 p-4">
            <EmptyIcon>
              <Archive />
            </EmptyIcon>
            <EmptyTitle>No storage sites yet</EmptyTitle>
            <EmptyDescription>
              Create a site to begin mapping your storage locations.
            </EmptyDescription>
          </Empty>
        )}
      </div>
      {selected ? (
        <div className="border-t p-3 text-xs">
          <p className="font-medium">{selected.name}</p>
          <p className="text-muted-foreground">
            {details(selected).code} ·{' '}
            {details(selected).environment ?? 'Environment inherited'} ·
            Capacity {selected.capacity}
          </p>
        </div>
      ) : null}
    </nav>
  )
}
