/**
 * Adding a plate run: paste or choose the plate reader export, say which wells
 * are controls and samples, and optionally analyse straight away.
 */
import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

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
import { fetchPlateDesignOptions, qcKeys } from '#/lib/run-qc'
import { notebookDataClient } from '#/lib/notebook-data'
import { defaultAssayConfig } from '#/lib/plate-assay'
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
import { mergePlate } from './merge-plate'

const client = notebookDataClient

/** The format picker's two kinds of answer: detect it, or name one. */
const formatChoiceSchema = z.union([z.literal('auto'), z.enum(PLATE_FORMATS)])

export function NewRunDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (run: PlateRunRow) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogHeader title={t('plates.form.title')} />
        <NewRunBody
          open={open}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The dialog's form. It is mounted only while the dialog is open, so opening
 * the dialog starts a new attempt rather than showing the last one's answers.
 */
function NewRunBody({
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
  const [designId, setDesignId] = useState('')

  const designs =
    useQuery({
      queryKey: qcKeys.designs,
      queryFn: () => fetchPlateDesignOptions(client),
      staleTime: 60_000,
      enabled: open,
    }).data ?? []

  const [analyseNow, setAnalyseNow] = useState(true)
  const [interacted, setInteracted] = useState(false)

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
        designId: designId || null,
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
    onError: (error) =>
      toast.error(messageOf(error, t('plates.form.couldNotSave'))),
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
    <>
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
                onChange={(e) => {
                  const choice = formatChoiceSchema.safeParse(e.target.value)

                  if (choice.success) setFormatChoice(choice.data)
                }}
              >
                <option value="auto">{t('plates.form.formatAuto')}</option>
                {PLATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`plates.formats.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {designs.length > 0 ? (
              <Field
                label={t('plates.form.design')}
                hint={t('plates.form.designHint')}
              >
                <SearchableSelect
                  noun="design"
                  value={designId}
                  onValueChange={(value) => setDesignId(value)}
                >
                  <option value="">{t('plates.form.noDesign')}</option>
                  {designs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
            ) : null}
            {projects.length > 0 ? (
              <Field label={t('plates.form.project')}>
                <SearchableSelect
                  noun="project"
                  value={projectId}
                  onValueChange={(value) => setProjectId(value)}
                >
                  <option value="">{t('plates.form.noProject')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </SearchableSelect>
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
    </>
  )
}
