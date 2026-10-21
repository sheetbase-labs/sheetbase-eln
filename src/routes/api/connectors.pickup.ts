/**
 * INT-02 — instrument file pickup endpoint.
 *
 * POST /api/connectors/pickup?connector=<key>&fileName=<name>[&parser=<id>]
 * with the raw file as the request body and a personal API token as
 * `Authorization: Bearer`. See src/lib/connectors/pickup.server.ts and
 * scripts/instrument-agent.mjs.
 */
import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { verifyExternalCredential } from '#/lib/external-token'
import { createServerDataClient } from '#/lib/connectors/enterprise/execution.server'
import {
  postgrestFileObjectReader,
  retainExternalBytes,
} from '#/lib/connectors/enterprise/retain.server'
import { handlePickup } from '#/lib/connectors/pickup.server'

const handler = ({ request }: { request: Request }) =>
  handlePickup(request, {
    verifyCredential: (token) =>
      verifyExternalCredential(db, token, env.PGRST_JWT_SECRET),
    createClient: createServerDataClient,
    retain: async (input) => {
      const readFileObject = postgrestFileObjectReader(input.token)
      const retained = await retainExternalBytes({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        fileName: input.fileName,
        mediaType: input.mediaType,
        bytes: input.bytes,
        rpc: (name, args) => input.client.rpc(name, args),
        readFileObject,
      })
      const fileObject = await readFileObject(
        input.workspaceId,
        retained.fileRecordId,
      )
      return {
        fileRecordId: retained.fileRecordId,
        fileObjectId: fileObject?.id ?? null,
        byteSize: retained.byteSize,
        checksum: retained.checksum,
      }
    },
  })

export const Route = createFileRoute('/api/connectors/pickup')({
  server: {
    handlers: { POST: handler },
  },
})
