import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { PrintLabelsDialog } from '#/components/samples/sample-label-sheet'
import { useStorageLocations } from '#/components/samples/samples-data'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { undoToast } from '#/lib/undo-toast'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import {
  fetchProjectSummaries,
  fetchWorkspaceMemberIdentities,
} from '#/components/projects/project-data'
import { t } from '#/copy'
import {
  bulkArchive,
  bulkAssign,
  bulkRestore,
  bulkMoveToLocation,
  bulkMoveToProject,
  bulkSetField,
  fetchBulkLabelRecords,
  fetchBulkTargets,
} from '#/lib/bulk-records'
import type { BulkOutcome } from '#/lib/bulk-records'
import type { DataClient } from '#/lib/data-client'
import {
  fetchModelFields,
  parseModelFieldInput,
  validateModelFieldValue,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { notebookDataClient } from '#/lib/notebook-data'

import type { BulkSelection } from './bulk-selection'

type DialogName = 'archive' | 'move' | 'assign' | 'field' | 'labels'

type ActionName = 'archive' | 'restore' | 'move' | 'assign' | 'field'

/**
 * The strip above a list that acts on the rows ticked in it: print labels,
 * assign, set a field, move, archive. It appears when something is ticked and
 * goes when nothing is. Every action runs record by record through the same
 * function the record's own page uses, so a record that cannot take it (locked,
 * archived, not yours) is named with the reason and the rest still go through.
 */
export function RecordBulkBar({
  selection,
  kind,
  move,
  archive = true,
  restore = false,
  canWrite,
  onChanged,
  client = notebookDataClient,
}: {
  selection: BulkSelection
  /**
   * The model the ticked records share, when they share one. Setting a field
   * needs it, because the fields are the model's.
   */
  kind?: string
  /** How this list moves a record: to another project, or to a storage place. */
  move?: 'project' | 'location'
  /**
   * Whether the list offers Archive. A kind that is retired through its own
   * governed lifecycle (a controlled protocol) leaves it out.
   */
  archive?: boolean
  /**
   * The list is showing archived records: the bar offers Restore, the one
   * thing that makes sense for them, in place of the other actions.
   */
  restore?: boolean
  canWrite: boolean
  /** The list reloads after an action. */
  onChanged: () => void
  client?: DataClient
}) {
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [restoring, setRestoring] = useState(false)

  if (selection.count === 0) return null

  const report = (action: ActionName, outcome: BulkOutcome) => {
    if (outcome.failed.length === 0) {
      const message = t(`library.bulk.done.${action}`, {
        count: outcome.done.length,
      })

      // Archiving and restoring are each other's undo.
      if (action === 'archive' || action === 'restore') {
        undoToast(
          message,
          async () => {
            const targets = await fetchBulkTargets(client, outcome.doneIds)

            const undone = await (action === 'archive'
              ? bulkRestore(client, targets)
              : bulkArchive(client, targets))

            if (undone.failed.length > 0) {
              throw new Error(undone.failed[0].message)
            }
          },
          onChanged,
        )
      } else {
        toast(message)
      }
    } else {
      const first = outcome.failed[0]
      toast.error(
        t('library.bulk.partial', {
          done: outcome.done.length,
          total: outcome.done.length + outcome.failed.length,
        }),
        {
          description: `${outcome.failed
            .slice(0, 3)
            .map((failure) => failure.identifier)
            .join(
              ', ',
            )}${outcome.failed.length > 3 ? '…' : ''}: ${first.message}`,
        },
      )
    }

    // What was refused stays ticked, so it can be put right and tried again.
    selection.replace(outcome.failed.map((failure) => failure.id))
    setDialog(null)
    onChanged()
  }

  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }

  return (
    <div
      role="region"
      aria-label={t('library.bulk.bar')}
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-selection px-4 py-1.5 md:px-6"
    >
      <span className="num mr-1 text-label font-medium">
        {t('library.bulk.selected', { count: selection.count })}
      </span>
      {restore ? null : (
        <Button size="sm" icon="tag" onClick={() => setDialog('labels')}>
          {t('library.bulk.printLabels')}
        </Button>
      )}
      {canWrite && restore ? (
        <Button
          size="sm"
          icon="undo"
          disabled={restoring}
          onClick={() => {
            setRestoring(true)
            void (async () => {
              try {
                report(
                  'restore',
                  await bulkRestore(
                    client,
                    await fetchBulkTargets(client, selection.ids),
                  ),
                )
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : t('library.bulk.errors.generic'),
                )
              } finally {
                setRestoring(false)
              }
            })()
          }}
        >
          {t('library.bulk.restore')}
        </Button>
      ) : null}
      {canWrite && !restore ? (
        <>
          <Button size="sm" icon="user" onClick={() => setDialog('assign')}>
            {t('library.bulk.assign')}
          </Button>
          <Button
            size="sm"
            icon="edit"
            disabled={!kind}
            title={kind ? undefined : t('library.bulk.setFieldMixed')}
            onClick={() => setDialog('field')}
          >
            {t('library.bulk.setField')}
          </Button>
          {move ? (
            <Button size="sm" icon="move" onClick={() => setDialog('move')}>
              {t('library.bulk.move')}
            </Button>
          ) : null}
          {archive ? (
            <Button
              size="sm"
              variant="danger"
              icon="archive"
              onClick={() => setDialog('archive')}
            >
              {t('library.bulk.archive')}
            </Button>
          ) : null}
        </>
      ) : null}
      <span className="flex-1" />
      <Button size="sm" variant="quiet" onClick={selection.clear}>
        {t('library.bulk.clear')}
      </Button>

      <ArchiveDialog
        open={dialog === 'archive'}
        onOpenChange={close}
        count={selection.count}
        run={async () =>
          bulkArchive(client, await fetchBulkTargets(client, selection.ids))
        }
        onDone={(outcome) => report('archive', outcome)}
      />
      <MoveDialog
        open={dialog === 'move'}
        onOpenChange={close}
        how={move ?? 'project'}
        count={selection.count}
        client={client}
        run={async (destination) => {
          const targets = await fetchBulkTargets(client, selection.ids)

          return move === 'location'
            ? bulkMoveToLocation(client, targets, destination)
            : bulkMoveToProject(client, targets, destination)
        }}
        onDone={(outcome) => report('move', outcome)}
      />
      <AssignDialog
        open={dialog === 'assign'}
        onOpenChange={close}
        count={selection.count}
        run={async (userId) =>
          bulkAssign(
            client,
            await fetchBulkTargets(client, selection.ids),
            userId,
          )
        }
        onDone={(outcome) => report('assign', outcome)}
      />
      {kind ? (
        <SetFieldDialog
          open={dialog === 'field'}
          onOpenChange={close}
          kind={kind}
          count={selection.count}
          client={client}
          run={async (fieldName, value) =>
            bulkSetField(
              client,
              await fetchBulkTargets(client, selection.ids),
              fieldName,
              value,
            )
          }
          onDone={(outcome) => report('field', outcome)}
        />
      ) : null}
      <BulkLabels
        open={dialog === 'labels'}
        onOpenChange={close}
        ids={selection.ids}
        client={client}
        onPrinted={onChanged}
      />
    </div>
  )
}

