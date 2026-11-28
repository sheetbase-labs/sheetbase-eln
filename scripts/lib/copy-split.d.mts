import type { Plugin } from 'vite'

export function sectionsIn(
  code: string,
  known: { has: (name: string) => boolean },
): Set<string>

export function copySplit(): Plugin
