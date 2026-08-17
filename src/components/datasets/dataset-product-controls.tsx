import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Archive, Camera, Plus } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetWire } from '#/lib/dataset-explorer-data'
import {
  archiveDataset,
  commitDatasetRowBatch,
  createDataset,
  datasetRevision,
  describeDatasetCommitError,
  listPublishedDatasetSchemas,
  restoreDataset,
  snapshotDataset,
} from '#/lib/dataset-product'

export function DatasetCreateDialog({
  open,
  onOpenChange,
  client,
  workspaceId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: DataClient
  workspaceId: string
  onCreated: (datasetId: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schemaVersionId, setSchemaVersionId] = useState('')
  const schemasQuery = useQuery({
    queryKey: ['dataset-published-schemas'],
    queryFn: () => listPublishedDatasetSchemas(client),
    enabled: open,
  })
  const createMutation = useMutation({
    mutationFn: () =>
      createDataset(client, {
        workspaceId,
        schemaVersionId,
        name,
        description,
      }),
    onSuccess: (created) => {
      onCreated(created.id)
      onOpenChange(false)
      setName('')
      setDescription('')
      setSchemaVersionId('')
    },
  })
  const schemas = schemasQuery.data ?? []
  const error =
    createMutation.error instanceof Error
      ? createMutation.error.message
      : schemasQuery.error instanceof Error
        ? schemasQuery.error.message
        : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Dataset</DialogTitle>
          <DialogDescription>
            Create a live Dataset from a published Schema Version. Rows are
            written later through the same Dataset commit RPC used by Sheets.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label className="text-xs text-muted-foreground">
            Schema Version
            <Select
              className="mt-1 h-9"
              aria-label="Schema Version"
              value={schemaVersionId}
              onChange={(event) => setSchemaVersionId(event.target.value)}
            >
              <option value="">
                {schemasQuery.isLoading
                  ? 'Loading schemas…'
                  : 'Select a published Schema'}
              </option>
              {schemas.map((schema) => (
                <option key={schema.schemaVersionId} value={schema.schemaVersionId}>
                  {schema.name} · {schema.key} v{schema.version}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="text-xs text-muted-foreground">
            Name
            <Input
              className="mt-1 h-9"
              aria-label="Dataset name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label className="text-xs text-muted-foreground">
            Description
            <Textarea
              className="mt-1 min-h-16 text-xs"
              aria-label="Dataset description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Label>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={
              createMutation.isPending || !name.trim() || !schemaVersionId
            }
          >
            {createMutation.isPending ? 'Creating…' : 'Create Dataset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DatasetSnapshotDialog({
  open,
  onOpenChange,
  client,
  table,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: DataClient
  table: CanonicalDatasetWire
  onDone: () => void
}) {
  const [label, setLabel] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      snapshotDataset(client, {
        datasetId: table.id,
        expectedRevision: datasetRevision(table),
        label,
      }),
    onSuccess: () => {
      onDone()
      onOpenChange(false)
      setLabel('')
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Snapshot Dataset</DialogTitle>
          <DialogDescription>
            Capture an immutable Version of the current live rows. Later live
            edits do not change this Version.
          </DialogDescription>
        </DialogHeader>
        <Label className="text-xs text-muted-foreground">
          Version label
          <Input
            className="mt-1 h-9"
            aria-label="Snapshot label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Freeze before write-back"
          />
        </Label>
        {mutation.error instanceof Error ? (
          <p role="alert" className="text-xs text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !label.trim()}
          >
            {mutation.isPending ? 'Snapshotting…' : 'Create Version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DatasetPasteDialog({
  open,
  onOpenChange,
  client,
  table,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: DataClient
  table: CanonicalDatasetWire
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const mutation = useMutation({
    mutationFn: async () => {
      const rows = parseTsvRows(text, table.columns)
      if (rows.length === 0) throw new Error('Paste at least one TSV row.')
      const result = await commitDatasetRowBatch(client, {
        datasetId: table.id,
        expectedRevision: datasetRevision(table),
        rows,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!result.ok) throw new Error(describeDatasetCommitError(result))
      return result
    },
    onSuccess: () => {
      onDone()
      onOpenChange(false)
      setText('')
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paste rows</DialogTitle>
          <DialogDescription>
            Tab-separated values in Schema field order. This uses{' '}
            <code>commit_dataset_row_batch</code>, not a separate importer.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Columns: {table.columns.map((column) => column.label).join(' · ') || 'none'}
        </p>
        <Textarea
          aria-label="Pasted TSV rows"
          className="min-h-32 font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {mutation.error instanceof Error ? (
          <p role="alert" className="text-xs text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !text.trim()}
          >
            {mutation.isPending ? 'Committing…' : 'Commit rows'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DatasetAddRowDialog({
  open,
  onOpenChange,
  client,
  table,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: DataClient
  table: CanonicalDatasetWire
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const mutation = useMutation({
    mutationFn: async () => {
      const rowValues: Record<string, unknown> = {}
      for (const column of table.columns) {
        const raw = values[column.id] ?? ''
        rowValues[column.id] = raw === '' ? null : coerceLoose(column.logical_type, raw)
      }
      const result = await commitDatasetRowBatch(client, {
        datasetId: table.id,
        expectedRevision: datasetRevision(table),
        idempotencyKey: crypto.randomUUID(),
        rows: [
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: rowValues,
          },
        ],
      })
      if (!result.ok) throw new Error(describeDatasetCommitError(result))
      return result
    },
    onSuccess: () => {
      onDone()
      onOpenChange(false)
      setValues({})
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add row</DialogTitle>
          <DialogDescription>
            Create a live Dataset row through the existing commit RPC.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 gap-3 overflow-auto">
          {table.columns.map((column) => (
            <Label key={column.id} className="text-xs text-muted-foreground">
              {column.label}
              {column.nullable ? '' : ' *'}
              <Input
                className="mt-1 h-9"
                aria-label={column.label}
                value={values[column.id] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [column.id]: event.target.value,
                  }))
                }
              />
            </Label>
          ))}
        </div>
        {mutation.error instanceof Error ? (
          <p role="alert" className="text-xs text-destructive">
            {mutation.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Create row'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function coerceLoose(logicalType: string, raw: string): unknown {
  if (logicalType === 'integer') return Number.parseInt(raw, 10)
  if (logicalType === 'decimal') return Number(raw)
  if (logicalType === 'boolean') return ['true', '1', 'yes'].includes(raw.toLowerCase())
  return raw
}

export function DatasetProductActions({
  table,
  client,
  rows,
  archived,
  onRefresh,
  onCreate,
  workspaceId,
}: {
  table: CanonicalDatasetWire | null
  client: DataClient
  archived: boolean
  onRefresh: () => void
  onCreate: (datasetId: string) => void
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const lifecycleMutation = useMutation({
    mutationFn: async () => {
      if (!table) throw new Error('No Dataset selected')
      const input = {
        datasetId: table.id,
        expectedRevision: datasetRevision(table),
      }
      return archived
        ? restoreDataset(client, input)
        : archiveDataset(client, input)
    },
    onSuccess: onRefresh,
  })

  const lifecycleError =
    lifecycleMutation.error instanceof DataClientError
      ? lifecycleMutation.error.message
      : lifecycleMutation.error instanceof Error
        ? lifecycleMutation.error.message
        : null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="size-3.5" /> New Dataset
      </Button>
      {table ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={archived}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" /> Add row
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={archived}
            onClick={() => setPasteOpen(true)}
          >
            Paste TSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={archived}
            onClick={() => setSnapshotOpen(true)}
          >
            <Camera className="size-3.5" /> Snapshot
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => lifecycleMutation.mutate()}
            disabled={lifecycleMutation.isPending}
          >
            <Archive className="size-3.5" />
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </>
      ) : null}
      {lifecycleError ? (
        <span role="alert" className="text-xs text-destructive">
          {lifecycleError}
        </span>
      ) : null}
      <DatasetCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        client={client}
        workspaceId={workspaceId}
        onCreated={(id) => {
          void queryClient.invalidateQueries({
            queryKey: ['dataset-explorer-summaries'],
          })
          onCreate(id)
        }}
      />
      {table ? (
        <>
          <DatasetSnapshotDialog
            open={snapshotOpen}
            onOpenChange={setSnapshotOpen}
            client={client}
            table={table}
            onDone={onRefresh}
          />
          <DatasetPasteDialog
            open={pasteOpen}
            onOpenChange={setPasteOpen}
            client={client}
            table={table}
            onDone={onRefresh}
          />
          <DatasetAddRowDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            client={client}
            table={table}
            onDone={onRefresh}
          />
        </>
      ) : null}
    </div>
  )
}
