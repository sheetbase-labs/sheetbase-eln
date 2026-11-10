import { useEffect, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

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
/** What the share sheet handed over: the title, text and link it sent. */
interface SharedContent {
  title?: string
  text?: string
  url?: string
}

export const Route = createFileRoute('/share-target')({
  validateSearch: (search): SharedContent => {
    const title = z.string().trim().safeParse(search.title)
    const text = z.string().trim().safeParse(search.text)
    const url = z.string().trim().safeParse(search.url)
    const shared: SharedContent = {}

    if (title.success && title.data) shared.title = title.data

    if (text.success && text.data) shared.text = text.data

    if (url.success && url.data) shared.url = url.data

    return shared
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

function noteText(shared: SharedContent) {
  return [shared.title, shared.text, shared.url]
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join('\n')
}

/** A file shared in, with the identity its row is keyed by. */
interface SharedFile {
  id: string
  file: File
}

const sharedFile = (file: File): SharedFile => ({
  id: crypto.randomUUID(),
  file,
})

function ShareTargetPage() {
  const shared = Route.useSearch()
  const navigate = Route.useNavigate()
  const [files, setFiles] = useState<SharedFile[]>([])
  const [picked, setPicked] = useState<PickerOption | null>(null)

  useEffect(() => {
    let live = true
    void readSharedFiles().then((parked) => {
      if (live && parked.length > 0) setFiles(parked.map(sharedFile))
    })

    const stop = onLaunchedWithFiles((opened) =>
      setFiles(opened.map(sharedFile)),
    )

    return () => {
      live = false
      stop()
    }
  }, [])

  const note = noteText(shared)
  const hasContent = files.length > 0 || note.length > 0

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- The success path navigates to the experiment, which reads its own notebook; this screen holds no cached notebook or work-item entry to invalidate.
  const add = useMutation({
    mutationFn: async (target: PickerOption) => {
      const record = await fetchRecord(notebookDataClient, target.id)

      if (!record?.projectId) throw new Error(t('pwa.shareTarget.failed'))

      for (const { file } of files) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each upload links its file record to the experiment in turn; overlapping them would interleave the record links the person then sees in order.
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
                  {files.map(({ id, file }) => (
                    <li key={id} className="flex items-center gap-2 text-label">
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
