import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { uploadProjectFile } from '#/lib/file-attach'
import {
  GHS_PICTOGRAMS,
  fetchMaterialSafety,
  hazardStatementText,
  isHazardous,
  knownHazardCodes,
  materialSafetyKeys,
  pictogramName,
  setMaterialSafety,
  setMaterialSds,
} from '#/lib/material-safety'
import type {
  GhsPictogram as GhsCode,
  MaterialSafety,
  SignalWord,
} from '#/lib/material-safety'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'
import { GhsPictogram } from './ghs-pictogram'

/** The pictograms of a material in a row. Nothing renders when there are none. */
export function HazardPictograms({
  pictograms,
  size = 24,
  className,
}: {
  pictograms: readonly GhsCode[]
  size?: number
  className?: string
}) {
  if (pictograms.length === 0) return null

  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1', className)}
      data-slot="hazard-pictograms"
    >
      {pictograms.map((code) => (
        <GhsPictogram key={code} code={code} size={size} />
      ))}
    </span>
  )
}

/** "Danger" or "Warning" in the tone the standard gives it. */
export function SignalWordBadge({ word }: { word: SignalWord }) {
  return (
    <Status tone={word === 'danger' ? 'bad' : 'warn'}>
      {t(`safety.signalWord.${word}`)}
    </Status>
  )
}

export function useMaterialSafety(recordId: string) {
  return useQuery({
    queryKey: materialSafetyKeys.one(recordId),
    queryFn: () => fetchMaterialSafety(notebookDataClient, recordId),
  })
}

/** Where the safety data sheet opens. */
export function sheetHref(fileRecordId: string): string {
  return `/api/files/${encodeURIComponent(fileRecordId)}/download`
}

/**
 * The chemical safety of a material: pictograms, signal word, hazard statements and
 * the safety data sheet, with an Edit action for people who can change the lot.
 */
