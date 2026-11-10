import { z } from 'zod'
import { safeNextPath } from '#/lib/sign-in-redirect'

export const states = [
  'signed-out',
  'expired-signing',
  'locked',
  'password',
  'sso-only',
] as const

export type SignInState = (typeof states)[number]

interface SignInSearchInput {
  state?: unknown
  next?: unknown
  error?: unknown
}

interface SignInSearch {
  state?: SignInState
  next?: string
  error?: string
}

export function parseSignInSearch(search: SignInSearchInput): SignInSearch {
  return {
    state: z.enum(states).optional().catch(undefined).parse(search.state),
    next: safeNextPath(search.next),
    error: z.string().optional().catch(undefined).parse(search.error),
  }
}

export function parseTwoFactorSearch(
  search: Pick<SignInSearchInput, 'next'>,
): Pick<SignInSearch, 'next'> {
  return { next: safeNextPath(search.next) }
}
