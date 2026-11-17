/**
 * Reading the plate reader's file for a new run: its text fills the plate, its
 * name guesses the run's name, and its grid offers the control columns.
 */
import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { parsePlateTable } from '#/lib/plate-assay'
import { suggestControlColumns } from '#/lib/plate-controls'
import type { PlateFormat } from '#/lib/plate-map'

import { usePlateFile } from './use-plate-file'

export function useRunFile(input: {
  initialFile: File | null
  setData: (text: string) => void
  setFormatChoice: Dispatch<SetStateAction<'auto' | PlateFormat>>
  setName: Dispatch<SetStateAction<string>>
  onGuess: (guess: ReturnType<typeof suggestControlColumns>) => void
}) {
  const guessedName = useRef('')
  const { initialFile, setData, setFormatChoice, setName, onGuess } = input

  return usePlateFile({
    initialFile,
    onText: (text) => {
      setData(text)
      setFormatChoice('auto')

      // A reader's grid has no roles: offer the first and last columns as the
      // controls when they read like two groups far apart.
      onGuess(suggestControlColumns(parsePlateTable(text).readout))
    },
    onName: (guess) => {
      // Keep a name the person typed; follow the file while it is a guess.
      const previous = guessedName.current

      guessedName.current = guess
      setName((current) =>
        current === '' || current === previous ? guess : current,
      )
    },
  })
}
