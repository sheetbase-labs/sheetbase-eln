/**
 * Profile photos for the people in the current workspace. One read returns who
 * has a photo and a version that changes with each new one; avatars look a
 * person up here by user id and fall back to initials when there is none.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { createDataClient } from '#/lib/data-client'

import { AvatarPhotosContext } from './avatar-photos-context'

export { avatarPhotoUrl, useAvatarPhotoUrl } from './avatar-photos-context'

// react-doctor-disable-next-line react-doctor/only-export-components -- The photo query key and its reads live beside the provider that owns their cache entry.
export const memberPhotosQueryKey = ['member-photos'] as const

const client = createDataClient()

/** `userId → version` for every member with a photo. */
// react-doctor-disable-next-line react-doctor/only-export-components -- The provider and the profile photo dialog share this read; it is exported so the dialog can refresh the same cache entry.
export async function fetchMemberPhotos(): Promise<Map<string, string>> {
  // A GET, like the other reads every page makes: it carries no body, so a
  // navigation that cancels it mid-flight leaves nothing half-read.
  const rows = await client.list<{ user_id: string; photo_version: string }>(
    'rpc/workspace_member_photos',
  )

  return new Map(rows.map((row) => [row.user_id, row.photo_version]))
}

/** Stores a photo as yours. */
// react-doctor-disable-next-line react-doctor/only-export-components -- The profile photo dialog calls this write; the provider owns the cache it invalidates.
export async function uploadMyPhoto(photo: Blob): Promise<void> {
  const response = await fetch('/api/avatars/me', {
    method: 'PUT',
    headers: { 'content-type': photo.type || 'application/octet-stream' },
    body: photo,
  })

  if (!response.ok) throw new Error(await errorMessage(response))
}

/** Removes your photo; your initials show again. */
// react-doctor-disable-next-line react-doctor/only-export-components -- The profile photo dialog calls this write; the provider owns the cache it invalidates.
export async function removeMyPhoto(): Promise<void> {
  const response = await fetch('/api/avatars/me', { method: 'DELETE' })

  if (!response.ok) throw new Error(await errorMessage(response))
}

/** The API error envelope, when the response carried one. */
const apiError = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
})

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = apiError.safeParse(await response.json())

    if (body.success && body.data.error?.message) return body.data.error.message
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
