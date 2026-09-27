import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { AlertCircle, PackagePlus, Plus, RefreshCw, Search } from 'lucide-react'

import { useShell } from '#/components/shell'
import {
  BoxGrid,
  BoxContentsTable,
  StorageFilters,
  StorageHierarchyBrowser,
  StorageInspector,
  StorageMetrics,
} from '#/components/storage'
import type {
  StorageFilterValue,
  StorageInspectorAction,
} from '#/components/storage'
import {
  Badge,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Skeleton,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookRecord, RecordWire } from '#/lib/notebook-data'
import { fetchSampleEvents } from '#/lib/samples'
import {
  createStorageBox,
  createStorageSite,
  describeStorageError,
  fetchBoxContents,
  fetchStorageBoxes,
  fetchStorageMovements,
  fetchStorageRacks,
  fetchStorageRooms,
  fetchStorageShelves,
  fetchStorageSites,
  fetchStorageUnits,
  lookupSampleByBarcode,
  moveSampleToPosition,
  removeSampleFromPosition,
  setPositionStatus,
  storageQueryKeys,
  canonicalStorageIdentifier,
  toRecord,
} from '#/lib/storage'

export const Route = createFileRoute('/storage')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: StorageRoute,
})

const dataClient = createDataClient()

function StorageRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [boxId, setBoxId] = useState<string | null>(null)
  const [rackId, setRackId] = useState<string | null>(null)
  const [positionId, setPositionId] = useState<string | null>(null)
  const [barcode, setBarcode] = useState('')
  const [pendingSample, setPendingSample] = useState<NotebookRecord | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [siteOpen, setSiteOpen] = useState(false)
  const [boxOpen, setBoxOpen] = useState(false)
  const [filters, setFilters] = useState<StorageFilterValue>({
    siteId: '',
    roomId: '',
    unitId: '',
    shelfId: '',
    rackId: '',
    boxId: '',
    status: '',
  })

  const sites = useQuery({
    queryKey: storageQueryKeys.sites,
    queryFn: () => fetchStorageSites(notebookDataClient),
  })
  const rooms = useQuery({
    queryKey: storageQueryKeys.rooms(filters.siteId || 'none'),
    queryFn: () => fetchStorageRooms(notebookDataClient, filters.siteId),
    enabled: Boolean(filters.siteId),
  })
  const units = useQuery({
    queryKey: storageQueryKeys.units(filters.roomId || 'none'),
    queryFn: () => fetchStorageUnits(notebookDataClient, filters.roomId),
    enabled: Boolean(filters.roomId),
  })
  const shelves = useQuery({
    queryKey: storageQueryKeys.shelves(filters.unitId || 'none'),
    queryFn: () => fetchStorageShelves(notebookDataClient, filters.unitId),
    enabled: Boolean(filters.unitId),
  })
  const racks = useQuery({
    queryKey: storageQueryKeys.racks(filters.shelfId || 'none'),
    queryFn: () => fetchStorageRacks(notebookDataClient, filters.shelfId),
    enabled: Boolean(filters.shelfId),
  })
  const boxes = useQuery({
    queryKey: storageQueryKeys.boxes(filters.rackId || 'none'),
    queryFn: () => fetchStorageBoxes(notebookDataClient, filters.rackId),
    enabled: Boolean(filters.rackId),
  })
  const contents = useQuery({
    queryKey: storageQueryKeys.positions(boxId ?? 'none'),
    queryFn: () => fetchBoxContents(notebookDataClient, boxId!),
    enabled: Boolean(boxId),
  })
  const positions = contents.data?.positions ?? []
  const hierarchyError =
    sites.error ||
    rooms.error ||
    units.error ||
    shelves.error ||
    racks.error ||
    boxes.error
  const visiblePositions = filters.status
    ? positions.filter((item) => item.status === filters.status)
    : positions
  const position = positions.find((item) => item.id === positionId) ?? null
  const sampleId = position?.sample?.id ?? null
  const movements = useQuery({
    queryKey: storageQueryKeys.movements(sampleId ?? 'none'),
    queryFn: () => fetchStorageMovements(notebookDataClient, sampleId!),
    enabled: Boolean(sampleId),
  })
  const events = useQuery({
    queryKey: ['ops-002', 'storage', 'events', sampleId],
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId!),
    enabled: Boolean(sampleId),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['ops-002', 'storage'] })
  }
  const action = useMutation({
    mutationFn: async (value: StorageInspectorAction) => {
      if (!position) throw new Error('Select a position first.')
      if (value.kind === 'move') {
        if (!pendingSample) throw new Error('Look up a sample first.')
        return moveSampleToPosition(dataClient, {
          recordId: pendingSample.id,
          toPositionId: position.id,
          expectedMetadataVersion: pendingSample.metadataVersion,
        })
      }
      if (value.kind === 'remove') {
        if (!position.sample) throw new Error('This position is empty.')
        const records = await notebookDataClient.list<RecordWire>(
          'records',
          `?id=eq.${position.sample.id}`,
        )
        const expected = records[0] ? toRecord(records[0]).metadataVersion : 0
        return removeSampleFromPosition(dataClient, {
          recordId: position.sample.id,
          expectedMetadataVersion: expected,
        })
      }
      return setPositionStatus(dataClient, position.id, value.status)
    },
    onSuccess: () => {
      setError(null)
      setPendingSample(null)
      invalidate()
    },
    onError: (cause) => setError(describeStorageError(cause)),
  })
  const lookup = useMutation({
    mutationFn: () => lookupSampleByBarcode(notebookDataClient, barcode.trim()),
    onSuccess: (wire) => {
      setPendingSample(wire ? toRecord(wire) : null)
      setError(wire ? null : 'No sample found for that barcode.')
    },
    onError: (cause) => setError(describeStorageError(cause)),
  })
  const createSiteMutation = useMutation({
    mutationFn: (value: { name: string; code: string }) =>
      createStorageSite(dataClient, { workspaceId, ...value }),
    onSuccess: () => {
      setSiteOpen(false)
      invalidate()
    },
    onError: (cause) => setError(describeStorageError(cause)),
  })
  const createBoxMutation = useMutation({
    mutationFn: (value: {
      name: string
      code: string
      rows: number
      cols: number
    }) =>
      createStorageBox(dataClient, { workspaceId, rackId: rackId!, ...value }),
    onSuccess: (box) => {
      setBoxOpen(false)
      setBoxId(box.id)
      invalidate()
    },
    onError: (cause) => setError(describeStorageError(cause)),
  })

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }
  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Storage' }],
    fullBleed: true,
    inspectorLabel: 'Storage position',
    inspector: (
      <StorageInspector
        position={position}
        box={contents.data?.box ?? null}
        positions={positions}
        pendingSample={pendingSample}
        movements={movements.data ?? []}
        events={events.data ?? []}
        loading={movements.isLoading || events.isLoading}
        actionPending={action.isPending}
        actionError={error}
        onAction={(value) => action.mutate(value)}
        onClose={() => setPositionId(null)}
      />
    ),
  })

  return (
    <>
      <div className="h-full overflow-auto bg-muted/20">
        <div className="space-y-3 p-3 lg:p-4 xl:space-y-4 xl:p-6">
          <PageHeader
            compact
            title="Freezer & Storage Map"
            description="Navigate storage locations, review capacity, and manage sample positions."
            className="gap-2 pb-2 lg:[&_[data-slot=page-header-content]>p]:hidden xl:gap-4 xl:pb-4 xl:[&_[data-slot=page-header-content]>p]:block"
          >
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={invalidate}>
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSiteOpen(true)}
              >
                <Plus className="size-3.5" /> New site
              </Button>
              <Button
                size="sm"
                onClick={() => setBoxOpen(true)}
                disabled={!rackId}
              >
                <PackagePlus className="size-3.5" /> New box
              </Button>
            </div>
          </PageHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (barcode.trim()) lookup.mutate()
              }}
            >
              <Input
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Scan or enter barcode"
                aria-label="Sample barcode"
                className="h-8 w-56"
              />
              <Button size="sm" type="submit" disabled={lookup.isPending}>
                <Search className="size-3.5" /> Look up
              </Button>
            </form>
            {pendingSample ? (
              <Badge variant="info">
                Pending move:{' '}
                {canonicalStorageIdentifier(pendingSample.identifier)} —{' '}
                {pendingSample.title}
                <button
                  type="button"
                  className="ml-2"
                  aria-label="Clear pending sample"
                  onClick={() => setPendingSample(null)}
                >
                  ×
                </button>
              </Badge>
            ) : null}
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Storage action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {hierarchyError ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Couldn&apos;t load storage locations</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>
                  Retry loading the hierarchy or refresh the workspace.
                </span>
                <Button size="sm" variant="outline" onClick={invalidate}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <StorageMetrics
            positions={positions}
            box={contents.data?.box ?? null}
          />
          <StorageFilters
            value={filters}
            onChange={(next) => {
              setFilters(next)
              if (next.rackId) setRackId(next.rackId)
              if (next.boxId && next.boxId !== boxId) {
                setBoxId(next.boxId)
                setPositionId(null)
              }
            }}
            sites={sites.data ?? []}
            rooms={rooms.data ?? []}
            units={units.data ?? []}
            shelves={shelves.data ?? []}
            racks={racks.data ?? []}
            boxes={boxes.data ?? []}
          />
          {sites.isLoading ? (
            <div className="grid min-h-[32rem] grid-cols-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <Skeleton className="h-full min-h-80" />
              <Skeleton className="h-full min-h-80" />
            </div>
          ) : (
            <div className="grid min-h-[32rem] grid-cols-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <StorageHierarchyBrowser
                sites={
                  filters.siteId
                    ? (sites.data ?? []).filter(
                        (site) => site.id === filters.siteId,
                      )
                    : (sites.data ?? [])
                }
                loading={sites.isLoading}
                selectedBoxId={boxId}
                onSelectBox={(id) => {
                  setBoxId(id)
                  setFilters((value) => ({ ...value, boxId: id }))
                  setPositionId(null)
                }}
                onSelectRack={setRackId}
              />
              <div className="min-w-0 space-y-4 overflow-auto">
                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(28rem,1fr)_minmax(30rem,1fr)]">
                  <BoxGrid
                    box={contents.data?.box ?? null}
                    positions={visiblePositions}
                    loading={contents.isLoading}
                    selectedPositionId={positionId}
                    onSelectPosition={setPositionId}
                  />
                  <BoxContentsTable
                    positions={visiblePositions}
                    selectedPositionId={positionId}
                    onSelectPosition={setPositionId}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <CreateSiteDialog
        open={siteOpen}
        onOpenChange={setSiteOpen}
        pending={createSiteMutation.isPending}
        onCreate={(value) => createSiteMutation.mutate(value)}
      />
      <CreateBoxDialog
        open={boxOpen}
        onOpenChange={setBoxOpen}
        pending={createBoxMutation.isPending}
        onCreate={(value) => createBoxMutation.mutate(value)}
      />
    </>
  )
}

