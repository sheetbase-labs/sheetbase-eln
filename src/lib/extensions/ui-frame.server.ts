/**
 * GET /api/plugins/<key>/ui/<id>?point=<point>: the document a plugin's
 * UI bundle runs as, for the sandboxed frame that embeds it. Signed-in people
 * only, and only while the plugin is enabled, the point is on and the plugin
 * still declares a UI for this block or panel.
 */
import sdkSource from '../../../sdks/plugin-ui/sheetbase-ui.js?raw'

import { defaultRouteDeps, refuse } from './run-route.server'
import type { ExtensionRunRouteDeps } from './run-route.server'
import { ExtensionRunError, openExtensionPoint } from './runtime.server'
import { PLUGIN_FRAME_HEADERS, buildPluginFrame } from './ui-frame'
import { frameEntryOf, isFramePoint } from './ui-points'

const idPattern = /^[a-z][a-z0-9-]{0,48}$/

export async function handlePluginUiFrame(
  request: Request,
  params: { key: string; id: string },
  deps: ExtensionRunRouteDeps = defaultRouteDeps(),
): Promise<Response> {
  const point = new URL(request.url).searchParams.get('point')

  if (
    !idPattern.test(params.key) ||
    !idPattern.test(params.id) ||
    !point ||
    !isFramePoint(point)
  )
    return refuse(404, 'No such plugin screen.')
  const session = await deps.getSession(request.headers)

  if (!session) return refuse(401, 'Sign in to use plugins.')
  const member = await deps.getMember(session.user.id)

  if (!member) return refuse(403, 'You need a workspace to use plugins.')

  try {
    const { install, manifest } = await openExtensionPoint(
      deps.runtime,
      member.workspaceId,
      params.key,
      point,
    )

    const declared = manifest.contributions[point]?.find(
      (item) => item.id === params.id,
    )

    const entry = frameEntryOf(point, declared)

    if (!entry) return refuse(404, 'That plugin doesn’t offer this any more.')
    const files = await deps.runtime.loadPackage(member.workspaceId, install.id)
    const html = files ? buildPluginFrame(files, entry, sdkSource) : null

    if (!html) return refuse(404, 'That plugin’s screen is missing.')

    return new Response(html, { status: 200, headers: PLUGIN_FRAME_HEADERS })
  } catch (error) {
    if (error instanceof ExtensionRunError)
      return refuse(error.code === 'not_installed' ? 404 : 409, error.message)

    return refuse(500, 'The plugin’s screen could not be loaded.')
  }
}
