/**
 * The photo lookup avatars read. It is kept apart from the data reads so the
 * avatar component stays importable anywhere: without a provider every
 * person simply shows initials.
 */
import { createContext, useContext } from 'react'

/** The URL a photo is served at; the version makes a new photo a new URL. */
export function avatarPhotoUrl(userId: string, version: string): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${encodeURIComponent(version)}`
}

export const AvatarPhotosContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
)

/** The photo URL for a person, or undefined when they have none. */
export function useAvatarPhotoUrl(
  userId: string | null | undefined,
): string | undefined {
  const photos = useContext(AvatarPhotosContext)
  if (!userId) return undefined
  const version = photos.get(userId)
  return version ? avatarPhotoUrl(userId, version) : undefined
}
