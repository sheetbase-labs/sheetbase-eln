import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { toast } from '#/components/v3/ui/sonner'
import { useWritableProjects } from '#/components/v3/projects/use-writable-projects'
import { notebookDataClient } from '#/lib/notebook-data'
import { createReport, reportKeys } from '#/lib/reports'
import { t } from '#/copy'

/**
 * Start a report: a draft in a project that opens on its builder. The report
 * is made of sections, so there is nothing to write before it exists.
 */
export function NewReportDialog({
  workspaceId,
  autoOpen = false,
  onAutoOpened,
  projectId: fixedProjectId,
  trigger = true,
}: {
  workspaceId: string
  autoOpen?: boolean
  onAutoOpened?: () => void
  /** Start from a project page: the project is already chosen. */
  projectId?: string
  trigger?: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
  const [projectId, setProjectId] = useState(fixedProjectId ?? '')
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [touched, setTouched] = useState(false)
  const projects = useWritableProjects(open)
  const effectiveProjectId = projects.usable.some((p) => p.id === projectId)
    ? projectId
    : (projects.usable.at(0)?.id ?? '')
  const titleError =
    touched && title.trim().length < 3
      ? t('projects.reports.new.titleError')
      : undefined

  const create = useMutation({
    mutationFn: () =>
      createReport(notebookDataClient, {
        workspaceId,
        title,
        subtitle,
        projectId: effectiveProjectId,
      }),
    onSuccess: ({ recordId }) => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.all })
      setOpen(false)
      toast(t('projects.reports.new.created'))
      void navigate({
        to: '/reports/$reportId',
        params: { reportId: recordId },
      })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        /row-level security|permission denied/i.test(message)
          ? t('projects.reports.new.noPermission')
          : message || t('projects.reports.new.failed'),
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTitle('')
          setSubtitle('')
          setTouched(false)
        }
      }}
    >
      {trigger ? (
        <DialogTrigger render={<Button variant="primary" icon="plus" />}>
          {t('projects.reports.new.action')}
        </DialogTrigger>
      ) : null}
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.reports.new.title')}
          description={t('projects.reports.new.body')}
        />
        <DialogBody>
          {projects.isError ? (
            <Notice
              tone="bad"
              title={t('projects.reports.new.projectsFailed')}
              action={
                <Button size="sm" onClick={projects.refetch}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('projects.reports.new.projectsFailedBody')}
            </Notice>
          ) : null}
          <Field
            label={t('projects.reports.new.project')}
            required
            error={
              touched && !effectiveProjectId
                ? t('projects.reports.new.projectError')
                : undefined
            }
            hint={
              !projects.isLoading && projects.usable.length === 0
                ? t('projects.reports.new.noProjects')
                : undefined
            }
          >
            <PickerSelect
              noun="project"
              value={effectiveProjectId}
              onChange={(id) => setProjectId(id)}
              disabled={
                Boolean(fixedProjectId) ||
                projects.isLoading ||
                projects.usable.length === 0
              }
              options={projects.usable.map((p) => projectOption(p))}
            />
          </Field>
          <Field
            label={t('projects.reports.new.titleField')}
            required
            error={titleError}
          >
            <Input
              autoFocus
              value={title}
              placeholder={t('projects.reports.new.titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            label={t('projects.reports.new.subtitleField')}
            hint={t('projects.reports.new.subtitleHint')}
          >
            <Input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTouched(true)
              if (title.trim().length < 3 || !effectiveProjectId) return
              create.mutate()
            }}
          >
            {create.isPending
              ? t('projects.reports.new.creating')
              : t('projects.reports.new.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
