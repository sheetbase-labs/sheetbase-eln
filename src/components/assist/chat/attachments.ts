import { useCallback, useSyncExternalStore } from 'react'
import { z } from 'zod'

import { t } from '#/copy'
import {
  ATTACHMENT_ENDPOINT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  chatAttachmentSchema,
} from '#/lib/assistant-attachments'
import type { ChatAttachment } from '#/lib/assistant-attachments'

/**
 * The files in an assistant chat, kept in the browser by chat. A file is read
 * once on the server (`/api/assistant/attachments`) and the reading rides
 * along with each question, so a follow-up still sees it. Closing the panel
 * does not lose them; "New chat" does.
 */

export interface ChatFilesState {
  /** Every file in the chat, in the order attached. */
  files: ChatAttachment[]
  /** Files attached since the last question went out. */
  unsent: string[]
  /** Names being read right now. */
  reading: string[]
  /** The last thing that went wrong, for a line under the box. */
  error: string | null
}

const EMPTY: ChatFilesState = {
  files: [],
  unsent: [],
  reading: [],
  error: null,
}

const states = new Map<string, ChatFilesState>()
const listeners = new Set<() => void>()

function get(key: string): ChatFilesState {
  return states.get(key) ?? EMPTY
}

function set(key: string, next: Partial<ChatFilesState>) {
  states.set(key, { ...get(key), ...next })

  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** The longest side of a picture sent to the model, in pixels. */
const IMAGE_MAX_SIDE = 1568

/**
 * Shrinks a picture before it is sent: a phone photo is several megabytes and
 * the model reads no more detail than this. Falls back to the original when
 * the browser cannot decode it.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!/^image\/(?:png|jpeg|webp)$/.test(file.type)) return file

  try {
    const bitmap = await createImageBitmap(file)

    const scale = Math.min(
      1,
      IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
    )

    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close()

      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')

    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88),
    )

    return blob
      ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
          type: 'image/jpeg',
        })
      : file
  } catch {
    return file
  }
}

/** What the upload route answers. */
const answerSchema = z.object({
  message: z.string().optional(),
  attachment: z.unknown().optional(),
})

async function readOne(
  workspaceId: string,
  file: File,
): Promise<ChatAttachment> {
  const prepared = await prepareImage(file)
  const form = new FormData()
  form.set('workspaceId', workspaceId)
  form.set('file', prepared)

  const response = await fetch(ATTACHMENT_ENDPOINT, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })

  const answer = answerSchema.safeParse(await response.json().catch(() => null))

  if (!response.ok) {
    throw new Error(
      (answer.success ? answer.data.message : undefined) ??
        t('features.labFiles.attach.unreadable'),
    )
  }

  const parsed = chatAttachmentSchema.safeParse(
    answer.success ? answer.data.attachment : null,
  )

  if (!parsed.success) throw new Error(t('features.labFiles.attach.unreadable'))

  return parsed.data
}

/** Reads each dropped file and adds it to the chat. */
export async function addChatFiles(
  key: string,
  workspaceId: string,
  dropped: File[],
): Promise<void> {
  for (const file of dropped) {
    const state = get(key)

    if (state.files.length + state.reading.length >= ATTACHMENT_MAX_FILES) {
      set(key, {
        error: t('features.labFiles.attach.tooMany', {
          count: ATTACHMENT_MAX_FILES,
        }),
      })

      return
    }

    if (file.size > ATTACHMENT_MAX_BYTES) {
      set(key, {
        error: t('features.labFiles.attach.failed', {
          name: file.name,
          message: t('features.labFiles.attach.tooBig'),
        }),
      })
      continue
    }

    set(key, { reading: [...state.reading, file.name], error: null })

    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Files are read one at a time so the chat's limit on files is checked against what is already in.
      const attachment = await readOne(workspaceId, file)
      const now = get(key)

      set(key, {
        files: [...now.files, attachment],
        unsent: [...now.unsent, attachment.id],
        reading: now.reading.filter((name) => name !== file.name),
      })
    } catch (error) {
      const now = get(key)

      set(key, {
        reading: now.reading.filter((name) => name !== file.name),
        error: t('features.labFiles.attach.failed', {
          name: file.name,
          message: error instanceof Error ? error.message : '',
        }),
      })
    }
  }
}

export function removeChatFile(key: string, id: string) {
  const state = get(key)

  set(key, {
    files: state.files.filter((file) => file.id !== id),
    unsent: state.unsent.filter((other) => other !== id),
  })
}

export function clearChatFiles(key: string) {
  states.delete(key)

  for (const listener of listeners) listener()
}

/**
 * What the next question carries: every file's reading, with a picture's
 * pixels only for the ones attached since the last question.
 */
export function filesForRequest(key: string): ChatAttachment[] {
  const state = get(key)

  return state.files.map((file) =>
    state.unsent.includes(file.id) ? file : { ...file, image: null },
  )
}

/** Marks the unsent files as sent and drops the pictures' pixels. */
export function markChatFilesSent(key: string): string[] {
  const state = get(key)
  const sent = state.unsent

  set(key, {
    unsent: [],
    files: state.files.map((file) => ({ ...file, image: null })),
  })

  return sent
}

export function dismissChatFileError(key: string) {
  set(key, { error: null })
}

/** The chat's files as state, and the ways to change them. */
export function useChatFiles(key: string, workspaceId: string) {
  const state = useSyncExternalStore(
    subscribe,
    () => get(key),
    () => EMPTY,
  )

  const add = useCallback(
    (dropped: File[]) => void addChatFiles(key, workspaceId, dropped),
    [key, workspaceId],
  )

  const remove = useCallback((id: string) => removeChatFile(key, id), [key])

  return { ...state, add, remove }
}