/** The dialog every action shares: a title, the controls, Cancel and the action. */
function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  busyLabel,
  busy,
  disabled,
  danger,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirm: string
  busyLabel: string
  busy: boolean
  disabled?: boolean
  danger?: boolean
  onConfirm: () => void
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={title} description={description} />
        {children ? <DialogBody>{children}</DialogBody> : null}
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant={danger ? 'danger-fill' : 'primary'}
            disabled={busy || disabled}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useBulkRun<TArgs extends unknown[]>(
  run: (...args: TArgs) => Promise<BulkOutcome>,
  onDone: (outcome: BulkOutcome) => void,
) {
  return useMutation({
    mutationFn: (args: TArgs) => run(...args),
    onSuccess: onDone,
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('library.bulk.errors.generic'),
      ),
  })
}

function ArchiveDialog({
  open,
  onOpenChange,
  count,
  run,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  run: () => Promise<BulkOutcome>
  onDone: (outcome: BulkOutcome) => void
}) {
  const archive = useBulkRun(run, onDone)

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.bulk.archiveDialog.title', { count })}
      description={t('library.bulk.archiveDialog.body')}
      confirm={t('library.bulk.archiveDialog.confirm', { count })}
      busyLabel={t('library.bulk.archiveDialog.busy')}
      busy={archive.isPending}
      danger
      onConfirm={() => archive.mutate([])}
    />
  )
}

