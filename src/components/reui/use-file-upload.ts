/**
 * ReUI `use-file-upload`, installed from the pinned Base UI registry (ADR-0055):
 *
 *   pnpm dlx shadcn@latest add @reui/use-file-upload
 *   @reui -> https://reui.io/r/base-nova/{name}.json
 *
 * Copy-and-own source. The item is the hook `registry:hook`, whose registry
 * `target` is `hooks/use-file-upload.ts`; it is placed here because ADR-0055
 * decision 2 names `src/components/reui/**` as where registry items land, and
 * the scoped lint relaxation in `eslint.config.js` goes with that directory.
 * The CLI strips the `"use client"` directive the registry ships (this is not a
 * Next.js app); nothing else is changed, and the item imports no `cn`, so there
 * is no import path to re-point.
 *
 * What it is: the pick-and-drop machinery only — a hidden file input, the four
 * drag handlers, `isDragging`, and its own size/type validation. It sends
 * nothing anywhere, and ReUI's own note says no example does: the transport,
 * the validation policy and the storage policy stay ours. The shipping surface
 * that composes it is `src/components/ui/file-drop.tsx`.
 *
 * Local patches after ADR-0057 (this file is first-party-maintained source; a
 * registry re-sync merges these rather than taking the item over them):
 * - `onFilesChange` is called from the action that changed the selection, not
 *   from inside the state updater. StrictMode runs an updater twice, so the
 *   registry form delivered one pick's callback twice; the next selection is
 *   computed from the current state and handed over once, after the same
 *   `onFilesAdded` and in the same order as before.
 * - Every object URL the hook mints is tracked, released when its entry is
 *   removed or cleared, and released when the hook unmounts. The registry form
 *   revoked only image previews and only from inside the updater, so a
 *   non-image preview and an unmount both leaked.
 * - Input value resets, preview revocation and callback delivery moved out of
 *   the updaters, which keeps the updaters pure.
 * - `handleDragLeave` narrows `relatedTarget` with `instanceof Node` rather
 *   than asserting it, and `onError` joined `addFiles`' dependency list (it was
 *   read there without being listed, so a changed callback was stale).
 */
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, InputHTMLAttributes } from 'react'

export type FileMetadata = {
  name: string
  size: number
  type: string
  url: string
  id: string
}

export type FileWithPreview = {
  file: File | FileMetadata
  id: string
  preview?: string
}

export type FileUploadOptions = {
  maxFiles?: number // Only used when multiple is true, defaults to Infinity
  maxSize?: number // in bytes
  accept?: string
  multiple?: boolean // Defaults to false
  initialFiles?: FileMetadata[]
  onFilesChange?: (files: FileWithPreview[]) => void // Callback when files change
  onFilesAdded?: (addedFiles: FileWithPreview[]) => void // Callback when new files are added
  onError?: (errors: string[]) => void
}

export type FileUploadState = {
  files: FileWithPreview[]
  isDragging: boolean
  errors: string[]
}

export type FileUploadActions = {
  addFiles: (files: FileList | File[]) => void
  removeFile: (id: string) => void
  clearFiles: () => void
  clearErrors: () => void
  handleDragEnter: (e: DragEvent<HTMLElement>) => void
  handleDragLeave: (e: DragEvent<HTMLElement>) => void
  handleDragOver: (e: DragEvent<HTMLElement>) => void
  handleDrop: (e: DragEvent<HTMLElement>) => void
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  openFileDialog: () => void
  getInputProps: (
    props?: InputHTMLAttributes<HTMLInputElement>,
  ) => InputHTMLAttributes<HTMLInputElement> & {
    ref: React.Ref<HTMLInputElement>
  }
}

