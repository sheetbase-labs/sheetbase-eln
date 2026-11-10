import { Link } from '@tanstack/react-router'

import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  DescriptionList,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { FieldChangeList } from '#/components/models/field-changes'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { t } from '#/copy'

import { ChangeSetTable } from './-change-set-table'
import type { ChangeGroup } from './-versions-data'
import { changesTitleOf } from './-versions-data'

/** The selected version's change set, version by version. */
export function ChangesSection({
  selected,
  compareVersion,
  firstChange,
  changeGroups,
}: {
  selected: NotebookTemplateVersion
  compareVersion: NotebookTemplateVersion | undefined
  firstChange: ChangeGroup | undefined
  changeGroups: ChangeGroup[]
}) {
  return (
    <InspectorSection
      title={changesTitleOf({ compareVersion, firstChange, selected })}
    >
      <div className="flex flex-col gap-3">
        {changeGroups.length ? (
          changeGroups.map((group) => (
            <div key={group.version.id} className="flex flex-col gap-1">
              {changeGroups.length > 1 ? (
                <h3 className="text-label font-medium">
                  v{group.version.version}
                </h3>
              ) : null}
              {group.changes.length ? (
                <FieldChangeList
                  changes={group.changes}
                  label={t('library.templates.versions.changesInVersion', {
                    version: group.version.version,
                  })}
                />
              ) : (
                <ChangeSetTable
                  entries={group.entries}
                  label={t('library.templates.versions.changesInVersion', {
                    version: group.version.version,
                  })}
                />
              )}
            </div>
          ))
        ) : (
          <Muted>
            {t('library.templates.versions.nothingChangedBetweenTheseVersions')}
          </Muted>
        )}
      </div>
    </InspectorSection>
  )
}

/** Who published or retired the selected version, and what they meant. */
export function SignaturesSection({
  selected,
  userLabel,
}: {
  selected: NotebookTemplateVersion
  userLabel: (userId: string) => string
}) {
  return (
    <InspectorSection title={t('library.templates.versions.signatures')}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
        <li>
          <span className="font-medium">
            {t('library.templates.versions.published')}
          </span>
          <span className="block text-fg-muted">
            {selected.publishedAt
              ? `${selected.publishedByUserId ? userLabel(selected.publishedByUserId) : '—'} · ${formatNotebookDateTime(selected.publishedAt, { zone: true })}`
              : t('library.templates.versions.notPublishedYet')}
          </span>
        </li>
        {selected.signedAt ? (
          <li>
            <span className="font-medium">
              {t('library.templates.versions.retiredESigned')}
            </span>
            <span className="block text-fg-muted">
              {selected.signedByUserId
                ? userLabel(selected.signedByUserId)
                : '—'}{' '}
              · {selected.signedMeaning ?? '—'} ·{' '}
              {formatNotebookDateTime(selected.signedAt, { zone: true })}
            </span>
          </li>
        ) : (
          <li className="text-fg-muted">
            {t(
              'library.templates.versions.noSignatureRecordedPublishingRecords',
            )}
          </li>
        )}
      </ul>
    </InspectorSection>
  )
}

/** How many notebooks sit on the selected version, and the way to them. */
export function RecordsSection({
  templateId,
  selected,
  selectedCounts,
}: {
  templateId: string
  selected: NotebookTemplateVersion
  selectedCounts: {
    inProgress: number
    inReview: number
    signed: number
    total: number
  }
}) {
  return (
    <InspectorSection
      title={t('library.templates.versions.recordsOnThisVersion')}
    >
      <div className="flex flex-col gap-2">
        <DescriptionList
          labelWidth={88}
          items={[
            [
              t('library.templates.versions.inProgress'),
              String(selectedCounts.inProgress),
            ],
            [
              t('library.templates.versions.inReview'),
              String(selectedCounts.inReview),
            ],
            [
              t('library.templates.versions.signed'),
              String(selectedCounts.signed),
            ],
            [
              t('library.templates.versions.total'),
              String(selectedCounts.total),
            ],
          ]}
        />
        <Link
          to="/templates/$templateId/in-use"
          params={{ templateId }}
          search={{ version: selected.id }}
          className="text-label"
        >
          {t('library.templates.versions.seeRecordsOnV', {
            version: selected.version,
          })}
        </Link>
      </div>
    </InspectorSection>
  )
}

/** The reason recorded for the version, and who signed it. */
export function GovernanceSection({
  selected,
  userLabel,
}: {
  selected: NotebookTemplateVersion
  userLabel: (userId: string) => string
}) {
  return (
    <InspectorSection title={t('library.templates.versions.governance')}>
      <DescriptionList
        labelWidth={96}
        items={[
          [t('library.templates.versions.reason'), selected.reason ?? '—'],
          [
            t('library.templates.versions.signed'),
            selected.signedAt
              ? `${selected.signedByUserId ? userLabel(selected.signedByUserId) : '—'} · ${selected.signedMeaning ?? '—'}`
              : t('library.templates.versions.notSigned'),
          ],
        ]}
      />
    </InspectorSection>
  )
}

/** The picker that compares the selected version with another. */
export function CompareSection({
  rows,
  selected,
  compare,
  onCompare,
}: {
  rows: NotebookTemplateVersion[]
  selected: NotebookTemplateVersion
  compare: string | undefined
  onCompare: (versionId: string | undefined) => void
}) {
  return (
    <InspectorSection title={t('library.templates.versions.compare')}>
      <Field label={t('library.templates.versions.compareWith')}>
        <Select
          aria-label={t('library.templates.versions.compareWithAnotherVersion')}
          value={compare ?? ''}
          onChange={(e) => onCompare(e.target.value || undefined)}
        >
          <option value="">
            {t('library.templates.versions.previousVersionOnly')}
          </option>
          {rows
            .filter((v) => v.id !== selected.id)
            .map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
        </Select>
      </Field>
    </InspectorSection>
  )
}