function MoveDialog({
  open,
  onOpenChange,
  how,
  count,
  client,
  run,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  how: 'project' | 'location'
  count: number
  client: DataClient
  run: (destination: string) => Promise<BulkOutcome>
  onDone: (outcome: BulkOutcome) => void
}) {
  const [destination, setDestination] = useState('')

  const projects = useQuery({
    queryKey: ['bulk', 'projects'],
    queryFn: () => fetchProjectSummaries(undefined),
    enabled: open && how === 'project',
    staleTime: 30_000,
  })

  const locations = useStorageLocations(client, open && how === 'location')
  const move = useBulkRun(run, onDone)
  const trimmed = destination.trim()

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`library.bulk.moveDialog.${how}.title`, { count })}
      description={t(`library.bulk.moveDialog.${how}.hint`)}
      confirm={t('library.bulk.moveDialog.confirm', { count })}
      busyLabel={t('library.bulk.moveDialog.busy')}
      busy={move.isPending}
      disabled={!trimmed}
      onConfirm={() => move.mutate([trimmed])}
    >
      {how === 'project' ? (
        <Field label={t('library.bulk.moveDialog.project.label')}>
          <Select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="" disabled>
              {t('library.bulk.moveDialog.project.choose')}
            </option>
            {(projects.data ?? [])
              .filter((project) => !project.archivedAt)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayId
                    ? `${project.displayId} · ${project.title}`
                    : project.title}
                </option>
              ))}
          </Select>
        </Field>
      ) : (
        <Field label={t('library.bulk.moveDialog.location.label')}>
          <Input
            value={destination}
            list="bulk-locations"
            onChange={(event) => setDestination(event.target.value)}
          />
          <datalist id="bulk-locations">
            {(locations.data ?? []).map((location) => (
              <option key={location} value={location} />
            ))}
          </datalist>
        </Field>
      )}
    </ActionDialog>
  )
}

const NOBODY = '__nobody'

function AssignDialog({
  open,
  onOpenChange,
  count,
  run,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  run: (userId: string | null) => Promise<BulkOutcome>
  onDone: (outcome: BulkOutcome) => void
}) {
  const [person, setPerson] = useState('')

  // Its own key: the shared member-name key holds a map in some screens and a
  // list in others.
  const members = useQuery({
    queryKey: ['bulk', 'members'],
    queryFn: fetchWorkspaceMemberIdentities,
    enabled: open,
    staleTime: 60_000,
  })

  const assign = useBulkRun(run, onDone)

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.bulk.assignDialog.title', { count })}
      description={t('library.bulk.assignDialog.hint')}
      confirm={t('library.bulk.assignDialog.confirm', { count })}
      busyLabel={t('library.bulk.assignDialog.busy')}
      busy={assign.isPending}
      disabled={!person}
      onConfirm={() => assign.mutate([person === NOBODY ? null : person])}
    >
      <Field label={t('library.bulk.assignDialog.person')}>
        <Select
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="" disabled>
            {t('library.bulk.assignDialog.choose')}
          </option>
          <option value={NOBODY}>
            {t('library.bulk.assignDialog.nobody')}
          </option>
          {(members.data ?? [])
            .map((member) => ({
              userId: member.user_id,
              name: member.name || member.user_id,
            }))
            .sort((x, y) => x.name.localeCompare(y.name, 'en-GB'))
            .map(({ userId, name }) => (
              <option key={userId} value={userId}>
                {name}
              </option>
            ))}
        </Select>
      </Field>
    </ActionDialog>
  )
}

