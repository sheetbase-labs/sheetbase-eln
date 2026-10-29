import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { Section } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { CheckRow, SettingsBody, SettingsHeader } from './settings-page'
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
  fetchRecordIdCounters,
  fetchWorkspaceGeneral,
  updateWorkspaceGeneral,
  DEFAULT_ID_PREFIXES,
  exampleRecordId,
  updateWorkspaceIdPrefixes,
  updateWorkspaceName,
  updateWorkspacePublicationPolicy,
  updateWorkspaceEditingRules,
  updateWorkspaceOfflineEditing,
  workspaceGeneralQueryKey,
  ID_PREFIX_KINDS,
} from '#/lib/workspace-general'
import type { WorkspaceGeneral } from '#/lib/workspace-general'
import { t } from '#/copy'

const DEFAULTS: WorkspaceGeneral = {
  name: null,
  site: null,
  timezone: 'Europe/London',
  dateFormat: 'd MMM yyyy',
  numberFormat: 'decimal',
  publicationApprovalRequired: false,
  offlineEditingAllowed: true,
  requireChangeReason: false,
  lockOnSign: true,
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
    a.requireChangeReason === b.requireChangeReason &&
    a.lockOnSign === b.lockOnSign &&
    sameIdPrefixes(a.idPrefixes, b.idPrefixes)
  )
}

/**
 * SET-01.1 — workspace general settings (site, time zone, date and number
 * format). The RPC refuses a non-admin. UI port: app-3's v3 kit.
 */
const ID_KIND_LABELS: Record<(typeof ID_PREFIX_KINDS)[number], string> = {
  experiment: t('settings.general.idKindExperiment'),
  sample: t('settings.general.idKindSample'),
  dataset: t('settings.general.idKindDataset'),
  protocol_template: t('settings.general.idKindProtocol'),
  material: t('settings.general.idKindMaterial'),
  report: t('settings.general.idKindReport'),
  file: t('settings.general.idKindFile'),
  notebook_template: t('settings.general.notebookTemplate'),
}

export function SettingsGeneral({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName?: string
}) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
    enabled: Boolean(workspaceId),
  })
  const counters = useQuery({
    queryKey: ['record-id-counters', workspaceId],
    queryFn: () => fetchRecordIdCounters(workspaceId),
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
    : t('settings.general.invalidTimeZone')
  // `update_workspace_name` refuses anything outside 1–120 characters, so an
  // empty name is not a saveable value: it is required here rather than
  // skipped silently while the rest of the form is written.
  const name = form.name?.trim() ?? ''
  const nameError = name ? null : t('settings.general.enterWorkspaceName')
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
      await updateWorkspaceEditingRules(workspaceId, {
        requireChangeReason: form.requireChangeReason,
        lockOnSign: form.lockOnSign,
      })
    },
    onSuccess: () => {
      // Every write above has resolved, so the save really happened and the
      // person gets told; the button going quiet again is not a confirmation.
      void queryClient.invalidateQueries({ queryKey: workspaceGeneralQueryKey })
      toast(t('settings.general.settingsSavedToast'))
    },
  })

  return (
    <>
      <SettingsHeader
        title={t('settings.general.general')}
        actions={
          <Button
            variant="primary"
            disabled={
              !dirty ||
              save.isPending ||
              query.isLoading ||
              query.isError ||
              timezoneError !== null ||
              nameError !== null
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('common.actions.saveChanges')}
          </Button>
        }
      >
        {workspaceName ?? 'Workspace'}
        {t('settings.general.changesApplyEveryone')}
      </SettingsHeader>
      <SettingsBody>
        <Section title={t('settings.general.workspace')}>
          <p className="m-0 max-w-2xl text-body text-fg-muted">
            {t('settings.general.nameSiteTime')}
          </p>

          {save.isError ? (
            <Notice tone="bad">
              {save.error instanceof Error
                ? save.error.message
                : t('settings.general.couldSaveSettings2')}
            </Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('settings.general.name')}
              required
              error={nameError}
            >
              <Input
                aria-label={t('settings.general.workspaceNameAria')}
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
            <Field label={t('settings.general.site')}>
              <Input
                aria-label={t('settings.general.site')}
                value={form.site ?? ''}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    site: event.target.value || null,
                  }))
                }
              />
            </Field>
            <Field label={t('settings.general.timeZone')} error={timezoneError}>
              <Input
                aria-label={t('settings.general.timeZone')}
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
            <Field label={t('settings.general.dateFormat')}>
              <Select
                aria-label={t('settings.general.dateFormat')}
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
            <Field label={t('settings.general.numberFormat')}>
              <Select
                aria-label={t('settings.general.numberFormat')}
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
              <h3 className="text-label font-medium text-fg">
                {t('settings.general.recordIds')}
              </h3>
              <p className="m-0 text-label text-fg-muted">
                {t('settings.general.prefixEachRecord')}
              </p>
            </div>
            <TableBox>
              <Table aria-label={t('settings.general.recordIds')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('settings.general.record')}</TableHead>
                    <TableHead>{t('settings.general.prefix')}</TableHead>
                    <TableHead>{t('settings.general.example')}</TableHead>
                    <TableHead>{t('settings.general.nextId')}</TableHead>
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
                            aria-label={t('settings.general.prefixAria', {
                              kind,
                            })}
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
                        <TableCell className="mono text-fg-muted">
                          {counters.data
                            ? exampleRecordId(
                                kind,
                                prefix,
                                counters.data[kind] ?? 1,
                              )
                            : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg">
              {t('settings.general.publicationApproval')}
            </h3>
            <CheckRow
              title={t('settings.general.requireApprovalBefore')}
              body={t('settings.general.whenEnabledCurrent2')}
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

          <div className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-fg">
              {t('settings.general.editingRules')}
            </h3>
            <CheckRow
              title={t('settings.general.everySignedRecord')}
              body={t('settings.general.everySignedRecordHint')}
              checked={form.lockOnSign}
              disabled={query.isLoading || query.isError || save.isPending}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, lockOnSign: checked }))
              }
            />
            <CheckRow
              title={t('settings.general.changeSavedValue')}
              body={t('settings.general.changeSavedValueHint')}
              checked={form.requireChangeReason}
              disabled={query.isLoading || query.isError || save.isPending}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  requireChangeReason: checked,
                }))
              }
            />
            <CheckRow
              title={t('settings.general.allowOfflineEditing')}
              body={t('settings.general.whenNotebookLoses2')}
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
      </SettingsBody>
    </>
  )
}
