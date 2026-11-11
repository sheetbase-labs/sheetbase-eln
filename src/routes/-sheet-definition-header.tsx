/**
 * The sheet definition page's header: what the definition is, the version
 * being read, and the publish action when this version can become immutable.
 */
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { PageHeader } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import type { SheetDefinitionVersion } from '#/lib/sheet-definition-data'
import { t } from '#/copy'

export function SheetDefinitionHeader({
  name,
  returnTo,
  version,
  versions,
  definitionLifecycle,
  failed,
  canPublish,
  onPickVersion,
  onPublish,
}: {
  name: string
  returnTo: string | undefined
  version: SheetDefinitionVersion | undefined
  versions: readonly SheetDefinitionVersion[] | undefined
  definitionLifecycle: string | undefined
  failed: boolean
  canPublish: boolean
  onPickVersion: (versionId: string) => void
  onPublish: () => void
}) {
  return (
    <PageHeader
      title={name}
      trail={
        returnTo
          ? [
              {
                label: (
                  <Link to={returnTo} className="text-link">
                    {t('notebook.sheetDefinitionPage.backToSourceSheet')}
                  </Link>
                ),
              },
              { label: t('notebook.sheetDefinitionPage.title') },
            ]
          : undefined
      }
      meta={
        version && !failed ? (
          <>
            <label className="flex items-center gap-2">
              {t('notebook.sheetDefinitionPage.version')}
              <Select
                size="sm"
                className="w-44"
                value={version.id}
                onChange={(event) => onPickVersion(event.target.value)}
              >
                {versions?.map((item) => (
                  <option key={item.id} value={item.id}>
                    v{item.version} · {item.lifecycle}
                  </option>
                ))}
              </Select>
            </label>
            <span>
              {t('notebook.sheetDefinitionPage.definitionLifecycle', {
                lifecycle: definitionLifecycle ?? '',
              })}
            </span>
          </>
        ) : null
      }
      actions={
        !failed && version?.lifecycle === 'draft' && canPublish ? (
          <Button variant="primary" onClick={onPublish}>
            {t('notebook.sheetDefinitionPage.publishVersionVersion', {
              version: version.version,
            })}
          </Button>
        ) : null
      }
    />
  )
}