function SetFieldDialog({
  open,
  onOpenChange,
  kind,
  count,
  client,
  run,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: string
  count: number
  client: DataClient
  run: (
    fieldName: string,
    value: ReturnType<typeof parseModelFieldInput>,
  ) => Promise<BulkOutcome>
  onDone: (outcome: BulkOutcome) => void
}) {
  const [fieldName, setFieldName] = useState('')
  const [value, setValue] = useState<string | boolean>('')

  const fields = useQuery({
    queryKey: ['bulk', 'fields', kind],
    queryFn: () => fetchModelFields(client, kind),
    enabled: open,
    staleTime: 30_000,
  })

  const choices = (fields.data ?? []).filter(
    (field) => field.lifecycle === 'active',
  )

  const field: ModelFieldDefinition | undefined = choices.find(
    (candidate) => candidate.fieldName === fieldName,
  )

  const parsed = field ? parseModelFieldInput(field, value) : undefined
  const problem = field ? validateModelFieldValue(field, parsed) : null
  const set = useBulkRun(run, onDone)

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.bulk.fieldDialog.title', { count })}
      description={t('library.bulk.fieldDialog.hint')}
      confirm={t('library.bulk.fieldDialog.confirm', { count })}
      busyLabel={t('library.bulk.fieldDialog.busy')}
      busy={set.isPending}
      disabled={!field || Boolean(problem)}
      onConfirm={() =>
        field && parsed !== undefined && set.mutate([field.fieldName, parsed])
      }
    >
      {fields.isPending ? null : choices.length === 0 ? (
        <p className="m-0 text-body text-fg-muted">
          {t('library.bulk.fieldDialog.none')}
        </p>
      ) : (
        <>
          <Field label={t('library.bulk.fieldDialog.field')}>
            <Select
              value={fieldName}
              onChange={(event) => {
                setFieldName(event.target.value)

                const next = choices.find(
                  (candidate) => candidate.fieldName === event.target.value,
                )

                setValue(next?.logicalType === 'boolean' ? false : '')
              }}
            >
              <option value="" disabled>
                {t('library.bulk.fieldDialog.choose')}
              </option>
              {choices.map((candidate) => (
                <option key={candidate.id} value={candidate.fieldName}>
                  {candidate.label}
                </option>
              ))}
            </Select>
          </Field>
          {field ? (
            <div key={field.fieldName}>
              <ModelFieldInput
                definition={field}
                value={value}
                onChange={setValue}
              />
              {problem && value !== '' ? (
                <p
                  role="alert"
                  className="m-0 mt-1 text-label text-danger-text"
                >
                  {problem}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </ActionDialog>
  )
}

/** Fetches the ticked records fresh and hands them to the label dialog. */
function BulkLabels({
  open,
  onOpenChange,
  ids,
  client,
  onPrinted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: readonly string[]
  client: DataClient
  onPrinted: () => void
}) {
  const records = useQuery({
    queryKey: ['bulk', 'label-records', ids],
    queryFn: () => fetchBulkLabelRecords(client, ids),
    enabled: open,
    staleTime: 0,
  })

  if (!open) return null

  return (
    <PrintLabelsDialog
      open
      onOpenChange={onOpenChange}
      records={records.data ?? []}
      scope={t('library.bulk.labels.scope', { count: ids.length })}
      client={client}
      onPrinted={onPrinted}
    />
  )
}
