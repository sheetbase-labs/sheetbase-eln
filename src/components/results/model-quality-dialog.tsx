/**
 * The Quality button on a model: tick it as an incident log, and (when the lab
 * has result limits on) set the lowest, highest and alert values for each of
 * its number fields.
 */
import { useEffect, useMemo, useState } from 'react'
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
import { Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useRecordModelFields } from '#/components/models/models-data'
import type { WorkspaceRecordModel } from '#/components/models/models-data'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  NO_LIMITS,
  fetchFieldLimits,
  fetchIncidentModels,
  limitsProblem,
  messageOf,
  parseLimit,
  qualityKeys,
  saveFieldLimits,
  setModelIncidentLog,
} from '#/lib/result-quality'
import type { SpecLimits } from '#/lib/result-quality'

const client = notebookDataClient

interface Draft {
  lower: string
  upper: string
  alertLower: string
  alertUpper: string
}

const BLANK: Draft = { lower: '', upper: '', alertLower: '', alertUpper: '' }

function toDraft(limits: SpecLimits): Draft {
  const text = (n: number | null) => (n === null ? '' : String(n))

  return {
    lower: text(limits.lowerLimit),
    upper: text(limits.upperLimit),
    alertLower: text(limits.alertLower),
    alertUpper: text(limits.alertUpper),
  }
}

function fromDraft(draft: Draft): SpecLimits {
  return {
    lowerLimit: parseLimit(draft.lower),
    upperLimit: parseLimit(draft.upper),
    alertLower: parseLimit(draft.alertLower),
    alertUpper: parseLimit(draft.alertUpper),
  }
}

/** A box with text in it that is not a number is a typo, not "no limit". */
function hasBadNumber(draft: Draft): boolean {
  return Object.values(draft).some(
    (text) => text.trim() !== '' && parseLimit(text) === null,
  )
}

