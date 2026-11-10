import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { Status } from '#/components/ui/status'
import { UseTemplateDialog } from '#/components/templates/use-template-dialog'
import {
  latestTemplateVersion,
  publishedTemplateVersion,
  templateLifecycle,
} from '#/components/templates/templates-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import { formatDate } from '#/lib/notebook-data'
import { t } from '#/copy'

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
}: {
  item: NotebookTemplate
  versions: NotebookTemplateVersion[]
  versionCount: number | undefined
  inUseCount: number | undefined
  /** Resolves the owner's display name; the page keeps that read where it was. */
  ownerLabel: (userId: string) => string
  /** The reader is on the Versions tab, so the draft action shows there. */
  onVersions: boolean
}) {
  const params = { templateId: item.id }
  const lifecycle = templateLifecycle(item.lifecycle)
  const latest = latestTemplateVersion(versions)
  // The Sections view opens the newest version (an open draft, else the
  // current published one), so the badge counts that version's placements.
  const shown = latest
  const published = publishedTemplateVersion(versions)
  const openDraft = latest?.lifecycle === 'draft' ? latest : null

  return (
    <PageHeader
      trail={[
        {
          label: t('library.templates.detail.templates'),
          link: { to: '/templates' },
        },
        { label: item.displayId ?? item.key, mono: true },
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
          <UseTemplateDialog
            templateName={item.name}
            version={published ?? null}
          />
        </div>
      }
      meta={
        <>
          <span className="text-fg">
            <Status tone={lifecycle.tone}>{lifecycle.label}</Status>
          </span>
          <span>{t('library.templates.detail.notebookTemplate')}</span>
          {published ? (
            <span className="text-fg">
              <Status tone="progress">
                {t('library.templates.detail.currentV', {
                  version: published.version,
                })}
              </Status>
            </span>
          ) : null}
          {openDraft ? (
            <span className="text-fg">
              <Status tone="draft">
                {t('library.templates.detail.draftV', {
                  version: openDraft.version,
                })}
              </Status>
            </span>
          ) : null}
          <span className="max-lg:hidden">
            {published?.publishedAt
              ? t('library.templates.detail.publishedV', {
                  version: published.version,
                  publishedAt: formatDate(published.publishedAt),
                })
              : null}
          </span>
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
              label: t('library.templates.detail.sections'),
              count: shown?.configuration.placements.length,
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
