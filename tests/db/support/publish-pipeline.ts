import type { Client } from 'pg'

/**
 * Publishing a pipeline version needs an admin's approval: the caller asks,
 * then an owner or admin approves, and the approval publishes the version.
 * Tests that only need a published version go through this. The acting client
 * must be an owner or admin; in a workspace with a single owner or admin that
 * person may approve their own request.
 */
export async function publishPipelineVersion(
  client: Client,
  workspaceId: string,
  versionId: string,
  decider: Client = client,
): Promise<void> {
  const request = await client.query<{ id: string }>(
    'select id from api.request_pipeline_publish($1::uuid, $2::uuid, $3::text)',
    [workspaceId, versionId, 'Publish for the test'],
  )

  await decider.query('select * from api.approve_approval_request($1::uuid)', [
    request.rows[0].id,
  ])
}
