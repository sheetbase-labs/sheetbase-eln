import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { TableBox } from '#/components/ui/table'
import { CheckRow } from '#/components/settings/settings-page'
import { toast } from '#/components/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  deletePublicationTarget,
  fetchOntologySettings,
  fetchPublicationTargets,
  openDataKeys,
  savePublicationTarget,
  setOntologySettings,
  describeOpenDataError,
} from '#/lib/open-data/client'
import type { PublicationTarget, RepositoryKind } from '#/lib/open-data/client'
import {
  PUBLICATION_LICENSES as LICENSES,
  licenseById,
} from '#/lib/publishing/licenses'
import { setPublicationTokenFn } from '#/lib/publishing/targets-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

export function OntologySection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: openDataKeys.ontology(workspaceId),
    queryFn: () => fetchOntologySettings(dataClient, workspaceId),
  })

  const [list, setList] = useState<string | null>(null)
  const current = settings.data?.ontologies.join(', ') ?? ''
  const shown = list ?? current

  const save = useMutation({
    mutationFn: (input: { enabled: boolean; ontologies?: string[] }) =>
      setOntologySettings(dataClient, workspaceId, input),
    onSuccess: async () => {
      setList(null)
      await queryClient.invalidateQueries({
        queryKey: openDataKeys.ontology(workspaceId),
      })
      toast(t('openData.ontology.saved'))
    },
    onError: (e) =>
      toast(`${t('openData.ontology.failed')}: ${describeOpenDataError(e)}`),
  })

  const enabled = settings.data?.enabled === true

  const parsed = shown
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  return (
    <Section title={t('openData.ontology.title')}>
      <Muted>{t('openData.ontology.explain')}</Muted>
      <CheckRow
        title={t('openData.ontology.enable')}
        body={t('openData.ontology.enableHint')}
        checked={enabled}
        disabled={!canManage || settings.isPending || save.isPending}
        onCheckedChange={(v) => save.mutate({ enabled: v })}
      />
      {enabled ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t('openData.ontology.ontologies')}
            hint={t('openData.ontology.ontologiesHint')}
          >
            <Input
              value={shown}
              disabled={!canManage}
              onChange={(e) => setList(e.target.value)}
              className="w-80"
            />
          </Field>
          <Button
            disabled={
              !canManage ||
              list === null ||
              parsed.length === 0 ||
              save.isPending
            }
            onClick={() => save.mutate({ enabled: true, ontologies: parsed })}
          >
            {t('common.actions.save')}
          </Button>
        </div>
      ) : null}
    </Section>
  )
}

interface Draft {
  id: string | null
  kind: RepositoryKind
  name: string
  baseUrl: string
  collection: string
  license: string
  enabled: boolean
  token: string
}

const DEFAULT_URL: Record<RepositoryKind, string> = {
  zenodo: 'https://zenodo.org',
  invenio: 'https://',
  figshare: 'https://api.figshare.com',
  dataverse: 'https://',
}

/** True for the repository kinds this dialog offers. */
function isRepositoryKind(value: string): value is RepositoryKind {
  return Object.hasOwn(DEFAULT_URL, value)
}

const emptyDraft = (): Draft => ({
  id: null,
  kind: 'zenodo',
  name: '',
  baseUrl: DEFAULT_URL.zenodo,
  collection: '',
  license: 'cc-by-4.0',
  enabled: true,
  token: '',
})

/**
 * The publication targets table. Editing and removal are the section's
 * business: this only draws the rows and reports the two actions.
 */
function RepositoriesTable({
  rows,
  canManage,
  isPending,
  onEdit,
  onRemove,
}: {
  rows: PublicationTarget[]
  canManage: boolean
  isPending: boolean
  onEdit: (row: PublicationTarget) => void
  onRemove: (row: PublicationTarget) => void
}) {
  const columns = useMemo<RegistryColumn<PublicationTarget>[]>(
    () => [
      {
        id: 'name',
        header: t('openData.repos.columns.name'),
        accessorFn: (row) => row.name,
        enableHiding: false,
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'kind',
        header: t('openData.repos.columns.kind'),
        accessorFn: (row) => t(`openData.repos.kinds.${row.kind}`),
        cell: ({ row }) => t(`openData.repos.kinds.${row.original.kind}`),
      },
      {
        id: 'address',
        header: t('openData.repos.columns.address'),
        accessorFn: (row) => row.base_url,
        cell: ({ row }) => (
          <span
            className="block max-w-64 truncate"
            title={row.original.base_url}
          >
            {row.original.base_url}
          </span>
        ),
      },
      {
        id: 'licence',
        header: t('openData.repos.columns.licence'),
        accessorFn: (row) => licenseById(row.license).name,
        cell: ({ row }) => licenseById(row.original.license).name,
      },
      {
        id: 'token',
        header: t('openData.repos.columns.token'),
        accessorFn: (row) => (row.token_set ? 1 : 0),
        cell: ({ row }) => (
          <Status tone={row.original.token_set ? 'ok' : 'warn'}>
            {row.original.token_set
              ? t('openData.repos.tokenSet')
              : t('openData.repos.tokenMissing')}
          </Status>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">{t('common.actions.edit')}</span>
        ),
        enableSorting: false,
        enableHiding: false,
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
        cell: ({ row }) =>
          canManage ? (
            <span className="flex justify-end gap-2">
              <Button size="sm" onClick={() => onEdit(row.original)}>
                {t('common.actions.edit')}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => onRemove(row.original)}
              >
                {t('openData.repos.remove')}
              </Button>
            </span>
          ) : null,
      },
    ],
    [canManage, onEdit, onRemove],
  )

  return (
    <TableBox>
      {!isPending && rows.length === 0 ? (
        <p role="status" className="px-3 py-6 text-center text-fg-muted">
          {t('openData.repos.none')}
        </p>
      ) : (
        <RegistryGrid
          label={t('openData.repos.title')}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          selectable={false}
          isLoading={isPending}
        />
      )}
    </TableBox>
  )
}

