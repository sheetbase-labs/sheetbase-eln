import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
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
import { ObjectLink } from '#/components/v3/ui/object-link'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { LocationInput } from '#/components/v3/samples/location-field'
import { PrintLabelsDialog } from '#/components/v3/samples/sample-label-sheet'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { describeSampleError, registerSamples } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import { duplicateTitles, parseBulkSamples } from '#/lib/sample-bulk'
import { t } from '#/copy'

/**
 * Register many samples from a pasted list or a CSV/TSV file. The list is read
 * and shown back before anything is written, with each unreadable line named;
 * the server registers it in one transaction, so it lands whole or not at all.
 * The finished step names what was created, links each sample, and offers the
 * labels as one sheet.
 */
export function BulkRegisterDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  client = notebookDataClient,
  onRegistered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; title: string }[]
  defaultProjectId?: string
  client?: DataClient
  /** Called once the list is registered, so the caller can refresh its list. */
  onRegistered?: (samples: SampleRecord[]) => void
}) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [text, setText] = useState('')
  const [defaultLocation, setDefaultLocation] = useState('')
  const [created, setCreated] = useState<SampleRecord[] | null>(null)
  const [printing, setPrinting] = useState(false)

  const parsed = useMemo(
    () => (text.trim() ? parseBulkSamples(text) : null),
    [text],
  )
  const rows = parsed?.rows ?? []
  const issues = parsed?.issues ?? []
  const duplicates = useMemo(() => duplicateTitles(rows), [rows])
  const effectiveProject = projectId || defaultProjectId || ''

  const register = useMutation({
    mutationFn: () =>
      registerSamples(client, {
        projectId: effectiveProject,
        samples: rows.map((row) => ({
          title: row.title,
          sampleType: row.sampleType,
          quantity: row.quantity,
          quantityUnit: row.quantityUnit,
          storageLocation:
            row.storageLocation ?? (defaultLocation.trim() || undefined),
          barcode: row.barcode,
        })),
      }),
    onSuccess: (samples) => {
      setCreated(samples)
      onRegistered?.(samples)
    },
  })

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setText('')
      setCreated(null)
      register.reset()
    }
  }

  const canRegister =
    Boolean(effectiveProject) &&
    rows.length > 0 &&
    issues.length === 0 &&
    !register.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="w-[min(640px,calc(100vw-32px))]">
          {created ? (
            <>
              <DialogHeader
                title={t(
                  'library.samples.bulkRegisterDialog.registeredSamples',
                  { count: created.length },
                )}
              />
              <DialogBody>
                <ul
                  aria-label={t(
                    'library.samples.bulkRegisterDialog.registeredSamples2',
                  )}
                  className="m-0 flex max-h-[40vh] list-none flex-col gap-1 overflow-auto p-0"
                >
                  {created.map((sample) => (
                    <li key={sample.id} className="flex gap-3 text-body">
                      <ObjectLink
                        kind="sample"
                        id={sample.id}
                        identifier={sample.identifier}
                        className="w-24 shrink-0"
                      />
                      <span className="min-w-0 truncate">{sample.title}</span>
                    </li>
                  ))}
                </ul>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>
                  {t('common.actions.done')}
                </DialogClose>
                <Button variant="primary" onClick={() => setPrinting(true)}>
                  {t('library.samples.bulkRegisterDialog.printLabels', {
                    count: created.length,
                  })}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader
                title={t(
                  'library.samples.bulkRegisterDialog.registerSamplesFromAList',
                )}
                description={t(
                  'library.samples.bulkRegisterDialog.pasteRowsFromASpreadsheet',
                )}
              />
              <DialogBody>
                <Field label="Project" required>
                  <PickerSelect
                    noun="project"
                    value={effectiveProject}
                    onChange={(id) => setProjectId(id)}
                    options={projects.map((project) => projectOption(project))}
                  />
                </Field>
                <Field
                  label={t('library.samples.bulkRegisterDialog.samples')}
                  required
                >
                  <textarea
                    className="mono min-h-[140px] rounded-md border border-border bg-surface p-2 text-label"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t(
                      'library.samples.bulkRegisterDialog.lysateA500LFreezer',
                    )}
                    spellCheck={false}
                  />
                </Field>
                <FileDrop
                  label={t('library.samples.bulkRegisterDialog.orChooseACsvOr')}
                  inputLabel="Sample list file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  onFile={async (file) => {
                    if (file) setText(await file.text())
                  }}
                />
                <Field
                  label={t(
                    'library.samples.bulkRegisterDialog.locationForRowsWithoutOne',
                  )}
                  hint={t(
                    'library.samples.bulkRegisterDialog.optionalPickAPlaceAlready',
                  )}
                >
                  <LocationInput
                    value={defaultLocation}
                    onChange={setDefaultLocation}
                  />
                </Field>

                {issues.length ? (
                  <Notice
                    tone="warn"
                    title={t(
                      'library.samples.bulkRegisterDialog.fixTheseLinesToContinue',
                    )}
                  >
                    <ul className="m-0 pl-4">
                      {issues.slice(0, 8).map((issue, index) => (
                        <li key={`${issue.line}-${index}`}>
                          {t('library.samples.bulkRegisterDialog.line', {
                            line: issue.line,
                            message: issue.message,
                          })}
                        </li>
                      ))}
                      {issues.length > 8 ? (
                        <li>and {issues.length - 8} more</li>
                      ) : null}
                    </ul>
                  </Notice>
                ) : null}
                {duplicates.length ? (
                  <Notice
                    tone="warn"
                    title={t(
                      'library.samples.bulkRegisterDialog.someNamesRepeat',
                    )}
                  >
                    {duplicates.slice(0, 4).join(', ')}
                    {duplicates.length > 4
                      ? t('library.samples.bulkRegisterDialog.andMore')
                      : ''}{' '}
                    {t(
                      'library.samples.bulkRegisterDialog.appearMoreThanOnceEach',
                    )}
                  </Notice>
                ) : null}
                {rows.length ? (
                  <p role="status" className="m-0 text-label text-fg-muted">
                    {t(
                      'library.samples.bulkRegisterDialog.samplesReadyToRegister',
                      { count: rows.length },
                    )}
                  </p>
                ) : null}
                {register.isError ? (
                  <Notice
                    tone="bad"
                    title={t(
                      'library.samples.bulkRegisterDialog.nothingWasRegistered',
                    )}
                  >
                    {describeSampleError(register.error)}
                  </Notice>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>
                  {t('common.actions.cancel')}
                </DialogClose>
                <Button
                  variant="primary"
                  disabled={!canRegister}
                  onClick={() => register.mutate()}
                >
                  {register.isPending
                    ? t('library.samples.bulkRegisterDialog.registering')
                    : rows.length
                      ? t(
                          'library.samples.bulkRegisterDialog.registerSamples',
                          { count: rows.length },
                        )
                      : t(
                          'library.samples.bulkRegisterDialog.registerSamples2',
                        )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {created ? (
        <PrintLabelsDialog
          open={printing}
          onOpenChange={setPrinting}
          records={created}
          scope={`the ${created.length} samples just registered`}
          client={client}
        />
      ) : null}
    </>
  )
}
