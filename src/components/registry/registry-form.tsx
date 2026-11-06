/**
 * The registry parts of a record's "new" form: the duplicate warning shown
 * under the name, and the sequence file reader that fingerprints a sequence so
 * a repeat is caught however it was written down.
 */
import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Notice } from '#/components/ui/alert'
import { t } from '#/copy'
import { messageOf, readSequence } from '#/lib/bio-registry'
import type { DuplicateMatch } from '#/lib/bio-registry'
import type { StructureMatch } from '#/lib/compound-registry'
import { SEQUENCE_ACCEPT, parseSequenceFile } from '#/lib/sequence'

export function DuplicateNotice({
  modelKey,
  matches,
  acknowledged,
  onAcknowledge,
}: {
  modelKey: string
  matches: DuplicateMatch[]
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
}) {
  const exact = matches.filter((m) => m.match === 'exact')
  const listed = exact.length > 0 ? exact : matches
  const entries = listed
    .map(
      (m) =>
        `${m.identifier} ${m.title}${m.archived ? t('registry.duplicate.retiredNote') : ''}`,
    )
    .join(', ')
  return (
    <Notice
      tone="warn"
      title={
        exact.length > 0
          ? t('registry.duplicate.exactTitle')
          : t('registry.duplicate.nameTitle')
      }
    >
      <div className="flex flex-col gap-2">
        <p className="m-0">
          {exact.length > 0
            ? t('registry.duplicate.exactBody', { entries })
            : t('registry.duplicate.nameBody', { entries })}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {listed.map((m) => (
            <Link
              key={m.id}
              to="/models/$modelId/records/$recordId"
              params={{ modelId: modelKey, recordId: m.id }}
              className="text-link underline-offset-2 hover:underline"
            >
              {t('registry.duplicate.use', { number: m.identifier })}
            </Link>
          ))}
        </div>
        <label className="flex items-start gap-2 text-label">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => onAcknowledge(checked === true)}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">
              {t('registry.duplicate.registerAnyway')}
            </span>
            <span className="text-fg-muted">
              {t('registry.duplicate.anywayHint')}
            </span>
          </span>
        </label>
      </div>
    </Notice>
  )
}

export interface ReadSequence {
  name: string
  fingerprint: string
  length: number
  shape: string
  molecule: 'dna' | 'rna' | 'protein'
}

export function SequenceReader({
  value,
  onChange,
  disabled,
}: {
  value: ReadSequence | null
  onChange: (value: ReadSequence | null) => void
  disabled?: boolean
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    setReading(true)
    setError(null)
    try {
      const parsed = parseSequenceFile(await file.text())
      if (parsed.length === 0) throw new Error('')
      const first = parsed[0]
      const info = await readSequence(first)
      onChange({
        name: first.name,
        fingerprint: info.fingerprint,
        length: info.length,
        shape: info.topology === 'circular' ? 'circular' : 'linear',
        molecule: info.molecule,
      })
      if (parsed.length > 1) {
        setError(t('registry.form.sequenceOnlyFirst', { count: parsed.length }))
      }
    } catch (e) {
      onChange(null)
      setError(t('registry.form.sequenceError', { message: messageOf(e, '') }))
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1 md:col-span-2">
      <span className="text-xs text-fg-muted">
        {t('registry.form.sequence')}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={SEQUENCE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <Button
          type="button"
          disabled={disabled || reading}
          onClick={() => fileInput.current?.click()}
        >
          {value
            ? t('registry.form.changeSequence')
            : t('registry.form.chooseSequence')}
        </Button>
        {value ? (
          <>
            <span className="text-label text-fg-muted">
              {t('registry.form.sequenceSummary', {
                name: value.name,
                length: t(`sequences.summary.length.${value.molecule}`, {
                  count: value.length,
                }),
                shape: t(`sequences.summary.${value.shape as 'circular'}`),
              })}
            </span>
            <Button
              type="button"
              variant="quiet"
              onClick={() => onChange(null)}
            >
              {t('registry.form.removeSequence')}
            </Button>
          </>
        ) : null}
      </span>
      <span className="text-label text-fg-muted">
        {t('registry.form.sequenceHint')}
      </span>
      {error ? (
        <span role="alert" className="text-label text-danger-text">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Shown when the parent structure is already registered. The same drawing is a
 * repeat; a different salt or solvent of it is a lot of the compound, so the
 * person can add it as one when the registry takes lots.
 */
export function StructureDuplicateNotice({
  modelKey,
  matches,
  canAddLot,
  addingLot,
  onAddLot,
  acknowledged,
  onAcknowledge,
}: {
  modelKey: string
  matches: StructureMatch[]
  canAddLot: boolean
  addingLot: boolean
  onAddLot: (match: StructureMatch) => void
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
}) {
  const same = matches.filter((m) => m.sameForm)
  const listed = same.length > 0 ? same : matches
  const entries = listed
    .map(
      (m) =>
        `${m.identifier} ${m.title}${m.archived ? t('registry.duplicate.retiredNote') : ''}`,
    )
    .join(', ')
  const first = listed[0]
  return (
    <Notice
      tone="warn"
      title={
        same.length > 0
          ? t('registry.chemistry.duplicate.sameTitle')
          : t('registry.chemistry.duplicate.formTitle')
      }
    >
      <div className="flex flex-col gap-2">
        <p className="m-0">
          {same.length > 0
            ? t('registry.chemistry.duplicate.sameBody', { entries })
            : t('registry.chemistry.duplicate.formBody', { entries })}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {listed.map((m) => (
            <Link
              key={m.id}
              to="/models/$modelId/records/$recordId"
              params={{ modelId: modelKey, recordId: m.id }}
              className="text-link underline-offset-2 hover:underline"
            >
              {t('registry.duplicate.use', { number: m.identifier })}
            </Link>
          ))}
          {canAddLot ? (
            <Button
              type="button"
              size="sm"
              disabled={addingLot}
              onClick={() => onAddLot(first)}
            >
              {t('registry.chemistry.duplicate.addLot', {
                number: first.identifier,
              })}
            </Button>
          ) : null}
        </div>
        <label className="flex items-start gap-2 text-label">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => onAcknowledge(checked === true)}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium">
              {t('registry.duplicate.registerAnyway')}
            </span>
            <span className="text-fg-muted">
              {t('registry.duplicate.anywayHint')}
            </span>
          </span>
        </label>
      </div>
    </Notice>
  )
}
