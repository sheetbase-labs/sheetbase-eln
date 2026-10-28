import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { SettingsBody } from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { cn } from '#/lib/utils'
import {
  EMPTY_NODE_INPUT,
  LEVEL_META,
  UNIT_TYPES,
  UNIT_TYPE_LABELS,
  childLevel,
  createStorageNode,
  describeBoxGrid,
  describeTemperature,
  fetchStorageTree,
  formatNodePath,
  inputFromNode,
  isArchived,
  setStorageNodeArchived,
  storageKeys,
  suggestCode,
  updateStorageNode,
  validateNodeInput,
} from '#/lib/storage-locations'
import type {
  NodeInput,
  StorageLevel,
  StorageNode,
  StorageTree,
  UnitType,
} from '#/lib/storage-locations'

const defaultClient = createDataClient()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The database refused it.'
}

function plural(count: number, level: StorageLevel): string {
  return `${count} ${count === 1 ? LEVEL_META[level].label.toLowerCase() : LEVEL_META[level].plural}`
}

/**
 * Storage locations as a tree: sites down to boxes. Pick a location to rename
 * it, set its type and temperature, add what goes inside it, or archive it.
 * Everything is read-only when the person can view but not manage.
 */
export function StorageLocationsPanel({
  workspaceId,
  canManage,
  client = defaultClient,
}: {
  workspaceId: string
  canManage: boolean
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const tree = useQuery({
    queryKey: storageKeys.all(workspaceId),
    queryFn: () => fetchStorageTree(client),
    enabled: Boolean(workspaceId),
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState<{
    level: StorageLevel
    parent: StorageNode | null
  } | null>(null)

  const data = tree.data
  // Sites and rooms start open so the freezers are in view; the rest on demand.
  const open = useMemo(() => {
    if (expanded) return expanded
    return new Set(
      (data?.nodes ?? [])
        .filter((n) => n.level === 'site' || n.level === 'room')
        .map((n) => n.id),
    )
  }, [expanded, data])
  const selected = (selectedId && data?.byId.get(selectedId)) || null

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: storageKeys.all(workspaceId) })

  if (tree.isError) {
    return (
      <SettingsBody>
        <Notice tone="bad">
          Storage locations could not be loaded: {errorMessage(tree.error)}
        </Notice>
      </SettingsBody>
    )
  }
  if (!data) {
    return (
      <SettingsBody>
        <Muted>Loading storage locations…</Muted>
      </SettingsBody>
    )
  }

  const archivedCount = data.nodes.filter((n) => n.archivedAt).length
  const sites = data
    .childrenOf(null)
    .filter((n) => showArchived || !n.archivedAt)

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <SettingsBody className="min-w-0 flex-1">
        {!canManage ? (
          <Notice icon="lock">
            You can see where things are stored. Changing locations needs the
            Storage and labels permission.
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {canManage ? (
            <Button
              icon="plus"
              onClick={() => setAdding({ level: 'site', parent: null })}
            >
              New site
            </Button>
          ) : null}
          <span className="flex-1" />
          {archivedCount > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-label text-fg-muted">
              <Checkbox
                checked={showArchived}
                onCheckedChange={(v) => setShowArchived(v)}
              />
              Show {archivedCount} archived
            </label>
          ) : null}
        </div>
        {sites.length === 0 ? (
          <EmptyState
            icon="box"
            title="No storage locations yet"
            description="Add a site, then the rooms, freezers, racks and boxes where samples are kept. Samples can then be placed in them."
            action={
              canManage ? (
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setAdding({ level: 'site', parent: null })}
                >
                  New site
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div
            role="tree"
            aria-label="Storage locations"
            className="flex flex-col rounded-md border border-border"
          >
            {sites.map((site) => (
              <TreeBranch
                key={site.id}
                node={site}
                tree={data}
                depth={0}
                open={open}
                showArchived={showArchived}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={(id) => {
                  const next = new Set(open)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  setExpanded(next)
                }}
              />
            ))}
          </div>
        )}
      </SettingsBody>
      <aside
        aria-label="Location details"
        className="shrink-0 border-t border-border bg-surface p-4 lg:w-[340px] lg:border-l lg:border-t-0"
      >
        {selected ? (
          <LocationDetails
            key={selected.id}
            node={selected}
            tree={data}
            canManage={canManage}
            client={client}
            onAdd={(level) => setAdding({ level, parent: selected })}
            onChanged={refresh}
          />
        ) : (
          <Muted>
            Pick a site, room, freezer, shelf, rack or box to see what is in it.
          </Muted>
        )}
      </aside>
      {adding ? (
        <AddLocationDialog
          level={adding.level}
          parent={adding.parent}
          tree={data}
          workspaceId={workspaceId}
          client={client}
          onClose={() => setAdding(null)}
          onCreated={() => {
            if (adding.parent) {
              setExpanded(new Set([...open, adding.parent.id]))
            }
            void refresh()
            setAdding(null)
          }}
        />
      ) : null}
    </div>
  )
}

const LEVEL_ICON = {
  site: 'home',
  room: 'folder',
  unit: 'database',
  shelf: 'table',
  rack: 'template',
  box: 'box',
} as const

function TreeBranch({
  node,
  tree,
  depth,
  open,
  showArchived,
  selectedId,
  onSelect,
  onToggle,
}: {
  node: StorageNode
  tree: StorageTree
  depth: number
  open: ReadonlySet<string>
  showArchived: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const children = tree
    .childrenOf(node)
    .filter((c) => showArchived || !c.archivedAt)
  const isOpen = open.has(node.id)
  const selected = selectedId === node.id
  return (
    <div role="none">
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-expanded={children.length ? isOpen : undefined}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1.5 border-b border-border-subtle pr-3 text-body hover:bg-surface-hover',
          selected && 'bg-selection hover:bg-selection',
          node.archivedAt && 'text-fg-muted',
        )}
        style={{ paddingLeft: 8 + depth * 18 }}
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(node.id)
          } else if (event.key === 'ArrowRight' && children.length && !isOpen) {
            onToggle(node.id)
          } else if (event.key === 'ArrowLeft' && isOpen) {
            onToggle(node.id)
          }
        }}
      >
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          tabIndex={-1}
          className={cn(
            'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-fg-muted hover:bg-surface-hover',
            children.length === 0 && 'invisible',
          )}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(node.id)
          }}
        >
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>
        <Icon
          name={LEVEL_ICON[node.level]}
          size={14}
          className="shrink-0 text-fg-muted"
        />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.archivedAt ? (
          <span className="text-label text-fg-muted">Archived</span>
        ) : node.unitType ? (
          <span className="text-label text-fg-muted">
            {UNIT_TYPE_LABELS[node.unitType]}
          </span>
        ) : null}
        {node.held > 0 ? (
          <span className="num text-label text-fg-muted">
            {node.held} {node.held === 1 ? 'sample' : 'samples'}
          </span>
        ) : null}
      </div>
      {isOpen
        ? children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              tree={tree}
              depth={depth + 1}
              open={open}
              showArchived={showArchived}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  )
}

