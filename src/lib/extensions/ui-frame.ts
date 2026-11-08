/**
 * Builds the one HTML document a plugin UI bundle runs as.
 *
 * The bundle (`ui/index.html` and the scripts, styles and images it points at)
 * is turned into a single file with everything inlined and the Sheetbase UI SDK
 * added, then served with a content security policy that allows no network, no
 * form posts and no navigation, and a `sandbox` directive without
 * `allow-same-origin`: the frame has no cookies, no storage, no way to read the
 * page around it, and its only way out is the SDK's `postMessage` channel. The
 * page that embeds it checks every message comes from that frame.
 *
 * Pure: no server imports, so it can be tested without one.
 */
import { PLUGIN_UI_SDK_NAME } from './package'

/** Sent with the document. Nothing but inline script and style may load. */
export const PLUGIN_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ')

export const PLUGIN_FRAME_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': PLUGIN_FRAME_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

function resolveRelative(base: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null
  const parts = base.split('/').slice(0, -1)
  for (const part of href.split(/[?#]/)[0].split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.join('/')
}

const scriptSafe = (source: string) => source.replace(/<\/(script)/gi, '<\\/$1')
const styleSafe = (source: string) => source.replace(/<\/(style)/gi, '<\\/$1')

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
}

/**
 * The frame document for `entry` (such as `ui/index.html`), or null when the
 * entry is not in the package.
 */
export function buildPluginFrame(
  files: Readonly<Record<string, string>>,
  entry: string,
  sdkSource: string,
): string | null {
  const html = files[entry] as string | undefined
  if (html === undefined) return null
  let sdkSeen = false as boolean
  let out = html.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (_whole, _before: string, _q: string, src: string) => {
      if (src.split('/').pop() === PLUGIN_UI_SDK_NAME) {
        sdkSeen = true
        return `<script>${scriptSafe(sdkSource)}</script>`
      }
      const path = resolveRelative(entry, src)
      const code = path ? files[path] : undefined
      return code === undefined ? '' : `<script>${scriptSafe(code)}</script>`
    },
  )
  out = out.replace(
    /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi,
    (tag) => {
      const href = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2]
      const path = href ? resolveRelative(entry, href) : null
      const css = path ? files[path] : undefined
      return css === undefined ? '' : `<style>${styleSafe(css)}</style>`
    },
  )
  out = out.replace(
    /(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (whole, lead: string, quote: string, ref: string) => {
      if (ref.startsWith('#') || ref.startsWith('data:')) return whole
      const path = resolveRelative(entry, ref)
      const ext = path?.split('.').pop()?.toLowerCase() ?? ''
      const body = path ? files[path] : undefined
      if (body === undefined || !MIME[ext]) return `${lead}${quote}${quote}`
      return `${lead}${quote}data:${MIME[ext]};base64,${btoa(unescape(encodeURIComponent(body)))}${quote}`
    },
  )
  if (!sdkSeen) {
    const tag = `<script>${scriptSafe(sdkSource)}</script>`
    out = /<head[^>]*>/i.test(out)
      ? out.replace(/<head[^>]*>/i, (head) => `${head}${tag}`)
      : `${tag}${out}`
  }
  return out
}
