import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SampleLabelCard } from '#/components/v3/samples/sample-label-card'
import { Button } from '#/components/v3/ui/button'
import { CheckRow, SettingsBody } from '#/components/v3/settings/settings-page'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import {
  EMPTY_LABEL_INPUT,
  LABEL_RECORD_KINDS,
  LABEL_SIZE_PRESETS,
  fetchLabelTemplates,
  inputFromTemplate,
  labelTemplateKeys,
  saveLabelTemplate,
  setLabelTemplateArchived,
  validateLabelInput,
} from '#/lib/label-templates'
import type { LabelTemplateInput } from '#/lib/label-templates'
import { BARCODE_TYPE_LABELS } from '#/lib/labels'
import type { BarcodeType, LabelTemplate } from '#/lib/labels'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

const defaultClient = createDataClient()

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : t('settings.labelTemplatesPanel.databaseRefused')
}

/** What the preview label shows: a plausible sample, never a real one. */
const PREVIEW_RECORD = {
  identifier: 'SMP-2026-0142',
  title: t('settings.labelTemplatesPanel.harvestLotHl'),
  sampleType: t('settings.labelTemplatesPanel.cellHarvest'),
  customFields: { batch: 'HL-0934' },
  createdAt: new Date().toISOString(),
  properties: { holdCondition: '-80 °C', holdUntil: '2027-04-30' },
}

/**
 * Label templates: the size of a label, the kind of code on it and the facts it
 * carries. Choosing one when printing is on the sample page; here the lab
 * decides which exist and which is the default.
 */
