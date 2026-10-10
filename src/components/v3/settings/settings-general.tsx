import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { CheckRow } from './settings-page'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  fetchWorkspaceGeneral,
  updateWorkspaceGeneral,
  updateWorkspaceIdPrefixes,
  updateWorkspaceName,
  updateWorkspacePublicationPolicy,
  updateWorkspaceOfflineEditing,
  workspaceGeneralQueryKey,
  ID_PREFIX_KINDS,
} from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'

const DEFAULTS: WorkspaceGeneral = {
  name: null,
  site: null,
  timezone: 'Europe/London',
  dateFormat: 'd MMM yyyy',
  numberFormat: 'decimal',
  publicationApprovalRequired: false,
  offlineEditingAllowed: true,
  idPrefixes: {},
}

/**
 * SET-01.1 — workspace general settings (site, time zone, date and number
 * format). The RPC refuses a non-admin. UI port: app-3's v3 kit.
 */
export function SettingsGeneral({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })
  const [form, setForm] = useState<WorkspaceGeneral>(DEFAULTS)

  useEffect(() => {
    if (query.data) setForm(query.data)
  }, [query.data])

  const save = useMutation({
    mutationFn: async () => {
      if (form.name) await updateWorkspaceName(workspaceId, form.name)
      await updateWorkspaceGeneral(workspaceId, form)
      await updateWorkspaceIdPrefixes(workspaceId, form.idPrefixes)
      await updateWorkspacePublicationPolicy(
        workspaceId,
        form.publicationApprovalRequired,
      )
      await updateWorkspaceOfflineEditing(
        workspaceId,
        form.offlineEditingAllowed,
      )
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceGeneralQueryKey }),
  })

  return (
    <Section
      title="Workspace"
      action={
        <Button
          variant="primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || query.isLoading || query.isError}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      }
    >
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        Name, site, time zone and the formats records display in.
      </p>

      {save.isError ? (
        <Notice tone="bad">
          {save.error instanceof Error
            ? save.error.message
            : 'Could not save the settings.'}
        </Notice>
      ) : null}

      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            aria-label="Workspace name"
            value={form.name ?? ''}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                name: event.target.value || null,
              }))
            }
          />
        </Field>
        <Field label="Site">
          <Input
            aria-label="Site"
            value={form.site ?? ''}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                site: event.target.value || null,
              }))
            }
          />
        </Field>
        <Field label="Time zone">
          <Input
            aria-label="Time zone"
            value={form.timezone}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Date format">
          <NativeSelect
            aria-label="Date format"
            value={form.dateFormat}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                dateFormat: event.target.value,
              }))
            }
          >
            {DATE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Number format">
          <NativeSelect
            aria-label="Number format"
            value={form.numberFormat}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                numberFormat: event.target
                  .value as WorkspaceGeneral['numberFormat'],
              }))
            }
          >
            {NUMBER_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-label font-medium text-fg">Record IDs</h3>
          <p className="m-0 text-label text-fg-muted">
            Prefix for each record kind. Numbers continue from the last used and
            are never reused, even for deleted drafts.
          </p>
        </div>
        <TableBox className="max-w-2xl">
          <Table aria-label="Record IDs">
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Example</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ID_PREFIX_KINDS.map((kind) => {
                const prefix = form.idPrefixes[kind] ?? ''
                return (
                  <TableRow key={kind}>
                    <TableCell className="capitalize">
                      {kind.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${kind} prefix`}
                        value={prefix}
                        className="h-[26px] w-28"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            idPrefixes: {
                              ...current.idPrefixes,
                              [kind]: event.target.value.toUpperCase(),
                            },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell className="mono text-fg-muted">
                      {prefix ? `${prefix}-2025-0001` : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableBox>
      </div>

      <div className="flex max-w-2xl flex-col gap-2">
        <h3 className="text-label font-medium text-fg">Publication approval</h3>
        <CheckRow
          title="Require approval before publishing dataset schema versions"
          body="When enabled, the current draft needs completed approval before publication. When disabled, drafts with no approval request can publish directly. Existing requests still gate publication and lock pending drafts."
          checked={form.publicationApprovalRequired}
          disabled={query.isLoading || query.isError || save.isPending}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              publicationApprovalRequired: checked,
            }))
          }
        />
      </div>

      <div className="flex max-w-2xl flex-col gap-2">
        <h3 className="text-label font-medium text-fg">Editing rules</h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-body">
          <li>
            Every signed record is locked; a change needs an amendment and a new
            review.
          </li>
          <li>
            A change to a saved value records the reason in History with the old
            and the new value.
          </li>
        </ul>
        <CheckRow
          title="Allow offline editing on this workspace’s devices"
          body="Edits sync when the device reconnects. Conflicts are shown to both people."
          checked={form.offlineEditingAllowed}
          disabled={query.isLoading || query.isError || save.isPending}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              offlineEditingAllowed: checked,
            }))
          }
        />
      </div>
    </Section>
  )
}
