import { Button } from '#/components/ui/button'
import { Inspector, Muted } from '#/components/ui/layout'
import { templateLifecycle } from '#/components/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { t } from '#/copy'

import {
  ChangesSection,
  CompareSection,
  GovernanceSection,
  RecordsSection,
  SignaturesSection,
} from './-version-detail-sections'
import type { ChangeGroup } from './-versions-data'

/**
 * The Versions tab's inspector: the selected version's lifecycle, the publish
 * and retire actions, its change set, signatures, records on it, governance
 * and the comparison picker.
 */
export function VersionInspector({
  templateId,
  selected,
  currentId,
  rows,
  selectedCounts,
  compareVersion,
  firstChange,
  changeGroups,
  denied,
  staleSelected,
  compare,
  userLabel,
  onPublish,
  onRetire,
  onCompare,
}: {
  templateId: string
  selected: NotebookTemplateVersion
  /** The version new notebooks start from, if there is one. */
  currentId: string | undefined
  /** Every version, for the comparison picker. */
  rows: NotebookTemplateVersion[]
  selectedCounts: {
    inProgress: number
    inReview: number
    signed: number
    total: number
  }
  compareVersion: NotebookTemplateVersion | undefined
  firstChange: ChangeGroup | undefined
  changeGroups: ChangeGroup[]
  denied: boolean
  staleSelected: boolean
  compare: string | undefined
  userLabel: (userId: string) => string
  onPublish: () => void
  onRetire: () => void
  onCompare: (versionId: string | undefined) => void
}) {
  return (
    <Inspector
      label={t('library.templates.versions.versionDetails', {
        version: selected.version,
      })}
      width={320}
    >
      <VersionHeading selected={selected} />
      <VersionActions
        selected={selected}
        currentId={currentId}
        denied={denied}
        staleSelected={staleSelected}
        onPublish={onPublish}
        onRetire={onRetire}
      />
      <ChangesSection
        selected={selected}
        compareVersion={compareVersion}
        firstChange={firstChange}
        changeGroups={changeGroups}
      />
      <SignaturesSection selected={selected} userLabel={userLabel} />
      <RecordsSection
        templateId={templateId}
        selected={selected}
        selectedCounts={selectedCounts}
      />
      <GovernanceSection selected={selected} userLabel={userLabel} />
      <CompareSection
        rows={rows}
        selected={selected}
        compare={compare}
        onCompare={onCompare}
      />
    </Inspector>
  )
}

function VersionHeading({ selected }: { selected: NotebookTemplateVersion }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-fg-muted">
        {t('library.templates.versions.vSections', {
          version: selected.version,
          placements: selected.configuration.placements.length,
        })}
      </span>
      <div className="font-heading text-doc font-semibold">
        {templateLifecycle(selected.lifecycle).label}
      </div>
    </div>
  )
}

/**
 * Publish a draft, retire a published version that is no longer current, and
 * say why the current version cannot be retired.
 */
function VersionActions({
  selected,
  currentId,
  denied,
  staleSelected,
  onPublish,
  onRetire,
}: {
  selected: NotebookTemplateVersion
  currentId: string | undefined
  denied: boolean
  staleSelected: boolean
  onPublish: () => void
  onRetire: () => void
}) {
  const isDraft = selected.lifecycle === 'draft'
  const isPublished = selected.lifecycle === 'published'
  const isCurrent = currentId === selected.id

  return (
    <>
      {!denied && isDraft ? (
        <Button
          variant="primary"
          disabled={staleSelected}
          title={
            staleSelected
              ? t('library.templates.versions.reloadTheDraftBeforeYou')
              : undefined
          }
          onClick={onPublish}
        >
          {t('library.templates.versions.publishV', {
            version: selected.version,
          })}
        </Button>
      ) : null}
      {staleSelected ? (
        <Muted>{t('library.templates.versions.reloadTheDraftBeforeYou')}</Muted>
      ) : null}
      {!denied && isPublished && !isCurrent ? (
        <Button variant="danger" onClick={onRetire}>
          {t('library.templates.versions.retireV', {
            version: selected.version,
          })}
        </Button>
      ) : null}
      {!denied && isPublished && isCurrent ? (
        <Muted>{t('library.templates.versions.theCurrentVersionCantBe')}</Muted>
      ) : null}
    </>
  )
}
