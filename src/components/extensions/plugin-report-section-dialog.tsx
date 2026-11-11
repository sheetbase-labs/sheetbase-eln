/**
 * Add a section to a report from a plugin. The plugin's screen runs in its
 * sandboxed frame, inside this dialog, and hands back a title and some text
 * with `sheetbase.setSection({ title, text })`. The person reads what came back
 * and presses Add; it is then an ordinary text section of the report, frozen
 * as written, so a later change to the plugin does not rewrite a signed report.
 */
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { addTextSection, reportKeys } from '#/lib/reports'
import { t } from '#/copy'
import { PluginFrame } from './plugin-frame'
import { operationAccess, usePluginPoints } from './use-plugin-points'
import type { PluginFrameLinkOptions } from './use-plugin-frame-link'

interface Section {
  title: string
  text: string
}

/** What a plugin hands back for a section, bounded as the stored section is. */
const sectionSchema = z
  .object({ title: z.string(), text: z.string().catch('') })
  .transform((value) => ({
    title: value.title.trim().slice(0, 300),
    text: value.text,
  }))
  .refine((value) => value.title.length > 0)

/** The frame's own message handler: the plugin's payload arrives as it sent it. */
type EmitHandler = NonNullable<PluginFrameLinkOptions['onEmit']>

export function AddPluginSectionDialog({
  open,
  onOpenChange,
  recordId,
  definitionId,
  workspaceId,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recordId: string
  definitionId: string
  workspaceId: string
  projectId?: string | null
}) {
  const points = usePluginPoints()
  const queryClient = useQueryClient()
  const sections = points.reportSections
  const [chosen, setChosen] = React.useState(0)
  const [result, setResult] = React.useState<Section | null>(null)
  const item = sections.at(Math.min(chosen, sections.length - 1))

  const add = useMutation({
    mutationFn: (section: Section) =>
      addTextSection(notebookDataClient, {
        workspaceId,
        definitionId,
        title: section.title,
        body: section.text,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: reportKeys.detail(recordId),
      })
      setResult(null)
      onOpenChange(false)
    },
    onError: () => toast.error(t('projects.reports.addText.failed')),
  })

  const onEmit: EmitHandler = React.useCallback((name, payload) => {
    if (name !== 'section') return
    const parsed = sectionSchema.safeParse(payload)
    setResult(parsed.success ? parsed.data : null)
  }, [])

  if (!item) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setResult(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader title={t('plugins.reportSection.title')} />
        <DialogBody>
          {sections.length > 1 ? (
            <Select
              aria-label={t('plugins.reportSection.choose')}
              value={String(chosen)}
              onChange={(event) => {
                setChosen(Number(event.target.value))
                setResult(null)
              }}
            >
              {sections.map((section, index) => (
                <option
                  key={`${section.extensionKey}/${section.id}`}
                  value={index}
                >
                  {section.declaration.title} · {section.extensionName}
                </option>
              ))}
            </Select>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('plugins.screen.from', { plugin: item.extensionName })}
            </p>
          )}
          <PluginFrame
            key={`${item.extensionKey}/${item.id}`}
            extensionKey={item.extensionKey}
            pluginName={item.extensionName}
            point="report-sections"
            itemId={item.id}
            title={item.declaration.title}
            context={{
              recordId,
              reportId: definitionId,
              projectId: projectId ?? null,
            }}
            operations={operationAccess(points, item.extensionKey)}
            onEmit={onEmit}
            className="rounded-md border border-border"
          />
          {result ? (
            <div className="flex flex-col gap-1 rounded-md bg-surface-muted p-3">
              <span className="text-label text-fg-muted">
                {t('plugins.reportSection.willAdd')}
              </span>
              <b className="text-body">{result.title}</b>
              <p className="m-0 whitespace-pre-wrap text-body">{result.text}</p>
            </div>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('plugins.reportSection.waiting')}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!result || add.isPending}
            onClick={() => result && add.mutate(result)}
          >
            {t('plugins.reportSection.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
