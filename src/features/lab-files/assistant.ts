/** The plate-from-file card in the browser: which action is ours, and its words. */
import { defineAssistant } from '../define'
import { isLabFilesAction } from './plate'
import type { LabFilesProposeToolName, PlateFromFileAction } from './plate'

export const assistant = defineAssistant<
  PlateFromFileAction,
  LabFilesProposeToolName
>()({
  isAction: isLabFilesAction,
  async run(client, action) {
    const { createPlateFromFile } = await import('./run')

    return createPlateFromFile(client, action)
  },
  cardWords: {
    'plate.from_file': 'features.labFiles.cards.plateFromFile',
  },
})
