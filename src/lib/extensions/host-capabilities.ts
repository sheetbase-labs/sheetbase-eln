/**
 * What a plugin's screen can ask Sheetbase to do for it, beyond calling the
 * plugin's own operations. Every one acts as the person using the screen (so
 * their access applies), is only offered to a plugin whose manifest declares
 * the scope named here (shown to the administrator when the plugin is added),
 * and a change asks the person first.
 *
 * The screen calls `sheetbase.host(name, input)`.
 */
import { z } from 'zod'

import type { Scope } from '../api-credential-scopes'

export interface HostCapability {
  /** The manifest `permissions` entry that unlocks it. */
  scope: Scope
  /** A change: the person is asked before it runs. */
  write: boolean
  /** One line for the person's question and for the docs. */
  summary: string
}

export const HOST_CAPABILITIES = {
  'blocks.list': {
    scope: 'projects:read',
    write: false,
    summary: 'Read the other blocks in this notebook.',
  },
  'blocks.insertBelow': {
    scope: 'projects:write',
    write: true,
    summary: 'Add a block to the notebook, below this one.',
  },
  'files.list': {
    scope: 'files:read',
    write: false,
    summary: 'List the files linked to this record.',
  },
  'files.read': {
    scope: 'files:read',
    write: false,
    summary: 'Read a file in the workspace.',
  },
  'registry.models': {
    scope: 'models:read',
    write: false,
    summary: 'List the registries.',
  },
  'registry.findDuplicates': {
    scope: 'models:read',
    write: false,
    summary: 'Look for an entry that is already in a registry.',
  },
  'registry.create': {
    scope: 'projects:write',
    write: true,
    summary: 'Add an entry to a registry.',
  },
} as const satisfies Record<string, HostCapability>

export type HostCapabilityName = keyof typeof HOST_CAPABILITIES

export function isHostCapability(name: unknown): name is HostCapabilityName {
  return z
    .string()
    .refine((value) => Object.hasOwn(HOST_CAPABILITIES, value))
    .safeParse(name).success
}

/** The capabilities a plugin's declared scopes unlock. */
export function hostCapabilitiesFor(
  scopes: readonly string[],
): HostCapabilityName[] {
  const names: HostCapabilityName[] = []
  const granted = new Set(scopes)

  for (const name of Object.keys(HOST_CAPABILITIES)) {
    if (isHostCapability(name) && granted.has(HOST_CAPABILITIES[name].scope))
      names.push(name)
  }

  return names
}
