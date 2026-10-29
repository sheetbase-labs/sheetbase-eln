/**
 * Set up (or change) how an instrument's files come in: how they're read,
 * where the data goes, and the agent that sends them. Writes the instrument's
 * one intake connector so no key or ID is ever typed.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AgentDownload } from '#/components/v3/instruments/agent-download'
import { setInstrumentIntakeMethod } from '#/components/v3/instruments/instruments-data'
import { useWritableProjects } from '#/components/v3/projects/use-writable-projects'
import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Choice } from '#/components/v3/ui/choice'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { Field } from '#/components/v3/ui/input'
import { RadioGroup } from '#/components/v3/ui/radio-group'
import { Select } from '#/components/v3/ui/select'
import { Stepper } from '#/components/v3/ui/stepper'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { createDataClient } from '#/lib/data-client'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import { describeConnectorsError } from '#/lib/connectors/client'
import { ensureBuiltinParsers } from '#/lib/connectors/parser-resolution'
import {
  intakeSetupQueryKeys,
  intakeSetupValues,
  previewSample,
  saveIntakeSetup,
} from '#/lib/connectors/intake-setup'
import type {
  IntakeSetupErrors,
  IntakeSetupValues,
  SamplePreview,
} from '#/lib/connectors/intake-setup'
import { agentQueryKeys } from '#/lib/connectors/agent-client'
import type { ConnectorWire } from '#/lib/connectors/types'
import {
  fetchParserSettings,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import type { ParserSettingsRow } from '#/lib/parser-settings'
import { t } from '#/copy'

const dataClient = createDataClient()
const SAMPLE_MAX_BYTES = 5 * 1024 * 1024

type StepNumber = 1 | 2 | 3

/** The newest version that isn't retired, which is what files are read with. */
function currentVersion(parser: ParserSettingsRow) {
  return parser.parser_versions.find((v) => v.status !== 'retired') ?? null
}