export const useFileUpload = (
  options: FileUploadOptions = {},
): [FileUploadState, FileUploadActions] => {
  const {
    maxFiles = Number.POSITIVE_INFINITY,
    maxSize = Number.POSITIVE_INFINITY,
    accept = '*',
    multiple = false,
    initialFiles = [],
    onFilesChange,
    onFilesAdded,
    onError,
  } = options

  const [state, setState] = useState<FileUploadState>({
    files: initialFiles.map((file) => ({
      file,
      id: file.id,
      preview: file.url,
    })),
    isDragging: false,
    errors: [],
  })

  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Every object URL this hook has minted, keyed by the file it previews. A
   * preview is the hook's to release only when the hook made it: an
   * `initialFiles` entry's `url` belongs to the caller.
   */
  const previews = useRef(new Map<File, string>())

  const validateFile = useCallback(
    (file: File | FileMetadata): string | null => {
      if (file instanceof File) {
        if (file.size > maxSize) {
          return `File "${file.name}" exceeds the maximum size of ${formatBytes(maxSize)}.`
        }
      } else {
        if (file.size > maxSize) {
          return `File "${file.name}" exceeds the maximum size of ${formatBytes(maxSize)}.`
        }
      }

      if (accept !== '*') {
        const acceptedTypes = accept.split(',').map((type) => type.trim())
        const fileType = file instanceof File ? file.type || '' : file.type
        const fileExtension = `.${file instanceof File ? file.name.split('.').pop() : file.name.split('.').pop()}`

        const isAccepted = acceptedTypes.some((type) => {
          if (type.startsWith('.')) {
            return fileExtension.toLowerCase() === type.toLowerCase()
          }

          if (type.endsWith('/*')) {
            const baseType = type.split('/')[0]

            return fileType.startsWith(`${baseType}/`)
          }

          return fileType === type
        })

        if (!isAccepted) {
          return `File "${file instanceof File ? file.name : file.name}" is not an accepted file type.`
        }
      }

      return null
    },
    [accept, maxSize],
  )

  /**
   * Mint an entry's preview and remember it, so removing the entry — or
   * unmounting — releases exactly the URLs this hook created and never a
   * caller's own `initialFiles` url. The preview handed back is the value the
   * record holds, so what escapes is always the URL `releasePreview` revokes.
   */
  const createPreview = useCallback(
    (file: File | FileMetadata): string | undefined => {
      if (!(file instanceof File)) return file.url

      const url = URL.createObjectURL(file)
      previews.current.set(file, url)

      return previews.current.get(file)
    },
    [],
  )

  /** Release a preview this hook created; the caller's own `url` is not ours. */
  const releasePreview = useCallback((entry: FileWithPreview) => {
    if (!(entry.file instanceof File)) return

    const preview = previews.current.get(entry.file)

    if (preview === undefined) return

    previews.current.delete(entry.file)
    URL.revokeObjectURL(preview)
  }, [])

  // A preview outlives no consumer: release whatever is left when this goes.
  useEffect(
    () => () => {
      for (const preview of previews.current.values()) {
        URL.revokeObjectURL(preview)
      }

      previews.current.clear()
    },
    [],
  )

  const generateUniqueId = useCallback((file: File | FileMetadata): string => {
    if (file instanceof File) {
      return `${file.name}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }

    return file.id
  }, [])

  const clearFiles = useCallback(() => {
    for (const file of state.files) {
      releasePreview(file)
    }

    if (inputRef.current) {
      inputRef.current.value = ''
    }

    setState((prev) => ({
      ...prev,
      files: [],
      errors: [],
    }))

    onFilesChange?.([])
  }, [state.files, releasePreview, onFilesChange])

  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      if (newFiles.length === 0) return

      const newFilesArray = Array.from(newFiles)
      const errors: string[] = []

      // Clear existing errors when new files are uploaded
      setState((prev) => ({ ...prev, errors: [] }))

      // In single file mode, clear existing files first
      if (!multiple) {
        clearFiles()
      }

      // Check if adding these files would exceed maxFiles (only in multiple mode)
      if (
        multiple &&
        maxFiles !== Number.POSITIVE_INFINITY &&
        state.files.length + newFilesArray.length > maxFiles
      ) {
        errors.push(`You can only upload a maximum of ${maxFiles} files.`)
        onError?.(errors)
        setState((prev) => ({ ...prev, errors }))

        return
      }

      const validFiles: FileWithPreview[] = []

      for (const file of newFilesArray) {
        // Only check for duplicates if multiple files are allowed
        if (multiple) {
          const isDuplicate = state.files.some(
            (existingFile) =>
              existingFile.file.name === file.name &&
              existingFile.file.size === file.size,
          )

          // Skip duplicate files silently
          if (isDuplicate) {
            return
          }
        }

        // Check file size
        if (file.size > maxSize) {
          errors.push(
            multiple
              ? `Some files exceed the maximum size of ${formatBytes(maxSize)}.`
              : `File exceeds the maximum size of ${formatBytes(maxSize)}.`,
          )
          continue
        }

        const error = validateFile(file)

        if (error) {
          errors.push(error)
        } else {
          validFiles.push({
            file,
            id: generateUniqueId(file),
            preview: createPreview(file),
          })
        }
      }

      // Only update state if we have valid files to add
      if (validFiles.length > 0) {
        // Call the onFilesAdded callback with the newly added valid files
        onFilesAdded?.(validFiles)

        const nextFiles = multiple
          ? [...state.files, ...validFiles]
          : validFiles

        setState((prev) => ({
          ...prev,
          files: nextFiles,
          errors,
        }))

        // Announced after the same callback the registry form called first.
        onFilesChange?.(nextFiles)
      } else if (errors.length > 0) {
        onError?.(errors)
        setState((prev) => ({
          ...prev,
          errors,
        }))
      }

      // Reset input value after handling files
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    },
    [
      state.files,
      maxFiles,
      multiple,
      maxSize,
      validateFile,
      createPreview,
      generateUniqueId,
      clearFiles,
      onFilesChange,
      onFilesAdded,
      onError,
    ],
  )

  const removeFile = useCallback(
    (id: string) => {
      const removed = state.files.find((file) => file.id === id)

      if (removed) {
        releasePreview(removed)
      }

      const newFiles = state.files.filter((file) => file.id !== id)

      setState((prev) => ({
        ...prev,
        files: newFiles,
        errors: [],
      }))

      onFilesChange?.(newFiles)
    },
    [state.files, releasePreview, onFilesChange],
  )

  const clearErrors = useCallback(() => {
    setState((prev) => ({
      ...prev,
      errors: [],
    }))
  }, [])

  const handleDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setState((prev) => ({ ...prev, isDragging: true }))
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()

    // A drag inside the field fires leave on the child it entered; only a leave
    // whose related target is outside the field ends the drag.
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return
    }

    setState((prev) => ({ ...prev, isDragging: false }))
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setState((prev) => ({ ...prev, isDragging: false }))

      // Don't process files if the input is disabled
      if (inputRef.current?.disabled) {
        return
      }

      if (e.dataTransfer.files.length > 0) {
        // In single file mode, only use the first file
        if (!multiple) {
          const file = e.dataTransfer.files[0]
          addFiles([file])
        } else {
          addFiles(e.dataTransfer.files)
        }
      }
    },
    [addFiles, multiple],
  )

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files)
      }
    },
    [addFiles],
  )

  const openFileDialog = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.click()
    }
  }, [])

  const getInputProps = useCallback(
    (props: InputHTMLAttributes<HTMLInputElement> = {}) => {
      return {
        ...props,
        type: 'file' as const,
        onChange: handleFileChange,
        accept: props.accept || accept,
        multiple: props.multiple !== undefined ? props.multiple : multiple,
        ref: inputRef,
      }
    },
    [accept, multiple, handleFileChange],
  )

  return [
    state,
    {
      addFiles,
      removeFile,
      clearFiles,
      clearErrors,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
      handleFileChange,
      openFileDialog,
      getInputProps,
    },
  ]
}

// Helper function to format bytes to human-readable format
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Number.parseFloat((bytes / k ** i).toFixed(dm)) + sizes[i]
}
