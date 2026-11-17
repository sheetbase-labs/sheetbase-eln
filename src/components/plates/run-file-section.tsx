/**
 * The top of the new-run dialog: drop the reader's file, and say which plate
 * of it to take when it holds more than one.
 */
import { Notice } from '#/components/ui/alert'
import { FileDrop } from '#/components/ui/file-drop'
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'

import type { PlateFileRead } from '#/lib/plate-file'

export function RunFileSection({
  file,
  candidateId,
  fileError,
  onFile,
  onCandidate,
}: {
  file: PlateFileRead | null
  candidateId: string
  fileError: string | null
  onFile: (file: File | null) => void | Promise<void>
  onCandidate: (file: PlateFileRead, id: string) => void
}) {
  return (
    <>
      <FileDrop
        label={t('features.plateRuns.form.drop')}
        hint={t('features.plateRuns.form.dropHint')}
        accept=".csv,.tsv,.txt,.xlsx"
        onFile={onFile}
      />
      {fileError ? <Notice tone="warn">{fileError}</Notice> : null}
      {file && file.candidates.length > 1 ? (
        <Field label={t('features.plateRuns.form.whichPlate')}>
          <Select
            value={candidateId}
            onChange={(e) => onCandidate(file, e.target.value)}
          >
            {file.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t('features.plateRuns.form.candidate', {
                  label: candidate.title ?? candidate.label,
                  readings: candidate.readings,
                })}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </>
  )
}