export function MaterialSafetySection({
  recordId,
  name,
  projectId,
  canEdit,
  className,
}: {
  recordId: string
  name: string
  /** The project the lot lives in; a safety data sheet is stored there. */
  projectId: string | null
  canEdit: boolean
  className?: string
}) {
  const query = useMaterialSafety(recordId)
  const [open, setOpen] = useState(false)
  const safety = query.data ?? null
  const hazardous = isHazardous(safety)

  return (
    <section
      aria-label={t('safety.panel.title')}
      className={cn('max-w-xl', className)}
      data-slot="material-safety"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="font-sans text-label font-semibold">
          {t('safety.panel.title')}
        </h2>
        {canEdit ? (
          <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
            {hazardous || safety?.sheet
              ? t('safety.panel.edit')
              : t('safety.panel.add')}
          </Button>
        ) : null}
      </div>
      {query.isLoading ? null : !hazardous && !safety?.sheet ? (
        <p className="text-label text-fg-muted">{t('safety.panel.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {safety && safety.pictograms.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {safety.pictograms.map((code) => (
                <li key={code} className="flex items-center gap-2 text-label">
                  <GhsPictogram code={code} size={36} decorative />
                  <span>{pictogramName(code)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {safety?.signalWord ? (
            <div className="flex items-center gap-2 text-label">
              <span className="text-fg-muted">
                {t('safety.signalWord.label')}
              </span>
              <SignalWordBadge word={safety.signalWord} />
            </div>
          ) : null}
          {safety && safety.hazardStatements.length > 0 ? (
            <div>
              <h3 className="mb-1 text-label font-medium">
                {t('safety.panel.statements')}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {safety.hazardStatements.map((code) => (
                  <li key={code} className="flex gap-2 text-label">
                    <span className="mono w-14 shrink-0 text-fg-muted">
                      {code}
                    </span>
                    <span>{hazardStatementText(code)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="text-label">
            {safety?.sheet ? (
              <a
                href={sheetHref(safety.sheet.fileRecordId)}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                {t('safety.panel.sheetOf', { name: safety.sheet.name })}
              </a>
            ) : (
              <span className="text-fg-muted">{t('safety.panel.noSheet')}</span>
            )}
          </div>
        </div>
      )}
      {open ? (
        <SafetyEditDialog
          recordId={recordId}
          name={name}
          projectId={projectId}
          safety={safety}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

interface PickedSheet {
  fileObjectId: string
  name: string
}

function SafetyEditDialog({
  recordId,
  name,
  projectId,
  safety,
  onClose,
}: {
  recordId: string
  name: string
  projectId: string | null
  safety: MaterialSafety | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const [pictograms, setPictograms] = useState<GhsCode[]>(
    safety?.pictograms ?? [],
  )

  const [signalWord, setSignalWord] = useState<SignalWord | ''>(
    safety?.signalWord ?? '',
  )

  const [statements, setStatements] = useState<string[]>(
    safety?.hazardStatements ?? [],
  )

  const [search, setSearch] = useState('')
  const [allLots, setAllLots] = useState(true)
  // undefined: keep what is attached. null: remove it. A pick replaces it.
  const [sheet, setSheet] = useState<PickedSheet | null | undefined>(undefined)

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return knownHazardCodes()
      .filter((code) => !statements.includes(code))
      .filter(
        (code) =>
          needle === '' ||
          code.toLowerCase().includes(needle) ||
          hazardStatementText(code).toLowerCase().includes(needle),
      )
      .slice(0, 8)
  }, [search, statements])

  const save = useMutation({
    mutationFn: async () => {
      const lots = await setMaterialSafety(notebookDataClient, {
        recordId,
        pictograms,
        signalWord: signalWord === '' ? null : signalWord,
        hazardStatements: statements,
        allLots,
      })

      if (sheet !== undefined) {
        await setMaterialSds(notebookDataClient, {
          recordId,
          fileObjectId: sheet ? sheet.fileObjectId : null,
          allLots,
        })
      }

      return lots
    },
    onSuccess: (lots) => {
      void queryClient.invalidateQueries({ queryKey: ['material-safety'] })
      toast(t('safety.edit.saved', { count: lots }))
      onClose()
    },
    onError: (error) =>
      toast.error(
        t('safety.edit.failed', {
          message: error instanceof Error ? error.message : '',
        }),
      ),
  })

  const shownSheet =
    sheet === undefined
      ? safety?.sheet
        ? { name: safety.sheet.name }
        : null
      : sheet
        ? { name: sheet.name }
        : null

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader title={t('safety.edit.title', { name })} />
        <DialogBody>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-label font-medium">
              {t('safety.edit.pictograms')}
            </legend>
            <span className="text-label text-fg-muted">
              {t('safety.edit.pictogramsHint')}
            </span>
            <div className="mt-1 grid grid-cols-3 gap-2 max-sm:grid-cols-2">
              {GHS_PICTOGRAMS.map((code) => {
                const checked = pictograms.includes(code)

                return (
                  <label
                    key={code}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-label',
                      checked
                        ? 'border-primary bg-surface-hover'
                        : 'border-border',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) =>
                        setPictograms((current) =>
                          next
                            ? [...current, code]
                            : current.filter((c) => c !== code),
                        )
                      }
                      aria-label={pictogramName(code)}
                    />
                    <GhsPictogram code={code} size={28} decorative />
                    <span className="min-w-0 leading-tight">
                      {pictogramName(code)}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <Field label={t('safety.signalWord.label')}>
            <Select
              value={signalWord}
              onChange={(event) =>
                setSignalWord(event.target.value as SignalWord | '')
              }
              className="w-48"
            >
              <option value="">{t('safety.signalWord.none')}</option>
              <option value="danger">{t('safety.signalWord.danger')}</option>
              <option value="warning">{t('safety.signalWord.warning')}</option>
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <Field
              label={t('safety.edit.statements')}
              hint={t('safety.edit.statementsHint')}
            >
              <Input
                value={search}
                placeholder={t('safety.edit.statementsPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            {search.trim() !== '' ? (
              matches.length > 0 ? (
                <ul className="flex flex-col rounded-md border border-border">
                  {matches.map((code) => (
                    <li key={code}>
                      <button
                        type="button"
                        className="flex w-full gap-2 px-2 py-1 text-left text-label hover:bg-surface-hover"
                        onClick={() => {
                          setStatements((current) => [...current, code])
                          setSearch('')
                        }}
                      >
                        <span className="mono w-14 shrink-0 text-fg-muted">
                          {code}
                        </span>
                        <span>{hazardStatementText(code)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-label text-fg-muted">
                  {t('safety.edit.noMatches')}
                </p>
              )
            ) : null}
            {statements.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {statements.map((code) => (
                  <li key={code} className="flex items-center gap-2 text-label">
                    <span className="mono w-14 shrink-0 text-fg-muted">
                      {code}
                    </span>
                    <span className="min-w-0 flex-1">
                      {hazardStatementText(code)}
                    </span>
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={t('safety.edit.removeStatement', { code })}
                      onClick={() =>
                        setStatements((current) =>
                          current.filter((c) => c !== code),
                        )
                      }
                    >
                      {t('common.actions.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium">
              {t('safety.edit.sheet')}
            </span>
            {shownSheet ? (
              <div className="flex items-center justify-between gap-2 text-label">
                <span>{shownSheet.name}</span>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => setSheet(null)}
                >
                  {t('safety.edit.removeSheet')}
                </Button>
              </div>
            ) : null}
            {projectId ? (
              <FileDrop
                label={
                  shownSheet
                    ? t('safety.edit.replaceSheet')
                    : t('safety.edit.chooseSheet')
                }
                inputLabel={t('safety.edit.sheet')}
                hint={t('safety.edit.sheetHint')}
                accept="application/pdf"
                onFile={async (file) => {
                  if (!file) return
                  const uploaded = await uploadProjectFile({ projectId, file })
                  setSheet({
                    fileObjectId: uploaded.fileObjectId,
                    name: uploaded.displayName,
                  })
                }}
              />
            ) : null}
          </div>
          <label className="flex items-start gap-2 text-label">
            <Checkbox
              checked={allLots}
              onCheckedChange={(next) => setAllLots(Boolean(next))}
              aria-label={t('safety.edit.applyToLots', { name })}
            />
            <span className="flex flex-col">
              <span>{t('safety.edit.applyToLots', { name })}</span>
              <span className="text-fg-muted">
                {t('safety.edit.applyToLotsHint')}
              </span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('safety.edit.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('safety.edit.saving') : t('safety.edit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
