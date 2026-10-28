import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { Section } from '#/components/v3/ui/layout'
import { CheckRow, SettingsSaveBar } from './settings-page'
import { Select } from '#/components/v3/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { isIanaTimeZone } from '#/lib/pipeline-schedule'
import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  fetchWorkspaceGeneral,
  updateWorkspaceGeneral,
  DEFAULT_ID_PREFIXES,
  exampleRecordId,
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

/** One prefix map equality test, so Save can tell a real edit from a re-render.
 * An empty prefix means "no prefix", so a key cleared back to "" must compare
 * equal to an absent key — otherwise Save stays enabled on an unchanged form. */
function sameIdPrefixes(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aSet = Object.entries(a).filter(([, value]) => value !== '')
  const bSet = Object.entries(b).filter(([, value]) => value !== '')
  return (
    aSet.length === bSet.length &&
    aSet.every(([key, value]) => b[key] === value)
  )
}

function sameGeneral(a: WorkspaceGeneral, b: WorkspaceGeneral): boolean {
  return (
    a.name === b.name &&
    a.site === b.site &&
    a.timezone === b.timezone &&
    a.dateFormat === b.dateFormat &&
    a.numberFormat === b.numberFormat &&
    a.publicationApprovalRequired === b.publicationApprovalRequired &&
    a.offlineEditingAllowed === b.offlineEditingAllowed &&
    sameIdPrefixes(a.idPrefixes, b.idPrefixes)
  )
}

/**
 * SET-01.1 — workspace general settings (site, time zone, date and number
 * format). The RPC refuses a non-admin. UI port: app-3's v3 kit.
 */
const ID_KIND_LABELS: Record<(typeof ID_PREFIX_KINDS)[number], string> = {
  experiment: 'Experiment',
  sample: 'Sample',
  dataset: 'Dataset',
  protocol_template: 'Protocol',
  material: 'Material',
  report: 'Report',
  file: 'File',
  notebook_template: 'Notebook template',
}

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

  // `workspace_settings.timezone` is free text in the database and the update
  // RPC does not validate it, so an unknown zone would be saved and every
  // surface that formats a date in it would fall back silently. Validate here
  // against the same IANA check the scheduler uses.
  const timezone = form.timezone.trim()
  const timezoneError = isIanaTimeZone(timezone)
    ? null
    : 'Enter a valid IANA time zone, such as Europe/London.'
  // `update_workspace_name` refuses anything outside 1–120 characters, so an
  // empty name is not a saveable value: it is required here rather than
  // skipped silently while the rest of the form is written.
  const name = form.name?.trim() ?? ''
  const nameError = name ? null : 'Enter a workspace name.'
  const dirty = query.data ? !sameGeneral(form, query.data) : false
  // The example number carries the year the app would mint today, so the
  // sample cannot go stale as the calendar moves.

  const save = useMutation({
    mutationFn: async () => {
      await updateWorkspaceName(workspaceId, name)
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
    onSuccess: () => {
      // Every write above has resolved, so the save really happened and the
      // person gets told; the button going quiet again is not a confirmation.
      void queryClient.invalidateQueries({ queryKey: workspaceGeneralQueryKey })
      toast('Settings saved')
    },
  })

  return (
    <Section title="Workspace">
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
        <Field label="Name" required error={nameError}>
          <Input
            aria-label="Workspace name"
            value={form.name ?? ''}
            aria-invalid={nameError !== null}
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
        <Field label="Time zone" error={timezoneError}>
          <Input
            aria-label="Time zone"
            value={form.timezone}
            aria-invalid={timezoneError !== null}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Date format">
          <Select
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
          </Select>
        </Field>
        <Field label="Number format">
          <Select
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
          </Select>
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
        <TableBox>
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
                    <TableCell>{ID_KIND_LABELS[kind]}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`${kind} prefix`}
                        value={prefix}
                        placeholder={DEFAULT_ID_PREFIXES[kind]}
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
                      {exampleRecordId(kind, prefix)}
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
          body="When on, a notebook that loses its connection keeps edits on the device and syncs them on reconnect. When off, the notebook says editing needs a connection and keeps and replays nothing."
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

      <SettingsSaveBar
        dirty={dirty}
        pending={save.isPending}
        disabled={
          query.isLoading ||
          query.isError ||
          timezoneError !== null ||
          nameError !== null
        }
        onSave={() => save.mutate()}
      />
    </Section>
  )
}