function LocationDetails({
  node,
  tree,
  canManage,
  client,
  onAdd,
  onChanged,
}: {
  node: StorageNode
  tree: StorageTree
  canManage: boolean
  client: DataClient
  onAdd: (level: StorageLevel) => void
  onChanged: () => void
}) {
  const meta = LEVEL_META[node.level]
  const [input, setInput] = useState<NodeInput>(() => inputFromNode(node))
  const dirty = JSON.stringify(input) !== JSON.stringify(inputFromNode(node))
  const problem = validateNodeInput(node.level, input, true)
  const inherited = !node.archivedAt && isArchived(tree, node)
  const child = childLevel(node.level)
  const hasTemperature =
    node.level === 'site' || node.level === 'room' || node.level === 'unit'

  const save = useMutation({
    mutationFn: () => updateStorageNode(client, node, input),
    onSuccess: () => {
      toast(`${meta.label} saved`)
      onChanged()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      setStorageNodeArchived(client, node, archived),
    onSuccess: (_, archived) => {
      toast(archived ? `${node.name} archived` : `${node.name} restored`)
      onChanged()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const contents = tree.childrenOf(node).filter((c) => !c.archivedAt)
  const set = (patch: Partial<NodeInput>) => setInput({ ...input, ...patch })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-section">{node.name}</h2>
        <p className="m-0 mt-0.5 text-label text-fg-muted">
          {meta.label}
          {node.level === 'box' && describeBoxGrid(node)
            ? ` · ${describeBoxGrid(node)} grid`
            : ''}
          {describeTemperature(node) ? ` · ${describeTemperature(node)}` : ''}
        </p>
        <p className="m-0 mt-1 text-label text-fg-muted">
          {formatNodePath(tree, node)}
        </p>
      </div>
      <div className="flex flex-col gap-1 text-body">
        <Status tone={node.archivedAt ? 'draft' : 'ok'}>
          {node.archivedAt
            ? 'Archived'
            : inherited
              ? 'In an archived location'
              : 'In use'}
        </Status>
        <span className="text-label text-fg-muted">
          {node.held > 0
            ? `${node.held} ${node.held === 1 ? 'sample' : 'samples'} stored here`
            : 'No samples stored here'}
          {child && contents.length
            ? ` · ${plural(contents.length, child)}`
            : ''}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input
            value={input.name}
            disabled={!canManage}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        {meta.hasCode ? (
          <Field label="Code">
            <Input
              value={input.code}
              disabled={!canManage}
              onChange={(e) => set({ code: e.target.value })}
            />
          </Field>
        ) : null}
        {node.level === 'unit' ? (
          <Field label="Type">
            <Select
              value={input.unitType}
              disabled={!canManage}
              onChange={(e) => set({ unitType: e.target.value as UnitType })}
            >
              {UNIT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {UNIT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {hasTemperature ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Lowest °C">
              <Input
                inputMode="decimal"
                value={input.temperatureMinC}
                disabled={!canManage}
                onChange={(e) => set({ temperatureMinC: e.target.value })}
              />
            </Field>
            <Field label="Highest °C">
              <Input
                inputMode="decimal"
                value={input.temperatureMaxC}
                disabled={!canManage}
                onChange={(e) => set({ temperatureMaxC: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
        {canManage && dirty && problem ? (
          <span className="text-label text-danger-text">{problem}</span>
        ) : null}
      </div>

      {canManage ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!dirty || Boolean(problem) || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {child && !node.archivedAt ? (
              <Button icon="plus" onClick={() => onAdd(child)}>
                Add {LEVEL_META[child].label.toLowerCase()}
              </Button>
            ) : null}
          </div>
          {node.archivedAt ? (
            <Button
              disabled={archive.isPending}
              onClick={() => archive.mutate(false)}
            >
              Restore
            </Button>
          ) : (
            <>
              <Button
                variant="danger"
                icon="archive"
                disabled={node.held > 0 || archive.isPending}
                onClick={() => archive.mutate(true)}
              >
                Archive {meta.label.toLowerCase()}
              </Button>
              <span className="text-label text-fg-muted">
                {node.held > 0
                  ? 'Move the samples somewhere else first. A location that holds samples cannot be archived.'
                  : 'Archived locations stay on past records but cannot be chosen for new samples.'}
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function AddLocationDialog({
  level,
  parent,
  tree,
  workspaceId,
  client,
  onClose,
  onCreated,
}: {
  level: StorageLevel
  parent: StorageNode | null
  tree: StorageTree
  workspaceId: string
  client: DataClient
  onClose: () => void
  onCreated: () => void
}) {
  const meta = LEVEL_META[level]
  const [input, setInput] = useState<NodeInput>(EMPTY_NODE_INPUT)
  const [codeEdited, setCodeEdited] = useState(false)
  const problem = validateNodeInput(level, input, false)
  const siblings = tree.childrenOf(parent)
  const nextPosition =
    siblings.reduce((max, s) => Math.max(max, s.position ?? 0), 0) + 1
  const create = useMutation({
    mutationFn: () =>
      createStorageNode(
        client,
        workspaceId,
        level,
        parent,
        input,
        nextPosition,
      ),
    onSuccess: () => {
      toast(`${meta.label} added`)
      onCreated()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const set = (patch: Partial<NodeInput>) => setInput({ ...input, ...patch })
  const hasTemperature =
    level === 'site' || level === 'room' || level === 'unit'
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={`New ${meta.label.toLowerCase()}`}
          description={
            parent ? `In ${formatNodePath(tree, parent)}` : undefined
          }
        />
        <DialogBody>
          <Field label="Name" required>
            <Input
              autoFocus
              value={input.name}
              onChange={(e) =>
                set({
                  name: e.target.value,
                  ...(codeEdited ? {} : { code: suggestCode(e.target.value) }),
                })
              }
            />
          </Field>
          {meta.hasCode ? (
            <Field
              label="Code"
              required
              hint="A short label for lists and labels."
            >
              <Input
                value={input.code}
                onChange={(e) => {
                  setCodeEdited(true)
                  set({ code: e.target.value })
                }}
              />
            </Field>
          ) : null}
          {level === 'unit' ? (
            <Field label="Type">
              <Select
                value={input.unitType}
                onChange={(e) => set({ unitType: e.target.value as UnitType })}
              >
                {UNIT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {UNIT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {hasTemperature ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lowest °C">
                <Input
                  inputMode="decimal"
                  value={input.temperatureMinC}
                  onChange={(e) => set({ temperatureMinC: e.target.value })}
                />
              </Field>
              <Field label="Highest °C">
                <Input
                  inputMode="decimal"
                  value={input.temperatureMaxC}
                  onChange={(e) => set({ temperatureMaxC: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
          {level === 'box' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Rows" hint="Letters A to Z, top to bottom.">
                <Input
                  inputMode="numeric"
                  value={input.rows}
                  onChange={(e) => set({ rows: e.target.value })}
                />
              </Field>
              <Field label="Columns" hint="Numbers from 1, left to right.">
                <Input
                  inputMode="numeric"
                  value={input.cols}
                  onChange={(e) => set({ cols: e.target.value })}
                />
              </Field>
              <span className="col-span-2 text-label text-fg-muted">
                A box cannot change size later, so make a new one if the grid is
                wrong.
              </span>
            </div>
          ) : null}
          {input.name.trim() && problem ? (
            <span className="text-label text-danger-text">{problem}</span>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={Boolean(problem) || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Adding…' : `Add ${meta.label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