export function ModelQualityDialog({
  open,
  onOpenChange,
  model,
  specLimitsOn,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: WorkspaceRecordModel
  specLimitsOn: boolean
}) {
  const queryClient = useQueryClient()
  const fieldsQuery = useRecordModelFields(model.key)

  const numberFields = useMemo(
    () =>
      (fieldsQuery.data ?? []).filter(
        (f) =>
          f.lifecycle === 'active' &&
          (f.logicalType === 'integer' || f.logicalType === 'decimal'),
      ),
    [fieldsQuery.data],
  )

  const limits = useQuery({
    queryKey: qualityKeys.limits(model.key),
    queryFn: () => fetchFieldLimits(client, model.key),
    enabled: open && specLimitsOn,
  })

  const incidentModels = useQuery({
    queryKey: qualityKeys.incidentModels,
    queryFn: () => fetchIncidentModels(client),
    enabled: open,
  })

  const isLog = Boolean(incidentModels.data?.some((m) => m.key === model.key))

  const [log, setLog] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  useEffect(() => {
    if (!open) return
    setLog(isLog)
  }, [open, isLog])
  useEffect(() => {
    if (!open || !limits.data) return
    setDrafts(
      Object.fromEntries(limits.data.map((l) => [l.fieldName, toDraft(l)])),
    )
  }, [open, limits.data])

  const problems = numberFields.map((field) => {
    const draft = drafts[field.fieldName] ?? BLANK

    if (hasBadNumber(draft)) return 'needsLimit' as const

    return limitsProblem(fromDraft(draft))
  })

  const blocked = problems.some(Boolean)

  const save = useMutation({
    mutationFn: async () => {
      if (log !== isLog) await setModelIncidentLog(client, model.key, log)

      if (specLimitsOn) {
        const saved = new Map(
          (limits.data ?? []).map((l) => [l.fieldName, l] as const),
        )

        for (const field of numberFields) {
          const next = fromDraft(drafts[field.fieldName] ?? BLANK)
          const was = saved.get(field.fieldName) ?? NO_LIMITS

          const same =
            was.lowerLimit === next.lowerLimit &&
            was.upperLimit === next.upperLimit &&
            was.alertLower === next.alertLower &&
            was.alertUpper === next.alertUpper

          if (!same) {
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each field's limits are written only after the previous write settles, so a rejected save stops the run instead of starting the remaining writes.
            await saveFieldLimits(client, model.key, field.fieldName, next)
          }
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qualityKeys.all })
      toast.success(t('quality.limits.saved'))
      onOpenChange(false)
    },
    onError: (e) => toast.error(messageOf(e, t('quality.limits.couldNotSave'))),
  })

  function setDraft(fieldName: string, key: keyof Draft, value: string) {
    setDrafts((current) => ({
      ...current,
      [fieldName]: { ...(current[fieldName] ?? BLANK), [key]: value },
    }))
  }

  const problemText = (code: string | null) =>
    code === 'order'
      ? t('quality.limits.problemOrder')
      : code === 'alertOutside'
        ? t('quality.limits.problemAlertOutside')
        : code
          ? t('quality.limits.problemNeedsLimit')
          : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader title={t('quality.limits.title', { name: model.name })} />
        <DialogBody>
          <div className="flex flex-col gap-5">
            <label className="flex items-start gap-2 text-body">
              <Checkbox
                checked={log}
                onCheckedChange={(checked) => setLog(checked === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="font-medium">
                  {t('quality.limits.incidentTick')}
                </span>
                <span className="text-label text-fg-muted">
                  {t('quality.limits.incidentTickHint')}
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-label font-semibold">
                {t('quality.limits.resultsTitle')}
              </h3>
              {!specLimitsOn ? (
                <p className="m-0 text-label text-fg-muted">
                  {t('quality.limits.resultsOff')}
                </p>
              ) : numberFields.length === 0 ? (
                <p className="m-0 text-label text-fg-muted">
                  {t('quality.limits.noNumberFields')}
                </p>
              ) : (
                <>
                  <p className="m-0 text-label text-fg-muted">
                    {t('quality.limits.resultsHint')}
                  </p>
                  <TableBox>
                    <Table caption={t('quality.limits.tableLabel')}>
                      <TableHeader>
                        <tr>
                          <TableHead>{t('quality.limits.field')}</TableHead>
                          <TableHead>{t('quality.limits.lowest')}</TableHead>
                          <TableHead>{t('quality.limits.highest')}</TableHead>
                          <TableHead>{t('quality.limits.alertLow')}</TableHead>
                          <TableHead>{t('quality.limits.alertHigh')}</TableHead>
                        </tr>
                      </TableHeader>
                      <TableBody>
                        {numberFields.map((field, index) => {
                          const draft = drafts[field.fieldName] ?? BLANK
                          const problem = problemText(problems[index])

                          const box = (key: keyof Draft, label: string) => (
                            <TableCell>
                              <Input
                                inputMode="decimal"
                                aria-label={`${field.label}: ${label}`}
                                aria-invalid={problem ? true : undefined}
                                value={draft[key]}
                                onChange={(e) =>
                                  setDraft(field.fieldName, key, e.target.value)
                                }
                                className="w-32"
                              />
                            </TableCell>
                          )

                          return (
                            <TableRow key={field.fieldName}>
                              <TableCell>
                                <span className="font-medium text-fg">
                                  {field.label}
                                </span>
                                {problem ? (
                                  <span
                                    role="alert"
                                    className="block text-label text-danger-text"
                                  >
                                    {problem}
                                  </span>
                                ) : null}
                              </TableCell>
                              {box('lower', t('quality.limits.lowest'))}
                              {box('upper', t('quality.limits.highest'))}
                              {box('alertLower', t('quality.limits.alertLow'))}
                              {box('alertUpper', t('quality.limits.alertHigh'))}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableBox>
                </>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('quality.limits.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || blocked}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('quality.limits.saving')
              : t('quality.limits.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
