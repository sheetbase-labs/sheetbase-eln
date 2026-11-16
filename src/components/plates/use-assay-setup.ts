/**
 * Which design a new plate follows and what that gives it. An experiment that
 * already has plates starts on the design its last plate followed, so the next
 * plate needs nothing chosen.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import {
  assayDesignKeys,
  fetchAssayDesigns,
  resolveAssayChoice,
} from '#/lib/plate-assay-setup'
import { fetchPlateRunsForRecord, plateRunKeys } from '#/lib/plate-runs'

const client = notebookDataClient

interface ControlGuess {
  negative: string
  positive: string
}

export function useAssaySetupChoice({
  enabled,
  experimentId,
}: {
  enabled: boolean
  experimentId: string
}) {
  const designs =
    useQuery({
      queryKey: assayDesignKeys.all,
      queryFn: () => fetchAssayDesigns(client),
      staleTime: 30_000,
      enabled,
    }).data ?? []

  const earlier = useQuery({
    queryKey: plateRunKeys.forRecord(experimentId),
    queryFn: () => fetchPlateRunsForRecord(client, experimentId),
    staleTime: 10_000,
    enabled: enabled && experimentId !== '',
  }).data

  const [chosen, setChosen] = useState<string | null>(null)
  const [negativeEdit, setNegativeEdit] = useState<string | null>(null)
  const [positiveEdit, setPositiveEdit] = useState<string | null>(null)
  const [rememberChoice, setRememberChoice] = useState<boolean | null>(null)
  const [newName, setNewName] = useState('')
  const [guess, setGuess] = useState<ControlGuess | null>(null)

  const resolved = resolveAssayChoice({
    designs,
    chosen,
    lastDesignId:
      earlier?.find((run) => run.design_id !== null)?.design_id ?? '',
    negativeEdit,
    positiveEdit,
    rememberChoice,
    newName,
    guess,
  })

  return {
    ...resolved,
    designs,
    newName,
    /** Choosing a design brings its controls; edits made for another design are dropped. */
    onDesign: (id: string) => {
      setChosen(id)
      setNegativeEdit(null)
      setPositiveEdit(null)
      setRememberChoice(null)
    },
    onNegative: setNegativeEdit,
    onPositive: setPositiveEdit,
    /** A new file was read: its guessed controls replace what was typed for the last one. */
    onGuess: (next: ControlGuess | null) => {
      setGuess(next)
      setNegativeEdit(null)
      setPositiveEdit(null)
    },
    onRememberOnDesign: setRememberChoice,
    onNewName: setNewName,
  }
}

export type AssaySetupChoice = ReturnType<typeof useAssaySetupChoice>
