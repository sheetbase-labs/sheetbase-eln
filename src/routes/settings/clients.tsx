import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { recordOption } from '#/components/v3/record-picker/entity-options'
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, Section } from '#/components/v3/ui/layout'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { formatPortalDay } from '#/lib/client-portal'
import {
  clientSharingKeys,
  createClientOrganisation,
  fetchClientList,
  fetchClientPortalPreview,
  fetchClientShares,
  fetchRecordsByIds,
  fetchShareableRecords,
  shareRecordWithClient,
  unshareRecordWithClient,
  unsharedRecords,
  validClientName,
} from '#/lib/client-sharing'

/**
 * Settings > Clients: create a client organisation, share individual approved
 * records with its portal, and preview what the client will see. Sharing never
 * signs or approves anything; only records that are already approved can be
 * shared, and the client sees them read-only.
 */
export const Route = createFileRoute('/settings/clients')({
  component: ClientsSettings,
})

const dataClient = createDataClient()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The database refused it.'
}

function ClientsSettings() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const role = context.workspace?.role
  const canManage = role === 'owner' || role === 'admin'
  const [picked, setPicked] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const clients = useQuery({
    queryKey: clientSharingKeys.clients(workspaceId),
    queryFn: () => fetchClientList(dataClient, workspaceId),
    enabled: Boolean(workspaceId) && canManage,
  })
  const list = clients.data ?? []
  const selected = list.find((c) => c.id === picked) ?? list.at(0) ?? null

  if (!canManage) {
    return (
      <>
        <SettingsHeader title="Clients" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="Only workspace admins manage clients"
            description={
              <>
                Clients are the organisations whose portal shows approved
                records. Ask a workspace admin to add one or share a record.
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <SettingsHeader
        title="Clients"
        count={clients.isSuccess ? list.length : undefined}
        actions={
          <NewClient
            workspaceId={workspaceId}
            onCreated={(id) => {
              setPicked(id)
              setPreviewing(false)
            }}
          />
        }
      >
        A client sees only approved records you share with it, read-only, in the
        client portal. Invite its people from Members and roles.
      </SettingsHeader>
      <SettingsBody>
        {clients.isError ? (
          <Notice tone="bad">
            Clients could not be loaded: {errorMessage(clients.error)}
          </Notice>
        ) : clients.isLoading ? (
          <Muted>Loading clients…</Muted>
        ) : list.length === 0 ? (
          <EmptyState
            icon="user"
            title="No clients yet"
            description="Add a client organisation, then share approved records with it."
          />
        ) : (
          <>
            <Field label="Client">
              <Select
                value={selected?.id ?? ''}
                onChange={(e) => {
                  setPicked(e.target.value)
                  setPreviewing(false)
                }}
              >
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {selected ? (
              <>
                <ClientShares
                  key={selected.id}
                  workspaceId={workspaceId}
                  clientId={selected.id}
                  clientName={selected.name}
                  previewing={previewing}
                  onTogglePreview={() => setPreviewing((v) => !v)}
                />
                {previewing ? (
                  <ClientPreview
                    clientId={selected.id}
                    clientName={selected.name}
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </SettingsBody>
    </>
  )
}

function NewClient({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const valid = validClientName(name)

  const create = useMutation({
    mutationFn: () =>
      createClientOrganisation(dataClient, { workspaceId, name }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: clientSharingKeys.clients(workspaceId),
      })
      toast('Client added', {
        description: `${created.code} · ${created.name}. Share an approved record to give it something to see.`,
      })
      setOpen(false)
      setName('')
      setTried(false)
      onCreated(created.id)
    },
    onError: (error: unknown) => setServerError(errorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setName('')
          setTried(false)
          setServerError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        New client
      </DialogTrigger>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title="New client"
          description="A client organisation gets its own portal. It sees nothing until you share an approved record with it."
        />
        <DialogBody>
          <Field
            label="Name"
            required
            error={
              tried && !valid ? 'Enter a name of up to 200 characters.' : null
            }
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Biologics"
            />
          </Field>
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (!valid) return
              create.mutate()
            }}
          >
            {create.isPending ? 'Adding…' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClientShares({
  workspaceId,
  clientId,
  clientName,
  previewing,
  onTogglePreview,
}: {
  workspaceId: string
  clientId: string
  clientName: string
  previewing: boolean
  onTogglePreview: () => void
}) {
  const queryClient = useQueryClient()
  const [recordId, setRecordId] = useState('')
  const shares = useQuery({
    queryKey: clientSharingKeys.shares(clientId),
    queryFn: () => fetchClientShares(dataClient, clientId),
  })
  const shareable = useQuery({
    queryKey: clientSharingKeys.shareable(workspaceId),
    queryFn: () => fetchShareableRecords(dataClient, workspaceId),
  })
  const shareList = shares.data ?? []
  const sharedRecords = useQuery({
    queryKey: [
      ...clientSharingKeys.shares(clientId),
      'records',
      shareList.map((s) => s.recordId),
    ],
    queryFn: () =>
      fetchRecordsByIds(
        dataClient,
        shareList.map((s) => s.recordId),
      ),
    enabled: shares.isSuccess && shareList.length > 0,
  })
  const byId = new Map((sharedRecords.data ?? []).map((r) => [r.id, r]))
  const offered = unsharedRecords(shareable.data ?? [], shareList)

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: clientSharingKeys.shares(clientId),
    })
    void queryClient.invalidateQueries({
      queryKey: clientSharingKeys.preview(clientId),
    })
  }
  const share = useMutation({
    mutationFn: () => shareRecordWithClient(dataClient, { clientId, recordId }),
    onSuccess: () => {
      toast('Record shared', {
        description: `${clientName} can now see it in the client portal.`,
      })
      setRecordId('')
      refresh()
    },
    onError: (error: unknown) =>
      toast.error('Could not share the record', {
        description: errorMessage(error),
      }),
  })
  const unshare = useMutation({
    mutationFn: (id: string) =>
      unshareRecordWithClient(dataClient, { clientId, recordId: id }),
    onSuccess: () => {
      toast('Record no longer shared')
      refresh()
    },
    onError: (error: unknown) =>
      toast.error('Could not stop sharing', {
        description: errorMessage(error),
      }),
  })

  return (
    <Section
      title={`Shared with ${clientName}`}
      count={shares.isSuccess ? shareList.length : undefined}
      action={
        <Button size="sm" onClick={onTogglePreview}>
          {previewing ? 'Close preview' : 'Preview as client'}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Share an approved record"
          className="min-w-[260px] flex-1"
        >
          <PickerSelect
            noun="record"
            value={recordId}
            onChange={(id) => setRecordId(id)}
            disabled={shareable.isLoading}
            placeholder={
              offered.length === 0
                ? 'No approved records left to share'
                : 'Choose a record'
            }
            options={offered.map((r) => recordOption(r))}
          />
        </Field>
        <Button
          variant="primary"
          disabled={!recordId || share.isPending}
          onClick={() => share.mutate()}
        >
          {share.isPending ? 'Sharing…' : 'Share'}
        </Button>
      </div>
      {shareable.isError ? (
        <Notice tone="bad">
          Approved records could not be loaded: {errorMessage(shareable.error)}
        </Notice>
      ) : null}
      {shares.isError ? (
        <Notice tone="bad">
          Shares could not be loaded: {errorMessage(shares.error)}
        </Notice>
      ) : shareList.length === 0 && shares.isSuccess ? (
        <Muted>
          Nothing is shared one record at a time. A project that shares
          automatically still shows its approved records to the client.
        </Muted>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-border p-0">
          {shareList.map((s) => {
            const record = byId.get(s.recordId)
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-label"
              >
                <ObjectLink
                  kind="record"
                  id={s.recordId}
                  identifier={record?.identifier ?? null}
                />
                <span className="min-w-0 flex-1 truncate">
                  {record?.title ?? ''}
                </span>
                {record && record.status !== 'approved' ? (
                  <Status tone="warn">Not approved now</Status>
                ) : null}
                <Muted>Shared {formatPortalDay(s.sharedAt)}</Muted>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={unshare.isPending}
                  onClick={() => unshare.mutate(s.recordId)}
                >
                  Stop sharing
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/** What the client's portal lists for them, with the same rules the portal
 * applies. It is a read of the portal's data, not a sign-in as the client. */
function ClientPreview({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const preview = useQuery({
    queryKey: clientSharingKeys.preview(clientId),
    queryFn: () => fetchClientPortalPreview(dataClient, clientId),
  })
  const projects = preview.data?.projects ?? []
  const records = preview.data?.records ?? []

  return (
    <Section title={`Preview: what ${clientName} sees`}>
      <Notice tone="info">
        This is the list {clientName} gets in the client portal: approved
        records you shared, and approved records of projects that share
        automatically. It is read-only for them.
      </Notice>
      {preview.isError ? (
        <Notice tone="bad">
          The preview could not be loaded: {errorMessage(preview.error)}
        </Notice>
      ) : preview.isLoading ? (
        <Muted>Loading the preview…</Muted>
      ) : (
        <div className="flex flex-col gap-4" aria-label="Client portal preview">
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-label font-semibold">Projects</h3>
            {projects.length === 0 ? (
              <Muted>No project shares automatically with this client.</Muted>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-border p-0">
                {projects.map((p) => (
                  <li
                    key={p.projectId}
                    className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-label"
                  >
                    <ObjectLink
                      kind="project"
                      id={p.projectId}
                      identifier={p.displayId}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    <Muted>{p.status}</Muted>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-label font-semibold">Approved records</h3>
            {records.length === 0 ? (
              <Muted>
                The client would see no records. Share an approved record above.
              </Muted>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-border p-0">
                {records.map((r) => (
                  <li
                    key={r.recordId}
                    className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-label"
                  >
                    <ObjectLink
                      kind="record"
                      id={r.recordId}
                      identifier={r.identifier}
                    />
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <Muted>
                      {r.approvedAt
                        ? `Approved ${formatPortalDay(r.approvedAt)}${r.approvedByName ? ` by ${r.approvedByName}` : ''}`
                        : 'Approved'}
                    </Muted>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
