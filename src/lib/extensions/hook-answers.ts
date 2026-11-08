/**
 * What a plugin may answer from a hook, and the record it is shown.
 *
 * Nothing a plugin returns is trusted: every answer is checked against these
 * shapes and anything unknown is refused, never ignored. Pure and browser-safe
 * so the shapes can be documented and tested in one place.
 *
 * - A hook that runs **before** a save can refuse it (`refuse`), let it through
 *   with a visible word (`warn`), or fill in fields (`set`). It cannot reach
 *   any other record or table.
 * - A hook that runs **after** (and an event reaction) can leave notes, write a
 *   summary, add to a search index, raise or clear flags, ask for sign-offs and
 *   change records. It never signs, approves or attests: a sign-off it asks for
 *   is pressed by a person.
 *
 * What a plugin may change on a record is its fields: custom fields,
 * properties and tags. Never its status, title, owner, links, signatures or
 * anything locked. Changes are made as the person whose change set the plugin
 * off, so their access rules apply, and each is audited.
 */
import { z } from 'zod'

export const FLAG_KEY_RE = /^[a-z][a-z0-9_-]{0,48}$/
export const INDEX_NAME_RE = /^[a-z][a-z0-9_-]{0,48}$/
export const INDEX_ENTRY_RE = /^[A-Za-z0-9_.:-]{1,100}$/

export const SIGN_OFF_ROLES = [
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
] as const

/** The record a hook is shown, and the shape fills are applied to. */
export interface RecordSnapshot {
  /** Null for a record that is not saved yet. */
  id: string | null
  identifier: string | null
  kind: string
  title: string
  status: string
  tags: string[]
  properties: Record<string, unknown>
  custom_fields: Record<string, unknown>
  project_id: string | null
}

const objectOfValues = z.record(z.string(), z.unknown())

/** The fields a plugin may fill in or change. */
export const fieldFill = z
  .object({
    custom_fields: objectOfValues.optional(),
    properties: objectOfValues.optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type FieldFill = z.infer<typeof fieldFill>

export const beforeAnswer = z
  .object({
    /** Stops the save. The words are shown to the person who tried to save. */
    refuse: z.string().min(1).optional(),
    /** Lets the save through and shows these words. */
    warn: z.string().min(1).optional(),
    set: fieldFill.optional(),
  })
  .strict()
export type BeforeAnswer = z.infer<typeof beforeAnswer>

export const afterAnswer = z
  .object({
    notes: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            body: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    /** One summary per hook, replacing the last. An empty string removes it. */
    summary: z.string().optional(),
    index: z
      .array(
        z
          .object({
            /** Which of the plugin's indexes. */
            index: z.string().regex(INDEX_NAME_RE),
            /** Several entries per record are fine; defaults to `main`. */
            entry: z.string().regex(INDEX_ENTRY_RE).optional(),
            text: z.string().optional(),
            vector: z.array(z.number().finite()).min(1).optional(),
          })
          .strict()
          .refine((entry) => entry.text !== undefined || entry.vector, {
            message: 'an index entry needs text, a vector or both',
          }),
      )
      .optional(),
    flags: z
      .array(
        z
          .object({
            key: z.string().regex(FLAG_KEY_RE),
            title: z.string().min(1),
            message: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    clear: z.array(z.string().regex(FLAG_KEY_RE)).optional(),
    sign_off: z
      .array(
        z
          .object({
            key: z.string().regex(FLAG_KEY_RE),
            title: z.string().min(1),
            message: z.string().optional(),
            roles: z.array(z.enum(SIGN_OFF_ROLES)).min(1),
            approvals: z.number().int().min(1).optional(),
            independent: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    changes: z
      .array(
        z
          .object({
            /** Defaults to the record the hook or event is about. */
            record: z.string().uuid().optional(),
            set: fieldFill,
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
export type AfterAnswer = z.infer<typeof afterAnswer>

/** Applies a fill to a snapshot: custom fields and properties merge by key, tags are replaced. */
export function applyFill(
  record: RecordSnapshot,
  fill: FieldFill | undefined,
): RecordSnapshot {
  if (!fill) return record
  return {
    ...record,
    custom_fields: { ...record.custom_fields, ...(fill.custom_fields ?? {}) },
    properties: { ...record.properties, ...(fill.properties ?? {}) },
    tags: fill.tags ?? record.tags,
  }
}

/** Joins two fills; the later one wins on a shared key. */
export function mergeFill(
  first: FieldFill | undefined,
  second: FieldFill | undefined,
): FieldFill | undefined {
  if (!first) return second
  if (!second) return first
  return {
    ...(first.custom_fields || second.custom_fields
      ? { custom_fields: { ...first.custom_fields, ...second.custom_fields } }
      : {}),
    ...(first.properties || second.properties
      ? { properties: { ...first.properties, ...second.properties } }
      : {}),
    ...((second.tags ?? first.tags) ? { tags: second.tags ?? first.tags } : {}),
  }
}
