import { useLeaveGuard } from '#/components/settings/use-leave-guard'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Section } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { CheckRow, SettingsBody, SettingsHeader } from './settings-page'
import { Select } from '#/components/ui/select'
import { LabLogoSettings } from './lab-logo-settings'
import { WorkingHoursSettings } from './working-hours-settings'
import { SettingsSampleData } from './settings-sample-data'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
  setRegulatedLab,
  setRetentionEnabled,
  setSpecLimitsEnabled,
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
  regulatedLab: false,
  specLimitsEnabled: false,
  retentionEnabled: false,
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
    a.regulatedLab === b.regulatedLab &&
    a.specLimitsEnabled === b.specLimitsEnabled &&
    a.retentionEnabled === b.retentionEnabled &&
    sameIdPrefixes(a.idPrefixes, b.idPrefixes)
  )
}

function validateGeneralDraft(form: WorkspaceGeneral) {
  return {
    timezoneError: isIanaTimeZone(form.timezone.trim())
      ? null
      : t('settings.general.invalidTimeZone'),
    nameError: form.name?.trim()
      ? null
      : t('settings.general.enterWorkspaceName'),
  }
}

/** Apply workspace settings in order and stop at the first refused write. */
async function saveGeneral(
  workspaceId: string,
  form: WorkspaceGeneral,
  saved: WorkspaceGeneral | undefined,
) {
  await updateWorkspaceName(workspaceId, form.name?.trim() ?? '')
  await updateWorkspaceGeneral(workspaceId, form)
  await updateWorkspaceIdPrefixes(workspaceId, form.idPrefixes)
  await updateWorkspacePublicationPolicy(
    workspaceId,
    form.publicationApprovalRequired,
  )
  await updateWorkspaceOfflineEditing(workspaceId, form.offlineEditingAllowed)
  await updateWorkspaceEditingRules(workspaceId, {
    requireChangeReason: form.requireChangeReason,
    lockOnSign: form.lockOnSign,
  })

  if (form.regulatedLab !== saved?.regulatedLab)
    await setRegulatedLab(workspaceId, form.regulatedLab)

  if (form.specLimitsEnabled !== saved?.specLimitsEnabled)
    await setSpecLimitsEnabled(workspaceId, form.specLimitsEnabled)

  if (form.retentionEnabled !== saved?.retentionEnabled)
    await setRetentionEnabled(workspaceId, form.retentionEnabled)
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

  // A workspace's settings row is written by its first save, so a workspace
  // that skipped setup has none: the read succeeds with `null`. It still has
  // a name and the database defaults (which DEFAULTS mirrors), so that is
  // what the form starts from and what Save compares against.
  const saved = useMemo<WorkspaceGeneral | undefined>(
    () =>
      query.isSuccess
        ? (query.data ?? { ...DEFAULTS, name: workspaceName ?? null })
        : undefined,
    [query.isSuccess, query.data, workspaceName],
  )

  const [form, setForm] = useState<WorkspaceGeneral>(DEFAULTS)

  useEffect(() => {
    if (saved) setForm(saved)
  }, [saved])

  // `workspace_settings.timezone` is free text in the database and the update
  // RPC does not validate it, so an unknown zone would be saved and every
  // surface that formats a date in it would fall back silently. Validate here
  // against the same IANA check the scheduler uses.
  // `update_workspace_name` refuses anything outside 1–120 characters, so an
  // empty name is not a saveable value: it is required here rather than
  // skipped silently while the rest of the form is written.
  const { nameError, timezoneError } = validateGeneralDraft(form)
  const dirty = saved ? !sameGeneral(form, saved) : false
  // The example number carries the year the app would mint today, so the
  // sample cannot go stale as the calendar moves.

  const save = useMutation({
    mutationFn: () => saveGeneral(workspaceId, form, saved),
    onSuccess: () => {
      // Every write above has resolved, so the save really happened and the
      // person gets told; the button going quiet again is not a confirmation.
      void queryClient.invalidateQueries({ queryKey: workspaceGeneralQueryKey })
      toast(t('settings.general.settingsSavedToast'))
    },
  })

  const controlsDisabled = query.isLoading || query.isError || save.isPending

  useLeaveGuard({
    dirty,
    label: t('settings.general.general'),
    canSave: timezoneError === null && nameError === null,
    save: async () => {
      try {
        await save.mutateAsync()

        return true
      } catch {
        return false
      }
    },
    discard: () => {
      if (saved) setForm(saved)
    },
  })

  return (
    <>
      <SettingsHeader
        phoneActions="bottom"
        title={t('settings.general.general')}
        actions={
          <Button
            variant="primary"
            disabled={
              !dirty ||
              controlsDisabled ||
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
        {workspaceName ?? t('settings.general.workspace')}
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
                onChange={(event) => {
                  const option = NUMBER_FORMATS.find(
                    (candidate) => candidate.value === event.target.value,
                  )

                  if (!option) return
                  setForm((current) => ({
                    ...current,
                    numberFormat: option.value,
                  }))
                }}
              >
                {NUMBER_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <RecordIdPrefixes
            prefixes={form.idPrefixes}
            counters={counters.data}
            onChange={(kind, prefix) =>
              setForm((current) => ({
                ...current,
                idPrefixes: { ...current.idPrefixes, [kind]: prefix },
              }))
            }
          />

          <WorkspacePolicies
            form={form}
            setForm={setForm}
            disabled={controlsDisabled}
          />
        </Section>
        <LabLogoSettings />
        <WorkingHoursSettings workspaceId={workspaceId} />
        <SettingsSampleData workspaceId={workspaceId} />
      </SettingsBody>
    </>
  )
}

function RecordIdPrefixes({
  prefixes,
  counters,
  onChange,
}: {
  prefixes: WorkspaceGeneral['idPrefixes']
  counters: Awaited<ReturnType<typeof fetchRecordIdCounters>> | undefined
  onChange: (kind: (typeof ID_PREFIX_KINDS)[number], prefix: string) => void
}) {
  // The columns stay the same across renders so the prefix boxes keep focus
  // while typing; what changes (the prefix, the examples) rides on the rows,
  // and the handler is read through a ref.
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  const lines = ID_PREFIX_KINDS.map((kind) => {
    const prefix = prefixes[kind] ?? ''

    return {
      id: kind,
      kind,
      prefix,
      example: exampleRecordId(kind, prefix),
      next: counters ? exampleRecordId(kind, prefix, counters[kind] ?? 1) : '—',
    }
  })

  const columns = useMemo<RegistryColumn<(typeof lines)[number]>[]>(
    () => [
      {
        id: 'record',
        header: t('settings.general.record'),
        cell: ({ row }) => ID_KIND_LABELS[row.original.kind],
      },
      {
        id: 'prefix',
        header: t('settings.general.prefix'),
        cell: ({ row }) => {
          const kind = row.original.kind

          return (
            <Input
              aria-label={t('settings.general.prefixAria', { kind })}
              value={row.original.prefix}
              placeholder={DEFAULT_ID_PREFIXES[kind]}
              className="h-[26px] w-28"
              onChange={(event) =>
                onChangeRef.current(kind, event.target.value.toUpperCase())
              }
            />
          )
        },
      },
      {
        id: 'example',
        header: t('settings.general.example'),
        cell: ({ row }) => (
          <span className="mono text-fg-muted">{row.original.example}</span>
        ),
      },
      {
        id: 'nextId',
        header: t('settings.general.nextId'),
        cell: ({ row }) => (
          <span className="mono text-fg-muted">{row.original.next}</span>
        ),
      },
    ],
    [],
  )

  return (
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
        <RegistryGrid
          label={t('settings.general.recordIds')}
          rows={lines}
          columns={columns}
          getRowId={(line) => line.id}
          selectable={false}
          sortable={false}
        />
      </TableBox>
    </div>
  )
}

function WorkspacePolicies({
  form,
  setForm,
  disabled,
}: {
  form: WorkspaceGeneral
  setForm: Dispatch<SetStateAction<WorkspaceGeneral>>
  disabled: boolean
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">
          {t('settings.general.publicationApproval')}
        </h3>
        <CheckRow
          title={t('settings.general.requireApprovalBefore')}
          body={t('settings.general.whenEnabledCurrent2')}
          checked={form.publicationApprovalRequired}
          disabled={disabled}
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
          {t('settings.general.regulatedLab')}
        </h3>
        <CheckRow
          title={t('settings.general.regulatedLabTitle')}
          body={t('settings.general.regulatedLabHint')}
          checked={form.regulatedLab}
          disabled={disabled}
          onCheckedChange={(checked) =>
            setForm((current) => ({ ...current, regulatedLab: checked }))
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-fg">
          {t('quality.general.title')}
        </h3>
        <CheckRow
          title={t('quality.general.limitsTitle')}
          body={t('quality.general.limitsHint')}
          checked={form.specLimitsEnabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              specLimitsEnabled: checked,
            }))
          }
        />
        <CheckRow
          title={t('quality.general.retentionTitle')}
          body={t('quality.general.retentionHint')}
          checked={form.retentionEnabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              retentionEnabled: checked,
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
          disabled={disabled}
          onCheckedChange={(checked) =>
            setForm((current) => ({ ...current, lockOnSign: checked }))
          }
        />
        <CheckRow
          title={t('settings.general.changeSavedValue')}
          body={t('settings.general.changeSavedValueHint')}
          checked={form.requireChangeReason}
          disabled={disabled}
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
          disabled={disabled}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              offlineEditingAllowed: checked,
            }))
          }
        />
      </div>
    </>
  )
}
