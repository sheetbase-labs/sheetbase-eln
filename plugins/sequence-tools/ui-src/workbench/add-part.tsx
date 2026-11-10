import { useState } from 'react'

import { Field, Select } from '../ui/kit'
import { t } from '#/copy'
import { siblingSequences } from '#/lib/host'
import { useAsync } from '#/lib/use-async'
import type { PlanPart } from '#/lib/sequence-block'
import {
  BlockPartForm,
  FilePartForm,
  PastedPartForm,
  PcrPartForm,
  RegionPartForm,
  WholePartButton,
} from './add-part-forms'
import type { WorkbenchProps } from './shared'

/**
 * Put a part into the plan. This owns the choice of how the part is supplied —
 * this whole sequence, a region of it, a primer product, another block, pasted
 * bases, or a file — and the forms themselves are `add-part-forms.tsx`.
 *
 * The notebook's other sequences are read here rather than in the block form so
 * that the list is already on screen when that option is picked; the read is
 * keyed on the block, so it happens once.
 */
export function AddPart({
  draft,
  context,
  blockId,
  addPart,
}: WorkbenchProps & { addPart: (p: PlanPart) => void }) {
  const [source, setSource] = useState('')
  const loadSiblings = () => siblingSequences(context)
  const siblings = useAsync(loadSiblings, context.blockId ?? '')
  const primers = draft.primers ?? []

  const names = {
    whole: t('molbio.cloning.add.whole'),
    region: t('molbio.cloning.add.region'),
    pcr: t('molbio.cloning.add.pcr'),
    block: t('molbio.cloning.add.block'),
    paste: t('molbio.cloning.add.paste'),
    file: t('molbio.cloning.add.file'),
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('molbio.cloning.add.label')} className="w-64">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('molbio.cloning.add.choose')}</option>
            {draft.residues ? (
              <option value="whole">{names.whole}</option>
            ) : null}
            {draft.residues ? (
              <option value="region">{names.region}</option>
            ) : null}
            {primers.length >= 2 ? (
              <option value="pcr">{names.pcr}</option>
            ) : null}
            <option value="block">{names.block}</option>
            <option value="paste">{names.paste}</option>
            <option value="file">{names.file}</option>
          </Select>
        </Field>
        {source === 'whole' ? (
          <WholePartButton draft={draft} blockId={blockId} addPart={addPart} />
        ) : null}
        {source === 'region' ? (
          <RegionPartForm draft={draft} blockId={blockId} addPart={addPart} />
        ) : null}
        {source === 'pcr' ? (
          <PcrPartForm draft={draft} blockId={blockId} addPart={addPart} />
        ) : null}
        {source === 'block' ? (
          <BlockPartForm siblings={siblings} addPart={addPart} />
        ) : null}
        {source === 'file' ? <FilePartForm addPart={addPart} /> : null}
      </div>
      {source === 'paste' ? <PastedPartForm addPart={addPart} /> : null}
    </div>
  )
}