export function RepositoriesSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const targets = useQuery({
    queryKey: openDataKeys.targets(workspaceId),
    queryFn: () => fetchPublicationTargets(dataClient),
  })

  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<PublicationTarget | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: openDataKeys.targets(workspaceId),
    })

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const saved = await savePublicationTarget(dataClient, {
        workspaceId,
        id: d.id,
        kind: d.kind,
        name: d.name.trim(),
        baseUrl: d.baseUrl.trim().replace(/\/$/, ''),
        collection: d.collection.trim() || null,
        license: d.license,
        enabled: d.enabled,
      })

      if (d.token.trim()) {
        await setPublicationTokenFn({
          data: { targetId: saved.id, token: d.token },
        })
      }

      return saved
    },
    onSuccess: async () => {
      setDraft(null)
      await invalidate()
      toast(t('openData.repos.saved'))
    },
  })

  const remove = useMutation({
    mutationFn: (target: PublicationTarget) =>
      deletePublicationTarget(dataClient, target.id),
    onSuccess: async () => {
      await invalidate()
      toast(t('openData.repos.removed'))
    },
    onError: (e) => toast(describeOpenDataError(e)),
  })

  const rows = targets.data ?? []

  return (
    <Section
      title={t('openData.repos.title')}
      count={rows.length}
      action={
        canManage ? (
          <Button
            size="sm"
            variant="primary"
            icon="plus"
            onClick={() => {
              save.reset()
              setDraft(emptyDraft())
            }}
          >
            {t('openData.repos.add')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('openData.repos.explain')}</Muted>
      <RepositoriesTable
        rows={rows}
        canManage={canManage}
        isPending={targets.isPending}
        onEdit={(row) => {
          save.reset()
          setDraft({
            id: row.id,
            kind: row.kind,
            name: row.name,
            baseUrl: row.base_url,
            collection: row.collection ?? '',
            license: row.license,
            enabled: row.enabled,
            token: '',
          })
        }}
        onRemove={setRemoving}
      />

      <Dialog
        open={draft !== null}
        onOpenChange={(o) => (o ? null : setDraft(null))}
      >
        <DialogContent>
          {draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                save.mutate(draft)
              }}
            >
              <DialogHeader
                title={draft.id ? draft.name : t('openData.repos.add')}
              />
              <DialogBody>
                <Field label={t('openData.repos.name')} required>
                  <Input
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    required
                    autoFocus
                  />
                </Field>
                <Field label={t('openData.repos.type')}>
                  <Select
                    aria-label={t('openData.repos.type')}
                    value={draft.kind}
                    disabled={draft.id !== null}
                    onChange={(e) => {
                      if (!isRepositoryKind(e.target.value)) return
                      const kind = e.target.value

                      setDraft({
                        ...draft,
                        kind,
                        baseUrl: draft.id ? draft.baseUrl : DEFAULT_URL[kind],
                      })
                    }}
                  >
                    {(
                      ['zenodo', 'invenio', 'figshare', 'dataverse'] as const
                    ).map((k) => (
                      <option key={k} value={k}>
                        {t(`openData.repos.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('openData.repos.address')}
                  hint={t('openData.repos.addressHint')}
                  required
                >
                  <Input
                    type="url"
                    value={draft.baseUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, baseUrl: e.target.value })
                    }
                    required
                  />
                </Field>
                {draft.kind === 'dataverse' || draft.kind === 'invenio' ? (
                  <Field
                    label={t('openData.repos.collection')}
                    hint={t('openData.repos.collectionHint')}
                  >
                    <Input
                      value={draft.collection}
                      onChange={(e) =>
                        setDraft({ ...draft, collection: e.target.value })
                      }
                    />
                  </Field>
                ) : null}
                <Field label={t('openData.repos.licence')}>
                  <Select
                    aria-label={t('openData.repos.licence')}
                    value={draft.license}
                    onChange={(e) =>
                      setDraft({ ...draft, license: e.target.value })
                    }
                  >
                    {LICENSES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('openData.repos.token')}
                  hint={t('openData.repos.tokenHint')}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={draft.token}
                    onChange={(e) =>
                      setDraft({ ...draft, token: e.target.value })
                    }
                    placeholder={draft.id ? '••••••••' : ''}
                  />
                </Field>
                <CheckRow
                  title={t('openData.repos.enabled')}
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
                {save.error ? (
                  <p role="alert" className="text-label text-danger">
                    {t('openData.repos.failed')}:{' '}
                    {describeOpenDataError(save.error)}
                  </p>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button type="button" />}>
                  {t('common.actions.cancel')}
                </DialogClose>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    !draft.name.trim() ||
                    !draft.baseUrl.trim() ||
                    save.isPending
                  }
                >
                  {t('openData.repos.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* react-doctor-disable-next-line react-doctor/duplicate-jsx-subtree -- A removal confirmation is the shared dialog primitives in their standard order; the copy, the mutation and the cache ownership are this section's. */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => (o ? null : setRemoving(null))}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('openData.repos.removeTitle')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('openData.repos.removeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => {
                if (removing) remove.mutate(removing)
                setRemoving(null)
              }}
            >
              {t('openData.repos.remove')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}
