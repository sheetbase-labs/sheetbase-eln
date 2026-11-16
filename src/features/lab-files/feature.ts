/**
 * Lab files in the assistant chat: a person drops a plate reader export, a
 * gel photo or a vendor PDF into the chat and the assistant works from it.
 *
 * The reading itself is chat input, not a record: it is made once by
 * `/api/assistant/attachments`, kept by the browser with the chat and never
 * stored (`src/lib/assistant-attachments.ts`). What this folder adds is the
 * tool the model reads a file further with, and the card that turns a plate
 * reader export into a plate run. Samples, reagent lots and the rest go
 * through the cards that already exist.
 */
import { defineFeature } from '../define'

export const ATTACHMENT_READ_TOOL = 'sheetbase.attachment.read'

export const feature = defineFeature({
  name: 'lab-files',
  assistantReadTools: [ATTACHMENT_READ_TOOL],
})
