import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { defaultComponents } from 'streamdown'

import { ObjectLink } from '#/components/ui/object-link'
import {
  openBesideOnAlt,
  useWorkspaceNavigation,
} from '#/components/workspace/workspace-navigation'
import { appPathFromHref, recordRefFromPath } from '#/lib/assistant-links'
import { useRecordRef } from '#/lib/record-refs'

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