export function LabelTemplatesPanel({
  workspaceId,
  canManage,
  client = defaultClient,
}: {
  workspaceId: string
  canManage: boolean
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const templates = useQuery({
    queryKey: labelTemplateKeys.all(workspaceId),
    queryFn: () => fetchLabelTemplates(client),
    enabled: Boolean(workspaceId),
  })
  // 'new' is the blank form; an id edits that template.
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: labelTemplateKeys.all(workspaceId),
    })
    void queryClient.invalidateQueries({ queryKey: ['label-templates'] })
  }

  if (templates.isError) {
    return (
      <SettingsBody>
        <Notice tone="bad">
          {t('settings.labelTemplatesPanel.labelTemplatesCould')}
          {errorMessage(templates.error)}
        </Notice>
      </SettingsBody>
    )
  }
  if (!templates.data) {
    return (
      <SettingsBody>
        <Muted>{t('settings.labelTemplatesPanel.loadingLabelTemplates')}</Muted>
      </SettingsBody>
    )
  }
  const list = templates.data
  const current =
    editing && editing !== 'new'
      ? (list.find((t) => t.id === editing) ?? null)
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <SettingsBody className="min-w-0 flex-1">
        {canManage ? (
          <div>
            <Button icon="plus" onClick={() => setEditing('new')}>
              {t('settings.labelTemplatesPanel.newTemplate')}
            </Button>
          </div>
        ) : null}
        {list.length === 0 ? (
          <EmptyState
            icon="template"
            title={t('settings.labelTemplatesPanel.labelTemplatesYet')}
            description={t(
              'settings.labelTemplatesPanel.untilAddOneDescription',
            )}
          />
        ) : (
          <TableBox>
            <Table caption={t('settings.labelTemplatesPanel.labelTemplates')}>
              <TableHeader>
                <tr>
                  <TableHead>
                    {t('settings.labelTemplatesPanel.template')}
                  </TableHead>
                  <TableHead>
                    {t('settings.labelTemplatesPanel.size')}
                  </TableHead>
                  <TableHead>
                    {t('settings.labelTemplatesPanel.code')}
                  </TableHead>
                  <TableHead>
                    {t('settings.labelTemplatesPanel.status')}
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {list.map((template) => (
                  <TableRow
                    key={template.id}
                    selected={template.id === editing}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setEditing(template.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setEditing(template.id)
                      }
                    }}
                  >
                    <TableCell>
                      <span className="font-medium text-fg">
                        {template.name}
                      </span>
                      {template.isDefault ? (
                        <span className="ml-2 text-label text-fg-muted">
                          {t('settings.labelTemplatesPanel.default')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="num">
                      {template.widthMm} × {template.heightMm} mm
                    </TableCell>
                    <TableCell>
                      {BARCODE_TYPE_LABELS[template.barcodeType]}
                    </TableCell>
                    <TableCell>
                      <Status tone={template.archivedAt ? 'draft' : 'ok'}>
                        {template.archivedAt
                          ? 'Archived'
                          : t('settings.labelTemplatesPanel.use')}
                      </Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        )}
      </SettingsBody>
      <aside
        aria-label={t('settings.labelTemplatesPanel.templateDetailsAria')}
        className="shrink-0 border-t border-border bg-surface p-4 lg:w-[340px] lg:border-l lg:border-t-0"
      >
        {editing && (editing === 'new' || current) ? (
          <TemplateForm
            key={editing}
            template={current}
            workspaceId={workspaceId}
            canManage={canManage}
            client={client}
            onSaved={(saved) => {
              refresh()
              setEditing(saved.id)
            }}
            onArchived={refresh}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Muted>{t('settings.labelTemplatesPanel.pickTemplateSee')}</Muted>
        )}
      </aside>
    </div>
  )
}

function TemplateForm({
  template,
  workspaceId,
  canManage,
  client,
  onSaved,
  onArchived,
  onCancel,
}: {
  template: LabelTemplate | null
  workspaceId: string
  canManage: boolean
  client: DataClient
  onSaved: (saved: LabelTemplate) => void
  onArchived: () => void
  onCancel: () => void
}) {
  const [input, setInput] = useState<LabelTemplateInput>(() =>
    template ? inputFromTemplate(template) : EMPTY_LABEL_INPUT,
  )
  const set = (patch: Partial<LabelTemplateInput>) =>
    setInput({ ...input, ...patch })
  const problem = validateLabelInput(input)
  const dirty = template
    ? JSON.stringify(input) !== JSON.stringify(inputFromTemplate(template))
    : true
  const save = useMutation({
    mutationFn: () =>
      saveLabelTemplate(client, workspaceId, template?.id ?? null, input),
    onSuccess: (saved) => {
      toast(
        template
          ? t('settings.labelTemplatesPanel.templateSaved')
          : t('settings.labelTemplatesPanel.templateAdded'),
      )
      onSaved(saved)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      setLabelTemplateArchived(client, template!.id, archived),
    onSuccess: (_, archived) => {
      toast(
        archived
          ? t('settings.labelTemplatesPanel.templateArchived')
          : t('settings.labelTemplatesPanel.templateRestored'),
      )
      onArchived()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const width = Number(input.widthMm)
  const height = Number(input.heightMm)
  const previewable = !validateLabelInput({ ...input, name: 'x' })
  const preset = LABEL_SIZE_PRESETS.find(
    (p) => p.widthMm === width && p.heightMm === height,
  )
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-section">
        {template?.name ?? t('settings.labelTemplatesPanel.newTemplate')}
      </h2>
      <div
        className={cn(
          'flex min-h-24 items-center justify-center overflow-auto rounded-md bg-surface-muted p-4',
        )}
      >
        {previewable ? (
          <div style={{ zoom: Math.min(1, 288 / (width * 3.7795)) }}>
            <SampleLabelCard
              record={PREVIEW_RECORD}
              host="app.example.org"
              fit="mm"
              template={{
                widthMm: width,
                heightMm: height,
                barcodeType: input.barcodeType,
                showLot: input.showLot,
                showSampleType: input.showSampleType,
                showCondition: input.showCondition,
                showUseBy: input.showUseBy,
              }}
            />
          </div>
        ) : (
          <Muted>{t('settings.labelTemplatesPanel.enterSizeSee')}</Muted>
        )}
      </div>
      <fieldset
        disabled={!canManage}
        className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
      >
        <Field label={t('settings.labelTemplatesPanel.name')}>
          <Input
            value={input.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={t('settings.labelTemplatesPanel.label')}>
          <Select
            value={input.recordKind}
            onChange={(e) => set({ recordKind: e.target.value })}
          >
            {LABEL_RECORD_KINDS.map((kind) => (
              <option key={kind.key} value={kind.key}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.labelTemplatesPanel.size')}>
          <Select
            value={preset ? preset.label : 'custom'}
            onChange={(e) => {
              const next = LABEL_SIZE_PRESETS.find(
                (p) => p.label === e.target.value,
              )
              if (next)
                set({
                  widthMm: String(next.widthMm),
                  heightMm: String(next.heightMm),
                })
            }}
          >
            {LABEL_SIZE_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
            {preset ? null : (
              <option value="custom">
                {t('settings.labelTemplatesPanel.customSize')}
              </option>
            )}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('settings.labelTemplatesPanel.widthMm')}>
            <Input
              inputMode="numeric"
              value={input.widthMm}
              onChange={(e) => set({ widthMm: e.target.value })}
            />
          </Field>
          <Field label={t('settings.labelTemplatesPanel.heightMm')}>
            <Input
              inputMode="numeric"
              value={input.heightMm}
              onChange={(e) => set({ heightMm: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label={t('settings.labelTemplatesPanel.code')}
          hint={
            input.barcodeType === 'qr'
              ? t('settings.labelTemplatesPanel.scanningOpensSample')
              : t('settings.labelTemplatesPanel.carriesSampleId')
          }
        >
          <Select
            value={input.barcodeType}
            onChange={(e) =>
              set({ barcodeType: e.target.value as BarcodeType })
            }
          >
            {(Object.keys(BARCODE_TYPE_LABELS) as BarcodeType[]).map((type) => (
              <option key={type} value={type}>
                {BARCODE_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium">
            {t('settings.labelTemplatesPanel.alsoPrint')}
          </span>
          <CheckRow
            title={t('settings.labelTemplatesPanel.sampleType')}
            checked={input.showSampleType}
            onCheckedChange={(v) => set({ showSampleType: v })}
          />
          <CheckRow
            title={t('settings.labelTemplatesPanel.lot')}
            checked={input.showLot}
            onCheckedChange={(v) => set({ showLot: v })}
          />
          <CheckRow
            title={t('settings.labelTemplatesPanel.storageCondition')}
            checked={input.showCondition}
            onCheckedChange={(v) => set({ showCondition: v })}
          />
          <CheckRow
            title={t('settings.labelTemplatesPanel.useDate')}
            checked={input.showUseBy}
            onCheckedChange={(v) => set({ showUseBy: v })}
          />
        </div>
        <CheckRow
          title={t('settings.labelTemplatesPanel.useDefaultSamples')}
          body={t('settings.labelTemplatesPanel.peopleStillPick')}
          checked={input.isDefault}
          onCheckedChange={(v) => set({ isDefault: v })}
        />
      </fieldset>
      {canManage ? (
        <div className="flex flex-col items-start gap-2">
          {dirty && problem && input.name.trim() ? (
            <span className="text-label text-danger-text">{problem}</span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!dirty || Boolean(problem) || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t('common.states.saving')
                : template
                  ? t('common.actions.saveChanges')
                  : t('settings.labelTemplatesPanel.addTemplate')}
            </Button>
            {template ? (
              <Button
                variant={template.archivedAt ? 'secondary' : 'danger'}
                icon={template.archivedAt ? undefined : 'archive'}
                disabled={archive.isPending}
                onClick={() => archive.mutate(!template.archivedAt)}
              >
                {template.archivedAt ? 'Restore' : 'Archive'}
              </Button>
            ) : (
              <Button onClick={onCancel}>{t('common.actions.cancel')}</Button>
            )}
          </div>
          {template && !template.archivedAt ? (
            <span className="text-label text-fg-muted">
              {t('settings.labelTemplatesPanel.archivedTemplatesStop')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
