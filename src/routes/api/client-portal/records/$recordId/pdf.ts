/**
 * PORTAL-02.3 — the client portal's approved-record PDF download.
 *
 * Session-authenticated. The record is read through the SECURITY DEFINER
 * `client_portal_record_document` RPC, which returns a row only when the
 * caller's client may see the approved, shared record; anything else is a 404.
 * The bytes are rendered server-side from the frozen signed revision, so a
 * client who is denied the internal record surface still gets only what was
 * shared with them.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { ClientPortalRecordDocument } from '#/lib/client-portal'
import { renderClientPortalRecordPdf } from '#/lib/client-portal-pdf'
import {
  postgrestRpc,
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function handle({
  request,
  params,
}: {
  request: Request
  params: { recordId: string }
}): Promise<Response> {
  const auth = await resolveSessionAuth(request.headers, realSessionAuthDeps)
  if (!auth.ok) {
    return requestErrorResponse(auth.status, auth.code, auth.message)
  }
  if (!UUID.test(params.recordId)) {
    return requestErrorResponse(404, 'not_found', 'Record not found.')
  }
  const { status, body } =
    await postgrestRpc<ClientPortalRecordDocument | null>(
      'client_portal_record_document',
      { p_record_id: params.recordId },
      auth.context.token,
    )
  if (
    status !== 200 ||
    !body ||
    typeof body !== 'object' ||
    'error' in (body as Record<string, unknown>)
  ) {
    return requestErrorResponse(
      404,
      'not_found',
      'This document is not shared with your portal.',
    )
  }
  const document = body as ClientPortalRecordDocument
  const bytes = await renderClientPortalRecordPdf(document)
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${document.identifier}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}

export const Route = createFileRoute(
  '/api/client-portal/records/$recordId/pdf',
)({
  server: {
    handlers: { GET: handle },
  },
})