function CreateSiteDialog({
  open,
  onOpenChange,
  pending,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onCreate: (value: { name: string; code: string }) => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New site</DialogTitle>
          <DialogDescription>Add a top-level storage site.</DialogDescription>
        </DialogHeader>
        <Label>
          Name
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label>
          Code
          <Input
            className="mt-1"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !name.trim() || !code.trim()}
            onClick={() => onCreate({ name: name.trim(), code: code.trim() })}
          >
            Create site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateBoxDialog({
  open,
  onOpenChange,
  pending,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onCreate: (value: {
    name: string
    code: string
    rows: number
    cols: number
  }) => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [rows, setRows] = useState('9')
  const [cols, setCols] = useState('9')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New box</DialogTitle>
          <DialogDescription>
            Create a position grid in the selected rack.
          </DialogDescription>
        </DialogHeader>
        <Label>
          Name
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label>
          Code
          <Input
            className="mt-1"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label>
            Rows
            <Input
              type="number"
              min="1"
              className="mt-1"
              value={rows}
              onChange={(e) => setRows(e.target.value)}
            />
          </Label>
          <Label>
            Columns
            <Input
              type="number"
              min="1"
              className="mt-1"
              value={cols}
              onChange={(e) => setCols(e.target.value)}
            />
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              pending ||
              !name.trim() ||
              !code.trim() ||
              Number(rows) < 1 ||
              Number(cols) < 1
            }
            onClick={() =>
              onCreate({
                name: name.trim(),
                code: code.trim(),
                rows: Number(rows),
                cols: Number(cols),
              })
            }
          >
            Create box
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
