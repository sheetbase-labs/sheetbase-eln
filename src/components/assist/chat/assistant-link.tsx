import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { defaultComponents } from 'streamdown'

import { ObjectLink } from '#/components/ui/object-link'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import { RECORD_REF, useRecordRef } from '#/lib/record-refs'

/** Hosts that are this app: links to them open in-app, never as "external". */
const APP_HOSTS = new Set(['sheetbase.dev', 'www.sheetbase.dev'])

const WHOLE_REF = new RegExp(`^${RECORD_REF.source}$`)

/**
 * The in-app path a link in an answer points at, or null for a real external
 * link. A relative path, an absolute link to this app's own origin or to
 * sheetbase.dev, and a bare identifier ("EXP-4302") are all this app.
 */
export function appPathFromHref(
  href: string | undefined,
  currentHost = typeof window === 'undefined' ? '' : window.location.host,
): string | null {
  const value = href?.trim()

  if (!value || value.startsWith('#')) return null

  if (WHOLE_REF.test(value)) return `/records/${value}`

  if (value.startsWith('/') && !value.startsWith('//')) return value

  try {
    const url = new URL(value)

    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.host === currentHost || APP_HOSTS.has(url.host))
    ) {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    // Not an absolute URL: leave it to the default renderer.
  }

  return null
}

/** The record identifier a path names (`/records/EXP-4302`, `/experiments/EXP-4302`). */
export function recordRefFromPath(path: string): string | null {
  const [, segment] = /^\/[a-z-]+\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path) ?? []
  const ref = segment ? decodeURIComponent(segment) : ''

  return WHOLE_REF.test(ref) ? ref : null
}

function InternalLink({
  path,
  children,
}: {
  path: string
  children: ComponentProps<'a'>['children']
}) {
  const workspace = useWorkspaceNavigation()
  const ref = recordRefFromPath(path)
  const kind = useRecordRef(ref ?? '')

  // A record reference becomes the shared record link: the right page for its
  // kind, with peek and Alt-click like every other identifier.
  if (ref && kind) {
    return (
      <ObjectLink kind={kind} identifier={ref} mono={false}>
        {children}
      </ObjectLink>
    )
  }

  return (
    <Link
      to={path}
      className="text-link"
      onClick={(event) => {
        openBesideOnAlt(workspace, path, event)
      }}
    >
      {children}
    </Link>
  )
}

/**
 * The link renderer for the assistant's Markdown. Anything that is this app
 * opens in-app; only a genuinely external address keeps Streamdown's link
 * check.
 */
export function AssistantLink(props: ComponentProps<'a'>) {
  const path = appPathFromHref(props.href)

  if (!path) {
    const Default = defaultComponents.a

    return <Default {...props} />
  }

  return <InternalLink path={path}>{props.children}</InternalLink>
}
