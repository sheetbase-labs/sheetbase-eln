/** The file tools for the model: read an attached file further, and make a plate run from a reader export. */
import { toolDef } from '#/lib/assistant-lab-tools.server'
import {
  attachmentReadSchema,
  readAttachment,
} from '#/lib/assistant-attachments'

import { defineAssistantServer } from '../define.server'
import { ATTACHMENT_READ_TOOL } from './feature'
import { PLATE_FROM_FILE_TOOL, proposePlateFromFileSchema } from './plate'
import { buildLabFilesProposal } from './plate.server'

const READ_DESCRIPTION =
  'Read more of a file the person attached to this chat: rows of a spreadsheet (by sheet and from a row) or characters of a document (from a position). The standing instructions show only a preview of each file, so read what you need before you answer or propose a change from it. Each call returns a bounded part and says how to ask for the next.'

const PLATE_DESCRIPTION =
  'Propose making a plate run from a plate reader export the person attached (a grid of readings or a list with a well column). The card is built from the file itself, so do not type the numbers. Read the sheet first to find where the plate starts, which controls and blanks the person named, and which format it is. Nothing is made until the person presses the button.'

export const assistantServer = defineAssistantServer({
  readDefs: () => [
    toolDef(ATTACHMENT_READ_TOOL, READ_DESCRIPTION, attachmentReadSchema),
  ],
  isReadTool: (name) => name === ATTACHMENT_READ_TOOL,
  runReadTool: (_name, args, context) => {
    const parsed = attachmentReadSchema.safeParse(args)

    return Promise.resolve(
      parsed.success
        ? readAttachment(context.attachments ?? [], parsed.data)
        : {
            text: `The arguments were not valid: ${parsed.error.issues
              .map((i) => `${i.path.join('.') || 'arguments'} ${i.message}`)
              .join('; ')}`,
            isError: true,
          },
    )
  },
  proposalDefs: () => [
    toolDef(
      PLATE_FROM_FILE_TOOL,
      PLATE_DESCRIPTION,
      proposePlateFromFileSchema,
    ),
  ],
  isProposalTool: (name) => name === PLATE_FROM_FILE_TOOL,
  buildProposal: (name, args, context) =>
    buildLabFilesProposal(name, args, context),
})
