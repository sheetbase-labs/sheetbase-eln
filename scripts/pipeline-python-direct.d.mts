import type { Server } from 'node:http'

export function directImage(version?: string): string

export function createDirectRunner(options?: {
  image?: string
  token?: string
}): Server
