/**
 * Profile photos for the people in the current workspace. One read returns who
 * has a photo and a version that changes with each new one; avatars look a
 * person up here by user id and fall back to initials when there is none.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createDataClient } from '#/lib/data-client'

import { AvatarPhotosContext } from './avatar-photos-context'

export { avatarPhotoUrl, useAvatarPhotoUrl } from './avatar-photos-context'

export const memberPhotosQueryKey = ['member-photos'] as const

const client = createDataClient()

/** `userId → version` for every member with a photo. */
export async function fetchMemberPhotos(): Promise<Map<string, string>> {
  // A GET, like the other reads every page makes: it carries no body, so a
  // navigation that cancels it mid-flight leaves nothing half-read.
  const rows = await client.list<{ user_id: string; photo_version: string }>(
    'rpc/workspace_member_photos',
  )
  return new Map(rows.map((row) => [row.user_id, row.photo_version]))
}

/** Stores a photo as yours. */
export async function uploadMyPhoto(photo: Blob): Promise<void> {
  const response = await fetch('/api/avatars/me', {
    method: 'PUT',
    headers: { 'content-type': photo.type || 'application/octet-stream' },
    body: photo,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
}

/** Removes your photo; your initials show again. */
export async function removeMyPhoto(): Promise<void> {
  const response = await fetch('/api/avatars/me', { method: 'DELETE' })
  if (!response.ok) throw new Error(await errorMessage(response))
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) return body.error.message
  } catch {
    // Fall through to the status text.
  }
  return response.statusText || `Request failed (${response.status})`
}

export function AvatarPhotosProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const query = useQuery({
    queryKey: memberPhotosQueryKey,
    queryFn: fetchMemberPhotos,
    staleTime: 5 * 60_000,
  })
  const photos = useMemo(
    () => query.data ?? new Map<string, string>(),
    [query.data],
  )
  return (
    <AvatarPhotosContext.Provider value={photos}>
      {children}
    </AvatarPhotosContext.Provider>
  )
}