function SamplePreviewView({ preview }: { preview: SamplePreview }) {
  if (preview.status === 'later') {
    return (
      <Notice>
        {preview.reason === 'service'
          ? t('library.instruments.intakeSetup.sample.service')
          : t('library.instruments.intakeSetup.sample.binary')}
      </Notice>
    )
  }
  if (preview.status === 'unreadable') {
    return (
      <Notice tone="warn">
        {preview.reason === 'columns'
          ? t('library.instruments.intakeSetup.sample.missingColumns', {
              columns: preview.missing.join(', '),
            })
          : t('library.instruments.intakeSetup.sample.empty')}
      </Notice>
    )
  }
  const headers = preview.headers.slice(0, 6)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-label font-medium">
        {t('library.instruments.intakeSetup.sample.readAs', {
          name: preview.readBy,
          count: preview.rowCount,
        })}
      </p>
      <TableBox>
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row, index) => (
              <TableRow key={index}>
                {headers.map((header) => (
                  <TableCell key={header} className="mono">
                    {row[header] ?? ''}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      {preview.rowCount > preview.rows.length ? (
        <p className="m-0 text-label text-fg-muted">
          {t('library.instruments.intakeSetup.sample.showing', {
            count: preview.rows.length,
          })}
        </p>
      ) : null}
    </div>
  )
}

export function IntakeSetupDialog({
  workspaceId,
  instrument,
  intakeMethod,
  connector,
  canManage,
  initialStep = 1,
  onClose,
}: {
  workspaceId: string
  instrument: { id: string; name: string; displayId: string }
  intakeMethod: string
  /** The instrument's intake connector, when it has been set up before. */
  connector: ConnectorWire | null
  canManage: boolean
  initialStep?: StepNumber
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<StepNumber>(initialStep)
  const [values, setValues] = useState<IntakeSetupValues>(() =>
    intakeSetupValues(connector),
  )
  const [errors, setErrors] = useState<IntakeSetupErrors>({})
  const [saved, setSaved] = useState<ConnectorWire | null>(connector)
  const [sample, setSample] = useState<string | null>(null)
  const [mode, setMode] = useState<'each' | 'always'>(
    values.parserKey === '' ? 'each' : 'always',
  )

  const parsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    queryFn: async () => {
      // A workspace starts without the built-in parsers until something asks.
      await ensureBuiltinParsers(dataClient, workspaceId).catch(() => {})
      return fetchParserSettings(dataClient, workspaceId)
    },
  })
  // Only projects this person can add to: the agent writes as them.
  const projects = useWritableProjects(true)
  const schemas = useQuery({
    queryKey: ['instrument-intake', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
  })
  const datasets = useQuery({
    queryKey: ['instrument-intake', 'datasets', values.schemaVersionId],
    queryFn: () =>
      dataClient.list<{ id: string; name: string }>(
        'datasets',
        `?schema_version_id=eq.${encodeURIComponent(values.schemaVersionId)}&select=id,name&order=created_at.desc`,
      ),
    enabled: Boolean(values.schemaVersionId),
  })

  const parserRows = (parsers.data ?? []).filter((parser) =>
    currentVersion(parser),
  )
  const chosenParser =
    parserRows.find((parser) => parser.key === values.parserKey) ?? null
  const preview =
    sample !== null && (mode === 'each' || chosenParser)
      ? previewSample(sample, mode === 'each' ? null : chosenParser)
      : null

  const set = <TKey extends keyof IntakeSetupValues>(
    key: TKey,
    value: IntakeSetupValues[TKey],
  ) => setValues((prev) => ({ ...prev, [key]: value }))

  const save = useMutation({
    mutationFn: async () => {
      const result = await saveIntakeSetup(dataClient, {
        workspaceId,
        instrument,
        existing: saved,
        values,
      })
      if (!result.ok) return result
      if (intakeMethod === 'none' || intakeMethod === 'manual') {
        await setInstrumentIntakeMethod(instrument.id, 'filedrop')
      }
      return result
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      setSaved(result.connector)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['connectors'] }),
        queryClient.invalidateQueries({ queryKey: ['ui-port', 'instruments'] }),
        queryClient.invalidateQueries({
          queryKey: intakeSetupQueryKeys.connector(instrument.id),
        }),
        queryClient.invalidateQueries({
          queryKey: agentQueryKeys.status(result.connector.id),
        }),
      ])
      setStep(3)
    },
  })

  const steps = [
    t('library.instruments.intakeSetup.steps.format'),
    t('library.instruments.intakeSetup.steps.destination'),
    t('library.instruments.intakeSetup.steps.agent'),
  ]

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogHeader
          title={
            saved
              ? t('library.instruments.intakeSetup.titleChange')
              : t('library.instruments.intakeSetup.title')
          }
          description={t('library.instruments.intakeSetup.description')}
        />
        <DialogBody>
          <Stepper
            steps={steps}
            current={step}
            label={t('library.instruments.intakeSetup.stepsLabel')}
          />

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <RadioGroup
                value={mode}
                onValueChange={(next) => {
                  setMode(next === 'always' ? 'always' : 'each')
                  if (next === 'each') set('parserKey', '')
                }}
              >
                <Choice
                  value="each"
                  title={t('library.instruments.intakeSetup.format.readEach')}
                >
                  {t('library.instruments.intakeSetup.format.readEachHint')}
                </Choice>
                <Choice
                  value="always"
                  title={t('library.instruments.intakeSetup.format.always')}
                >
                  {t('library.instruments.intakeSetup.format.alwaysHint')}
                </Choice>
              </RadioGroup>
              {mode === 'always' ? (
                <Field
                  label={
                    <Tooltip
                      content={t(
                        'library.instruments.intakeSetup.format.parserTooltip',
                      )}
                    >
                      <span className="cursor-help">
                        {t('library.instruments.intakeSetup.format.parser')}
                      </span>
                    </Tooltip>
                  }
                >
                  <Select
                    value={values.parserKey}
                    onChange={(event) => set('parserKey', event.target.value)}
                  >
                    <option value="">
                      {t('library.instruments.intakeSetup.format.chooseParser')}
                    </option>
                    {parserRows.map((parser) => {
                      const approved =
                        currentVersion(parser)?.status === 'approved'
                      return (
                        <option key={parser.id} value={parser.key}>
                          {parser.name}
                          {approved
                            ? ''
                            : ` (${t('library.instruments.intakeSetup.format.notApproved')})`}
                        </option>
                      )
                    })}
                  </Select>
                </Field>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <FileDrop
                  label={t('library.instruments.intakeSetup.sample.drop')}
                  hint={t('library.instruments.intakeSetup.sample.hint')}
                  validate={(file) =>
                    file.size <= SAMPLE_MAX_BYTES
                      ? { ok: true }
                      : {
                          ok: false,
                          message: t(
                            'library.instruments.intakeSetup.sample.tooBig',
                          ),
                        }
                  }
                  onFile={async (file) => {
                    setSample(file ? await file.text() : null)
                  }}
                />
                {preview ? <SamplePreviewView preview={preview} /> : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('library.instruments.intakeSetup.destination.project')}
                hint={t(
                  'library.instruments.intakeSetup.destination.projectHint',
                )}
                required
                error={errors.projectId}
              >
                <Select
                  value={values.projectId}
                  onChange={(event) => set('projectId', event.target.value)}
                >
                  <option value="">
                    {t(
                      'library.instruments.intakeSetup.destination.chooseProject',
                    )}
                  </option>
                  {projects.usable.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t(
                  'library.instruments.intakeSetup.destination.structure',
                )}
                hint={t(
                  'library.instruments.intakeSetup.destination.structureHint',
                )}
                required
                error={errors.schemaVersionId}
              >
                <Select
                  value={values.schemaVersionId}
                  onChange={(event) => {
                    set('schemaVersionId', event.target.value)
                    set('datasetId', '')
                  }}
                >
                  <option value="">
                    {t(
                      'library.instruments.intakeSetup.destination.chooseStructure',
                    )}
                  </option>
                  {(schemas.data ?? []).map((option) => (
                    <option
                      key={option.schemaVersionId}
                      value={option.schemaVersionId}
                    >
                      {option.name} v{option.version}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('library.instruments.intakeSetup.destination.addTo')}
                hint={t(
                  'library.instruments.intakeSetup.destination.addToHint',
                )}
                className="sm:col-span-2"
              >
                <Select
                  value={values.datasetId}
                  disabled={!values.schemaVersionId}
                  onChange={(event) => set('datasetId', event.target.value)}
                >
                  <option value="">
                    {t('library.instruments.intakeSetup.destination.eachFile')}
                  </option>
                  {(datasets.data ?? []).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {schemas.isSuccess && schemas.data.length === 0 ? (
                <div className="sm:col-span-2">
                  <Notice tone="warn">
                    {t(
                      'library.instruments.intakeSetup.destination.needsPublished',
                    )}
                  </Notice>
                </div>
              ) : null}
              {save.isError ? (
                <div className="sm:col-span-2">
                  <Notice
                    tone="bad"
                    title={t('library.instruments.intakeSetup.cantSave')}
                  >
                    {describeConnectorsError(save.error)}
                  </Notice>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 3 && saved ? (
            <AgentDownload connectorId={saved.id} canManage={canManage} />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {step === 1 ? (
            <>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={
                  !canManage || (mode === 'always' && !values.parserKey)
                }
                onClick={() => setStep(2)}
              >
                {t('library.instruments.intakeSetup.next')}
              </Button>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Button onClick={() => setStep(1)}>
                {t('library.instruments.intakeSetup.back')}
              </Button>
              <Button
                variant="primary"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? t('library.instruments.intakeSetup.saving')
                  : t('library.instruments.intakeSetup.save')}
              </Button>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Button onClick={() => setStep(2)}>
                {t('library.instruments.intakeSetup.back')}
              </Button>
              <DialogClose render={<Button variant="primary" />}>
                {t('library.instruments.intakeSetup.done')}
              </DialogClose>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
