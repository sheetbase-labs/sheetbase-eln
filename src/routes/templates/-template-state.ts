import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { formatDate } from '#/lib/notebook-data'
import { t } from '#/copy'

/** Where a template stands: a status and a short note beside it. */
export interface TemplateState {
  tone: 'ok' | 'draft' | 'stored'
  label: string
  note: string | null
}

/**
 * Where a template stands, in one status and a short note: published and
 * which version, a draft waiting to be published, or retired. "Active" said
 * nothing a reader could use, and sat oddly beside "Draft v1".
 */
export function templateState(
  item: Pick<NotebookTemplate, 'lifecycle'>,
  published: NotebookTemplateVersion | undefined,
  openDraft: NotebookTemplateVersion | null,
): TemplateState {
  if (item.lifecycle === 'retired') {
    return {
      tone: 'stored',
      label: t('library.templates.notebook.stateRetired'),
      note: null,
    }
  }

  if (!published) {
    return {
      tone: 'draft',
      label: t('library.templates.notebook.stateNotPublished'),
      note: openDraft
        ? t('library.templates.notebook.noteDraftOnly', {
            version: openDraft.version,
          })
        : null,
    }
  }

  return {
    tone: 'ok',
    label: t('library.templates.notebook.statePublished', {
      version: published.version,
    }),
    note: openDraft
      ? t('library.templates.notebook.noteDraftWaiting', {
          version: openDraft.version,
        })
      : published.publishedAt
        ? t('library.templates.notebook.notePublishedOn', {
            date: formatDate(published.publishedAt),
          })
        : null,
  }
}
