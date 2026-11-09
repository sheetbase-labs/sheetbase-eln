import { useEffect, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Icon } from '#/components/icons'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { recordSearch } from '#/components/record-picker/entity-options'
import { uploadFileToExperiment } from '#/lib/experiment-files'
import { insertBlock } from '#/lib/notebook-mutations'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import {
  clearSharedFiles,
  onLaunchedWithFiles,
  readSharedFiles,
} from '#/lib/pwa/shared-inbox'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { formatFileSize } from '#/lib/format-numbers'
import { t } from '#/copy'

/**
 * Where "Share to Sheetbase" (a phone's share sheet) and "Open with Sheetbase"
 * (an installed desktop app) land. The service worker has already parked any
 * shared files; the person picks the experiment and they go in as its files,
 * with shared text or a link as a note in its notebook.
 */
export const Route = createFileRoute('/share-target')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { title?: string; text?: string; url?: string } => {
    const pick = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined

    return {
      ...(pick(search.title) ? { title: pick(search.title) } : {}),
      ...(pick(search.text) ? { text: pick(search.text) } : {}),
      ...(pick(search.url) ? { url: pick(search.url) } : {}),
    }
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ShareTargetPage,
})

const experimentSearch = recordSearch(['Experiment'])

function noteText(shared: { title?: string; text?: string; url?: string }) {
  return [shared.title, shared.text, shared.url]
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join('\n')
}

function ShareTargetPage() {
  const shared = Route.useSearch()
  const navigate = Route.useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [picked, setPicked] = useState<PickerOption | null>(null)

  useEffect(() => {
    let live = true
    void readSharedFiles().then((parked) => {
      if (live && parked.length > 0) setFiles(parked)
    })
    const stop = onLaunchedWithFiles((opened) => setFiles(opened))

    return () => {
      live = false
      stop()
    }
  }, [])

  const note = noteText(shared)
  const hasContent = files.length > 0 || note.length > 0

  const add = useMutation({
    mutationFn: async (target: PickerOption) => {
      const record = await fetchRecord(notebookDataClient, target.id)

      if (!record?.projectId) throw new Error(t('pwa.shareTarget.failed'))

      for (const file of files) {
        await uploadFileToExperiment(notebookDataClient, {
          projectId: record.projectId,
          experimentId: record.id,
          file,
        })
      }

      if (note) {
        await insertBlock(notebookDataClient, {
          recordId: record.id,
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: note.split('\n').map((line) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: line }],
              })),
            },
          },
          expectedStructureVersion: record.structureVersion,
        })
      }

      await clearSharedFiles()

      return record
    },
    onSuccess: (record) => {
      toast(t('pwa.shareTarget.added', { identifier: record.identifier }))
      void navigate({
        to: '/experiments/$expId',
        params: { expId: record.id },
      })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('pwa.shareTarget.failed'),
      ),
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-4 md:py-6">
        <div>
          <h1 className="font-heading text-title font-semibold">
            {t('pwa.shareTarget.title')}
          </h1>
          <p className="text-fg-muted">{t('pwa.shareTarget.subtitle')}</p>
        </div>

        {hasContent ? (
          <>
            <section
              aria-label={t('pwa.shareTarget.received')}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
            >
              {files.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-2 text-label"
                    >
                      <Icon name="file" size={14} />
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <span className="text-fg-muted">
                        {formatFileSize(file.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {note ? (
                <p className="whitespace-pre-wrap break-words text-label">
                  {note}
                </p>
              ) : null}
            </section>

            <div className="flex flex-col gap-1">
              <span className="text-label text-fg-muted">
                {t('pwa.shareTarget.experiment')}
              </span>
              <PickerSelect
                noun="experiment"
                value={picked?.id ?? ''}
                selected={picked}
                onChange={(_id, option) => setPicked(option)}
                search={experimentSearch}
                placeholder={t('pwa.shareTarget.experimentPlaceholder')}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={!picked || add.isPending}
                onClick={() => picked && add.mutate(picked)}
              >
                {add.isPending
                  ? t('pwa.shareTarget.adding')
                  : t('pwa.shareTarget.add')}
              </Button>
              <Button
                variant="quiet"
                disabled={add.isPending}
                onClick={() => {
                  void clearSharedFiles()
                  void navigate({ to: '/' })
                }}
              >
                {t('pwa.shareTarget.discard')}
              </Button>
            </div>
          </>
        ) : (
          <Notice>
            {t('pwa.shareTarget.nothing')}{' '}
            <Link
              to="/"
              className="text-link underline-offset-2 hover:underline"
            >
              {t('common.actions.back')}
            </Link>
          </Notice>
        )}
      </div>
    </div>
  )
}
