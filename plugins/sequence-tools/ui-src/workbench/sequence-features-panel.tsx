import { useState } from 'react'

import { Button, IconButton, Input, Select, toast } from '../ui/kit'
import { t } from '#/copy'
import { addFeature, autoAnnotate, removeFeature } from '#/lib/molbio'
import type { SequenceFeature } from '#/lib/sequence'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { featureColour, formatBases } from '../geometry'
import { editable, merge } from './edit-model'
import { DataTable, Panel } from './shared'
import type { WorkbenchProps } from './shared'
import type { SequenceSelection } from './sequence-bases-panel'

const FEATURE_TYPES = [
  'CDS',
  'promoter',
  'terminator',
  'rep_origin',
  'primer_bind',
  'misc_feature',
  'misc_recomb',
  'protein_bind',
  'regulatory',
] as const

/**
 * The features on the sequence: name one over the current selection, let the
 * app find the obvious ones, and remove the ones that are wrong. The table is
 * the same list the viewer draws, in position order.
 */
export function SequenceFeaturesPanel({
  draft,
  edit,
  canEdit,
  selection,
}: {
  draft: SequenceBlockPayload
  edit: WorkbenchProps['edit']
  canEdit: boolean
  selection: SequenceSelection
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<string>('misc_feature')
  const [strand, setStrand] = useState<'1' | '-1'>('1')
  const isProtein = draft.molecule === 'protein'
  const hasSel = selection.end > selection.start

  return (
    <Panel
      title={t('molbio.edit.features', { count: draft.features.length })}
      actions={
        canEdit && !isProtein ? (
          <Button
            size="sm"
            icon="spark"
            onClick={() => {
              const found = autoAnnotate(
                draft.residues.toUpperCase(),
                draft.topology,
                draft.features,
              )

              if (found.length === 0) {
                toast(t('molbio.edit.nothingFound'))

                return
              }

              edit((d) => {
                let s = editable(d)

                for (const f of found) s = addFeature(s, f)

                return merge(d, s)
              })
              toast(t('molbio.edit.annotated', { count: found.length }))
            }}
          >
            {t('molbio.edit.annotate')}
          </Button>
        ) : null
      }
    >
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            aria-label={t('molbio.edit.featureName')}
            placeholder={t('molbio.edit.featureName')}
            className="w-44"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select
            size="sm"
            aria-label={t('molbio.edit.featureType')}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {FEATURE_TYPES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={t('molbio.edit.featureStrand')}
            value={strand}
            onChange={(e) => {
              const value = e.target.value

              if (value === '1' || value === '-1') setStrand(value)
            }}
          >
            <option value="1">{t('sequences.viewer.strandForward')}</option>
            <option value="-1">{t('sequences.viewer.strandReverse')}</option>
          </Select>
          <Button
            disabled={!hasSel || label.trim() === ''}
            onClick={() => {
              const f: Omit<SequenceFeature, 'id' | 'parts'> = {
                type,
                label: label.trim(),
                strand: strand === '1' ? 1 : -1,
                start: selection.start + 1,
                end: selection.end,
                qualifiers: {},
              }

              edit((d) => merge(d, addFeature(editable(d), f)))
              setLabel('')
            }}
          >
            {t('molbio.edit.addFeature')}
          </Button>
        </div>
      ) : null}
      <DataTable
        caption={t('molbio.edit.featuresCaption')}
        rows={[...draft.features].sort((a, b) => a.start - b.start)}
        rowKey={(f) => String(f.id)}
        empty={t('sequences.viewer.noFeatures')}
        columns={[
          {
            key: 'name',
            head: t('sequences.viewer.columns.name'),
            cell: (f) => (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ background: featureColour(f.type) }}
                />
                {f.label}
              </span>
            ),
          },
          {
            key: 'type',
            head: t('sequences.viewer.columns.type'),
            cell: (f) => f.type,
          },
          {
            key: 'pos',
            head: t('sequences.viewer.columns.position'),
            cell: (f) => `${formatBases(f.start)}..${formatBases(f.end)}`,
          },
          {
            key: 'strand',
            head: t('sequences.viewer.columns.strand'),
            cell: (f) =>
              f.strand === 1
                ? t('sequences.viewer.strandForward')
                : t('sequences.viewer.strandReverse'),
          },
          ...(canEdit
            ? [
                {
                  key: 'remove',
                  head: '',
                  align: 'right' as const,
                  cell: (f: SequenceFeature) => (
                    <IconButton
                      label={t('molbio.edit.removeFeature')}
                      icon="x"
                      onClick={() =>
                        edit((d) => merge(d, removeFeature(editable(d), f.id)))
                      }
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </Panel>
  )
}
