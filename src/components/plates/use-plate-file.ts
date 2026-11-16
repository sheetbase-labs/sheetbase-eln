/**
 * The file a person dropped: what was found in it and which plate they chose.
 * A file dropped before the dialog opened is read once, on mount.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { t } from '#/copy'
import { readPlateFile } from '#/lib/plate-file'
import type { PlateFileRead } from '#/lib/plate-file'
import { messageOf } from '#/lib/plate-runs'

/** The file's name without its extension, as a first guess at the run's name. */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

export function usePlateFile({
  initialFile,
  onText,
  onName,
}: {
  initialFile: File | null
  /** The text of the chosen plate. */
  onText: (text: string) => void
  /** A first guess at the run's name, from the file. */
  onName: (name: string) => void
}) {
  const [file, setFile] = useState<PlateFileRead | null>(null)
  const [candidateId, setCandidateId] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)

  function takeCandidate(read: PlateFileRead, id: string) {
    const candidate = read.candidates.find((c) => c.id === id)

    if (!candidate) return
    setCandidateId(id)
    onText(candidate.text)
  }

  async function readFile(picked: File | null) {
    setFileError(null)

    if (!picked) return

    try {
      const read = await readPlateFile(picked)

      setFile(read)

      if (read.candidates.length === 0) {
        setFileError(t('features.plateRuns.form.noPlateInFile'))

        return
      }

      takeCandidate(read, read.candidates[0].id)
      onName(nameFromFile(read.fileName))
    } catch (error) {
      setFile(null)
      setFileError(messageOf(error, t('features.plateRuns.form.unreadable')))
    }
  }

  const startFile = useRef(initialFile)

  const readStart = useEffectEvent(() => {
    if (startFile.current) void readFile(startFile.current)
  })

  useEffect(() => {
    readStart()
  }, [])

  return { file, candidateId, fileError, takeCandidate, readFile }
}
