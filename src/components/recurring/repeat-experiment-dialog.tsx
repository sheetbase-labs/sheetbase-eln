import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Tabs } from '#/components/ui/tabs'
import { toast } from '#/components/ui/sonner'
import { workspaceTimezone } from '#/components/schedule/booking-time'
import { describeCalendarError } from '#/lib/calendar'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  NO_REPEAT,
  createRepeat,
  describeRepeatResult,
  repeatFormError,
  repeatFormToRule,
} from '#/lib/recurring'
import type { RepeatForm } from '#/lib/recurring'
import { t } from '#/copy'
import { RepeatFields } from './repeat-fields'
import { recurringQueryKeys, useStartableTemplates } from './recurring-data'

/** Days written as "0, 7, 14, 30" → [0, 7, 14, 30], or `null` when they aren't. */
function parseTimePoints(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean)

  if (parts.length === 0 || parts.length > 60) return null

  const days = parts.map((part) =>
    /^\d{1,4}$/.test(part) ? Number(part) : NaN,
  )

  if (days.some((day) => Number.isNaN(day) || day > 3660)) return null

  return [...new Set(days)].sort((a, b) => a - b)
}

const LEAD_DAYS = [0, 1, 2, 3, 7] as const

/** How the schedule is stated: a repeating rule, or fixed time points. */
const MODES = ['regular', 'points'] as const

const tomorrow = () =>
  new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

/**
 * Start experiments from a template on a schedule: every week, every month, or
 * at fixed time points for a stability study. Each experiment is a real one,
 * made from the template's latest published version on its day.
 */
export function RepeatExperimentDialog({
  workspaceId,
}: {
  workspaceId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const templates = useStartableTemplates(open)

  const projects = useQuery({
    queryKey: ['recurring', 'projects'],
    enabled: open,
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?archived_at=is.null&select=id,title&order=title.asc&limit=200',
      ),
    staleTime: 30_000,
  })

  const queryClient = useQueryClient()

  const [templateId, setTemplateId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [firstDay, setFirstDay] = useState(tomorrow)
  const [mode, setMode] = useState<'regular' | 'points'>('regular')

  const [repeat, setRepeat] = useState<RepeatForm>({
    ...NO_REPEAT,
    frequency: 'weekly',
  })

  const [points, setPoints] = useState('')
  const [leadDays, setLeadDays] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setTemplateId('')
    setProjectId('')
    setName('')
    setFirstDay(tomorrow())
    setMode('regular')
    setRepeat({ ...NO_REPEAT, frequency: 'weekly' })
    setPoints('')
    setLeadDays(0)
    setError(null)
  }

  const create = useMutation({
    mutationFn: async () => {
      const problem = validate()

      if (problem) throw new Error(problem)
      const timezone = await workspaceTimezone()

      if (!timezone) throw new Error(t('projects.bookDialog.errors.zone'))

      const base = {
        kind: 'experiment' as const,
        title: name.trim(),
        startsOn: firstDay,
        timezone,
        notebookTemplateId: templateId,
        projectId,
        leadDays,
      }

      return createRepeat(
        notebookDataClient,
        mode === 'points'
          ? {
              ...base,
              frequency: 'offsets',
              offsetsDays: parseTimePoints(points),
            }
          : { ...base, ...repeatFormToRule(repeat) },
      )
    },
    onSuccess: ({ result }) => {
      toast(describeRepeatResult('experiment', result))
      void queryClient.invalidateQueries({
        queryKey: recurringQueryKeys.list(workspaceId ?? 'none', 'experiment'),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'experiments'],
      })
      setOpen(false)
      reset()
    },
    onError: (e) => {
      setError(
        e instanceof Error && !('code' in e)
          ? e.message
          : describeCalendarError(e),
      )
    },
  })

  function validate(): string | null {
    if (!templateId) return t('projects.recurring.errors.template')

    if (!projectId) return t('projects.recurring.errors.project')

    if (!name.trim()) return t('projects.recurring.errors.title')

    if (mode === 'points') {
      return parseTimePoints(points)
        ? null
        : t('projects.recurring.errors.offsets')
    }

    return repeatFormError(repeat, firstDay)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (!next) reset()
      }}
    >
      <Button variant="primary" onClick={() => setOpen(true)}>
        {t('projects.recurring.experiment.open')}
      </Button>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader title={t('projects.recurring.experiment.title')} />
        <DialogBody>
          <Field label={t('projects.recurring.experiment.template')} required>
            <SearchableSelect
              noun="template"
              value={templateId}
              onValueChange={(value) => setTemplateId(value)}
            >
              <option value="">
                {t('projects.recurring.experiment.chooseTemplate')}
              </option>
              {(templates.data ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </SearchableSelect>
            {templates.isSuccess && templates.data.length === 0 ? (
              <p className="m-0 text-label text-fg-muted">
                {t('projects.recurring.experiment.noTemplates')}
              </p>
            ) : null}
          </Field>
          <Field label={t('projects.recurring.experiment.project')} required>
            <SearchableSelect
              noun="project"
              value={projectId}
              onValueChange={(value) => setProjectId(value)}
            >
              <option value="">
                {t('projects.recurring.experiment.chooseProject')}
              </option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </SearchableSelect>
          </Field>
          <Field
            label={t('projects.recurring.experiment.name')}
            hint={t('projects.recurring.experiment.nameHint')}
            required
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('projects.recurring.experiment.firstDay')} required>
            <Input
              type="date"
              value={firstDay}
              onChange={(e) => setFirstDay(e.target.value)}
            />
          </Field>
          <Tabs
            mode="state"
            variant="segment"
            label={t('projects.recurring.experiment.how')}
            value={mode}
            onValueChange={(next) => {
              const chosen = MODES.find((candidate) => candidate === next)

              if (chosen) setMode(chosen)
            }}
            items={[
              {
                key: 'regular',
                label: t('projects.recurring.experiment.regular'),
              },
              {
                key: 'points',
                label: t('projects.recurring.experiment.timePoints'),
              },
            ]}
          />
          {mode === 'regular' ? (
            <RepeatFields
              value={repeat}
              onChange={setRepeat}
              firstDay={firstDay}
              allowNone={false}
            />
          ) : (
            <Field
              label={t('projects.recurring.experiment.timePointsLabel')}
              hint={t('projects.recurring.experiment.timePointsHint')}
            >
              <Input
                value={points}
                inputMode="numeric"
                onChange={(e) => setPoints(e.target.value)}
              />
            </Field>
          )}
          <Field label={t('projects.recurring.experiment.lead')}>
            <Select
              value={leadDays}
              onChange={(e) => setLeadDays(Number(e.target.value))}
            >
              {LEAD_DAYS.map((days) => (
                <option key={days} value={days}>
                  {days === 0
                    ? t('projects.recurring.experiment.leadSame')
                    : t('projects.recurring.experiment.leadBefore', {
                        count: days,
                      })}
                </option>
              ))}
            </Select>
          </Field>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setError(null)
              create.mutate()
            }}
          >
            {create.isPending
              ? t('projects.recurring.experiment.submitting')
              : t('projects.recurring.experiment.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
