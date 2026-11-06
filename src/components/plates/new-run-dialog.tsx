/**
 * Adding a plate run: paste or choose the plate reader export, say which wells
 * are controls and samples, and optionally analyse straight away.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Textarea } from '#/components/inventory/list'
import { useRecordModelProjects } from '#/components/models/models-data'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { FileDrop } from '#/components/ui/file-drop'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { defaultAssayConfig, parsePlateTable } from '#/lib/plate-assay'
import type { AssayWell, PlateReadout } from '#/lib/plate-assay'
import { PLATE_FORMATS } from '#/lib/plate-map'
import type { PlateFormat } from '#/lib/plate-map'
import {
  analyseAndSavePlateRun,
  createPlateRun,
  messageOf,
  plateRunKeys,
  plateRunReference,
  resolveSampleIds,
} from '#/lib/plate-runs'
import type { PlateRunRow } from '#/lib/plate-runs'

const client = notebookDataClient

/** Combine the readings with a layout: the layout decides roles and samples. */
export function mergePlate(dataText: string, layoutText: string) {
  const data = parsePlateTable(dataText)
  const layout = layoutText.trim() ? parsePlateTable(layoutText) : null
  let wells: AssayWell[] = data.wells
  const readout: PlateReadout = { ...data.readout }
  if (layout && layout.wells.length > 0) {
    wells = layout.wells
    for (const [code, v] of Object.entries(layout.readout)) {
      if (!(code in readout)) readout[code] = v
    }
  }
  const warnings = [...data.warnings, ...(layout?.warnings ?? [])]
  return {
    wells,
    readout,
    format: layout?.format ?? data.format,
    warnings,
  }
}

export function NewRunDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (run: PlateRunRow) => void
}) {
  const queryClient = useQueryClient()
  const projects = useRecordModelProjects().data ?? []
  const [name, setName] = useState('')
  const [formatChoice, setFormatChoice] = useState<'auto' | PlateFormat>('auto')
  const [data, setData] = useState('')
  const [layout, setLayout] = useState('')
  const [projectId, setProjectId] = useState('')
  const [analyseNow, setAnalyseNow] = useState(true)
  const [interacted, setInteracted] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setFormatChoice('auto')
    setData('')
    setLayout('')
    setProjectId('')
    setAnalyseNow(true)
    setInteracted(false)
  }, [open])

  const parsed = useMemo(() => mergePlate(data, layout), [data, layout])
  const format: PlateFormat | null =
    formatChoice === 'auto' ? parsed.format : formatChoice
  const controls = parsed.wells.filter(
    (w) => w.role === 'positive_control' || w.role === 'negative_control',
  ).length
  const samples = parsed.wells.filter((w) => w.role === 'sample').length
  const readCount = Object.values(parsed.readout).filter(
    (v) => v !== null,
  ).length
  const nameError = name.trim() ? null : t('plates.form.nameRequired')
  const noWellColumn =
    data.trim() !== '' && parsed.warnings.includes('no_well_column')
  const skipped = parsed.warnings.filter(
    (w) => w.startsWith('bad_well') || w.startsWith('duplicate_well'),
  )

  const save = useMutation({
    mutationFn: async () => {
      if (!format) throw new Error(t('plates.form.previewNothing'))
      const labels = parsed.wells.flatMap((w) =>
        w.role === 'sample' && w.sampleLabel ? [w.sampleLabel] : [],
      )
      const ids = labels.length
        ? await resolveSampleIds(client, labels).catch(
            () => new Map<string, string>(),
          )
        : new Map<string, string>()
      const wells = parsed.wells.map((w) => ({
        ...w,
        sampleId:
          w.sampleLabel && ids.has(w.sampleLabel)
            ? (ids.get(w.sampleLabel) ?? null)
            : (w.sampleId ?? null),
      }))
      const unlinked = new Set(
        wells
          .filter((w) => w.sampleLabel && !w.sampleId)
          .map((w) => w.sampleLabel),
      ).size
      let run = await createPlateRun(client, {
        name,
        format,
        wells,
        readout: parsed.readout,
        config: defaultAssayConfig(),
        projectId: projectId || null,
      })
      if (analyseNow) {
        run = (await analyseAndSavePlateRun(client, run)).run
      }
      return { run, unlinked }
    },
    onSuccess: ({ run, unlinked }) => {
      void queryClient.invalidateQueries({ queryKey: plateRunKeys.all })
      toast.success(
        t('plates.form.created', { reference: plateRunReference(run.number) }),
      )
      if (unlinked > 0)
        toast.message(t('plates.form.unlinkedSamples', { count: unlinked }))
      onOpenChange(false)
      onCreated(run)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('plates.form.couldNotSave'))),
  })

  function submit() {
    setInteracted(true)
    if (nameError || !format || readCount === 0 || save.isPending) return
    save.mutate()
  }

  async function readFile(file: File | null, set: (text: string) => void) {
    if (!file) return
    set(await file.text())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.form.title')} />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field
                label={t('plates.form.name')}
                error={interacted ? nameError : null}
                required
              >
                <Input
                  value={name}
                  maxLength={200}
                  onChange={(e) => {
                    setName(e.target.value)
                    setInteracted(true)
                  }}
                />
              </Field>
              <Field
                label={t('plates.form.format')}
                hint={t('plates.form.formatHint')}
              >
                <Select
                  value={formatChoice}
                  onChange={(e) =>
                    setFormatChoice(e.target.value as 'auto' | PlateFormat)
                  }
                >
                  <option value="auto">{t('plates.form.formatAuto')}</option>
                  {PLATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`plates.formats.${f}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {projects.length > 0 ? (
                <Field label={t('plates.form.project')}>
                  <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">{t('plates.form.noProject')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
            <Field
              label={t('plates.form.data')}
              hint={t('plates.form.dataHint')}
              error={noWellColumn ? t('plates.form.noWellColumn') : null}
            >
              <Textarea
                rows={7}
                className="mono text-label"
                value={data}
                placeholder={t('plates.form.dataPlaceholder')}
                onChange={(e) => setData(e.target.value)}
              />
            </Field>
            <FileDrop
              label={t('plates.form.upload')}
              accept=".csv,.tsv,.txt"
              onFile={(file) => readFile(file, setData)}
            />
            <Field
              label={t('plates.form.layout')}
              hint={t('plates.form.layoutHint')}
            >
              <Textarea
                rows={4}
                className="mono text-label"
                value={layout}
                placeholder={t('plates.form.layoutPlaceholder')}
                onChange={(e) => setLayout(e.target.value)}
              />
            </Field>
            <div
              role="status"
              className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2 text-label text-fg-muted"
            >
              {readCount === 0 ? (
                <span>{t('plates.form.previewNothing')}</span>
              ) : (
                <>
                  <span>
                    {t('plates.form.preview', {
                      wells: readCount,
                      controls,
                      samples,
                    })}
                  </span>
                  {format ? (
                    <span>
                      {t('plates.form.previewFormat', {
                        format: t(`plates.formats.${format}`),
                      })}
                    </span>
                  ) : null}
                </>
              )}
              {skipped.length > 0 ? (
                <span>
                  {t('plates.form.skipped', {
                    count: skipped.length,
                    first: skipped[0].replace(/^[a-z_]+:/, ''),
                  })}
                </span>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-label">
              <Checkbox
                checked={analyseNow}
                onCheckedChange={(v) => setAnalyseNow(v === true)}
              />
              {t('plates.form.analyseNow')}
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || readCount === 0 || !format}
            onClick={submit}
          >
            {t('plates.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
