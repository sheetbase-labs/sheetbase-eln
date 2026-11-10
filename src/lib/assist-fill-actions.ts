import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { FILL_PDF_MAX_BYTES } from './assist-fill'
import { resolveAssistantRuntime } from './assistant-actions'

/**
 * Read the text of a PDF the person chose, for filling a form. Same session
 * and readiness rules as the other in-page AI calls: with AI off it does
 * nothing. The file is read in memory and not stored.
 */
export const readPdfTextFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .strictObject({
        workspaceId: z.string().uuid(),
        dataBase64: z.string().max(Math.ceil((FILL_PDF_MAX_BYTES * 4) / 3) + 8),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ status: 'ok'; text: string } | { status: 'error' }> => {
      const runtime = await resolveAssistantRuntime(data.workspaceId)

      if (!runtime.ok) return { status: 'error' }

      try {
        const { extractPdfText } = await import('./file-text')
        const bytes = Uint8Array.from(Buffer.from(data.dataBase64, 'base64'))
        const text = await extractPdfText(bytes)

        return text.trim() ? { status: 'ok', text } : { status: 'error' }
      } catch {
        return { status: 'error' }
      }
    },
  )
