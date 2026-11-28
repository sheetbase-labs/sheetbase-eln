import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { UseTemplateDialog } from '#/components/templates/use-template-dialog'
import {
  latestTemplateVersion,
  publishedTemplateVersion,
  templateDataQueryKeys,
} from '#/components/templates/templates-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { formatDate } from '#/lib/notebook-data'
import { GovernanceDialog } from './$templateId/-governance-dialog'
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

/**
 * The template detail header: the template's status and current version in the
 * middle, and the open-draft and use-template actions on the right, with the
 * Sections, Versions and In use tabs underneath.
 */
export function TemplatePageHeader({
  item,
  versions,
  versionCount,
  inUseCount,
  ownerLabel,
  onVersions,
  canPublish,
}: {
  item: NotebookTemplate
  versions: NotebookTemplateVersion[]
  versionCount: number | undefined
  inUseCount: number | undefined
  /** Resolves the owner's display name; the page keeps that read where it was. */
  ownerLabel: (userId: string) => string
  /** The reader is on the Versions tab, so the draft action shows there. */
  onVersions: boolean
  /** The reader may publish a version. */
  canPublish: boolean
}) {
  const params = { templateId: item.id }
  const queryClient = useQueryClient()
  const [publishing, setPublishing] = useState(false)
  const latest = latestTemplateVersion(versions)
  const published = publishedTemplateVersion(versions)
  const openDraft = latest?.lifecycle === 'draft' ? latest : null
  const state = templateState(item, published, openDraft)

  return (
    <PageHeader
      trail={[
        {
          label: t('library.templates.detail.templates'),
          link: { to: '/templates' },
        },
        ...(item.displayId ? [{ label: item.displayId }] : []),
      ]}
      title={item.name}
      actions={
        <div className="flex items-center gap-2">
          {openDraft && onVersions ? (
            <Button
              icon="edit"
              nativeButton={false}
              render={<Link to="/templates/$templateId" params={params} />}
            >
              {t('library.templates.detail.openDraftV', {
                version: openDraft.version,
              })}
            </Button>
          ) : null}
          {openDraft && canPublish && item.lifecycle === 'active' ? (
            <Button onClick={() => setPublishing(true)}>
              {t('library.templates.templateSectionsBoard.publishV', {
                version: openDraft.version,
              })}
            </Button>
          ) : null}
          <UseTemplateDialog
            templateName={item.name}
            version={published ?? null}
            variant={openDraft && canPublish ? 'secondary' : 'primary'}
          />
          {publishing && openDraft ? (
            <GovernanceDialog
              kind="publish"
              version={openDraft}
              onClose={() => setPublishing(false)}
              onDone={() => {
                setPublishing(false)
                void queryClient.invalidateQueries({
                  queryKey: templateDataQueryKeys.versions(item.id),
                })
                void queryClient.invalidateQueries({
                  queryKey: templateDataQueryKeys.template(item.id),
                })
              }}
              onStale={() => {
                setPublishing(false)
                toast.error(t('library.templates.notebook.publishStale'))
                void queryClient.invalidateQueries({
                  queryKey: templateDataQueryKeys.versions(item.id),
                })
              }}
            />
          ) : null}
        </div>
      }
      meta={
        <>
          <span className="text-fg">
            <Status tone={state.tone}>{state.label}</Status>
          </span>
          {state.note ? <span>{state.note}</span> : null}
          {item.createdByUserId ? (
            <span className="max-lg:hidden">
              {t('library.templates.detail.owner', {
                owner: ownerLabel(item.createdByUserId),
              })}
            </span>
          ) : null}
        </>
      }
      tabs={
        <Tabs
          mode="url"
          label={t('library.templates.detail.templateSections')}
          items={[
            {
              label: t('library.templates.notebook.tab'),
              link: {
                to: '/templates/$templateId',
                params,
                activeOptions: { exact: true },
              },
            },
            {
              label: t('library.templates.detail.versions'),
              count: versionCount,
              link: { to: '/templates/$templateId/versions', params },
            },
            {
              label: t('library.templates.detail.inUse'),
              count: inUseCount,
              link: { to: '/templates/$templateId/in-use', params },
            },
          ]}
        />
      }
    />
  )
}
