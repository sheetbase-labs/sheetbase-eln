/**
 * What a plugin's sandboxed frame may send the app, read once.
 *
 * The frame has `sandbox="allow-scripts"` and no `allow-same-origin`, so it has
 * no cookies or storage and cannot read this page. Its only way out is the
 * SDK's `postMessage` channel; this module holds the shapes that channel
 * accepts, so a message is decoded before anything acts on it, and anything
 * else is dropped.
 */
import { z } from 'zod'

/** State is kept with the block in the database; this only guards against a runaway loop. */
export const maxStateBytes = 4 * 1024 * 1024

/** Same-site paths only: never a full address, a script or a protocol-relative link. */
const INTERNAL_PATH_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/

/** The tones a notice may use. */
const NOTICE_TONES = ['neutral', 'success', 'warning', 'danger', 'info']

/** The theme tokens a frame may use, against the app's own custom properties. */
const THEME_TOKENS = {
  '--sb-bg': '--background',
  '--sb-surface': '--card',
  '--sb-fg': '--foreground',
  '--sb-muted': '--muted-foreground',
  '--sb-border': '--border',
  '--sb-primary': '--primary',
  '--sb-primary-fg': '--primary-foreground',
  '--sb-success': '--success',
  '--sb-warning': '--warning',
  '--sb-danger': '--destructive',
  '--sb-info': '--info',
} as const satisfies Record<string, string>

/** The app's colours and light/dark mode, as a frame's CSS expects them. */
export function readTheme() {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const tokens: Record<string, string> = {}

  for (const [name, source] of Object.entries(THEME_TOKENS)) {
    const value = styles.getPropertyValue(source).trim()

    if (value) tokens[name] = value
  }

  return {
    theme: root.dataset.theme === 'dark' ? 'dark' : 'light',
    tokens,
  }
}

/** A plugin screen's context: the JSON the server hands the frame. */
const screenContextSchema = z.record(z.string(), z.unknown())

/** The context a plugin screen is given: named by the server, read by the frame. */
export type PluginScreenContext = z.infer<typeof screenContextSchema>

/** A JSON object a frame sent, or none when it sent something else. */
export const frameObjectSchema = z.record(z.string(), z.unknown())

/** The state a page or Home card keeps in this browser. */
const storedStateSchema = z.json()

/** One message a frame may send; everything else is ignored. */
const frameMessageSchema = z.discriminatedUnion('type', [
  z.object({ sb: z.literal(1), type: z.literal('ready') }),
  z.object({
    sb: z.literal(1),
    type: z.literal('resize'),
    height: z.number().finite(),
  }),
  z.object({ sb: z.literal(1), type: z.literal('table'), table: z.unknown() }),
  z.object({
    sb: z.literal(1),
    type: z.literal('emit'),
    name: z.string().max(40),
    payload: z.unknown(),
  }),
  z.object({
    sb: z.literal(1),
    type: z.literal('navigate'),
    path: z.string().max(500).regex(INTERNAL_PATH_RE),
  }),
  z.object({
    sb: z.literal(1),
    type: z.literal('notify'),
    text: z.string().max(300),
    tone: z.enum(NOTICE_TONES),
  }),
  z.object({ sb: z.literal(1), type: z.literal('state'), state: z.unknown() }),
  z.object({
    sb: z.literal(1),
    type: z.literal('host'),
    id: z.string().min(1),
    name: z.unknown(),
    input: z.unknown(),
  }),
  z.object({
    sb: z.literal(1),
    type: z.literal('call'),
    id: z.string().min(1),
    operation: z.string(),
    input: z.unknown(),
  }),
])

export type PluginFrameMessage = z.infer<typeof frameMessageSchema>

/** The message a frame sent, or null when it is not one of the shapes above. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the frame channel's decode boundary: `event.data` is whatever the sandbox posted, and the schema above decides whether it is a message.
export function parseFrameMessage(data: unknown): PluginFrameMessage | null {
  return frameMessageSchema.safeParse(data).data ?? null
}

/** What this browser kept for a page or Home card, if anything. */
export function readStoredState(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') return undefined

  try {
    const raw = localStorage.getItem(storageKey)

    return raw === null
      ? undefined
      : storedStateSchema.safeParse(JSON.parse(raw)).data
  } catch {
    return undefined
  }
}

/** Keep what a page or Home card saved; storage may be off, and then it lasts until the page closes. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The state is the frame's own value, carried back to storage exactly as it arrived.
export function writeStoredState(storageKey: string | null, state: unknown) {
  if (!storageKey) return

  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    /* storage is off: the state lasts until the page closes */
  }
}

/** What the person is asked before a write, and how their answer gets back. */
export interface FrameQuestion {
  operation: string
  detail?: string
  decide: (run: boolean) => void
}

/** The answer posted back to a frame. */
export type FrameReply =
  { ok: true; output?: unknown } | { ok: false; error: string; code?: string }
