import { drizzle } from 'drizzle-orm/node-postgres'
import { jwtVerify } from 'jose'
import { expect, it, vi } from 'vitest'

import * as schema from '#/db/schema'
import {
  DESIGN_USER_IDS,
  DESIGN_WORKSPACE_IDS,
  designSteps,
} from '#/db/seed/design'
import { DESIGN_SESSION_IDS, FIXTURE_USER_ID } from '#/db/seed/identities'
import { fixtureSteps } from '#/db/seed/run'
import * as credentials from '#/lib/api-credentials'
import * as audit from '#/lib/credential-audit'
import { migratorUrl, prepareTestDatabase, setActorJwt } from './helpers'

it('issues native audited credentials atomically and rejects expired sessions and lost authority', async () => {
  const { migrator, asRole } = await prepareTestDatabase()
  const db = drizzle(migratorUrl(), { schema })
  const actor = await asRole('authenticator')
  const agentStep = designSteps.find((step) => step.name === 'design agents')!
  const tokenStep = designSteps.find(
    (step) => step.name === 'design connectors and tokens',
  )!
  const issued: credentials.CreatedCredential[] = []
  const realCreate = credentials.createCredential
  const credentialRows = async () =>
    (
      await migrator.query(
        `select id,workspace_id,kind,display_prefix,name,scopes,created_at,
          last_used_at,revoked_at,expires_at,created_by_user_id
         from internal.api_credentials order by name`,
      )
    ).rows
  const events = async () =>
    (
      await migrator.query(
        "select * from api.change_events where entity_type='api_credential' order by sequence",
      )
    ).rows
  try {
    for (const step of fixtureSteps) await step.run(db)
    for (const step of designSteps) {
      if (step === agentStep) break
      await step.run(db)
    }
    // The real credential insert must roll back if its audit cannot commit.
    vi.spyOn(audit, 'emitCredentialAuditEvent').mockRejectedValueOnce(
      new Error('audit unavailable'),
    )
    await expect(agentStep.run(db)).rejects.toThrow('audit unavailable')
    expect(await credentialRows()).toHaveLength(0)
    expect(await events()).toHaveLength(0)
    vi.restoreAllMocks()
    vi.spyOn(credentials, 'createCredential').mockImplementation(
      async (...args) => {
        const created = await realCreate(...args)
        issued.push(created) // Memory only: never log or persist fixture secrets.
        return created
      },
    )
    let remaining = false
    for (const step of designSteps) {
      if (step === agentStep) remaining = true
      if (remaining) await step.run(db)
    }
    expect(issued.map((row) => [row.name, row.kind])).toEqual([
      ['Seed agent credential', 'service'],
      ['Plate-map exporter', 'personal'],
      ['Jupyter, Gareth', 'personal'],
    ])
    const key = process.env.PGRST_JWT_SECRET!
    for (const created of issued) {
      const token = await credentials.exchangeCredential(
        db,
        created.secret,
        created.scopes,
        {
          mintToken: async (input) =>
            input.kind === 'personal'
              ? credentials.mintPersonalApiToken(key, {
                  ...input,
                  userId: input.userId!,
                })
              : credentials.mintApiClientToken(key, input),
        },
      )
      const { payload } = await jwtVerify(token, new TextEncoder().encode(key))
      expect(payload).toMatchObject({
        workspace_id: DESIGN_WORKSPACE_IDS.processDevelopment,
        credential_id: created.id,
        role: created.kind === 'personal' ? 'authenticated' : 'api_client',
        scopes: created.scopes,
      })
      if (created.kind === 'personal')
        expect(payload.sub).toBe(
          created.name === 'Plate-map exporter'
            ? DESIGN_USER_IDS.mei
            : DESIGN_USER_IDS.gareth,
        )
      else expect(payload.sub).toBeUndefined()
      expect(payload.session_id).toBeUndefined()
    }
    const rows = await credentialRows()
    const createdEvents = await events()
    expect(createdEvents).toHaveLength(3)
    for (const row of rows) {
      const event = createdEvents.find((entry) => entry.entity_uuid === row.id)
      expect(event).toMatchObject({
        actor_user_id: row.created_by_user_id,
        operation: 'create',
        payload: {
          name: row.name,
          kind: row.kind,
          displayPrefix: row.display_prefix,
        },
      })
      expect(Object.keys(event.payload).sort()).toEqual([
        'displayPrefix',
        'kind',
        'name',
      ])
    }
    for (let repeat = 0; repeat < 2; repeat++) {
      await agentStep.run(db)
      await tokenStep.run(db)
      expect(await credentialRows()).toEqual(rows)
      expect(await events()).toEqual(createdEvents)
    }
    await actor.query('set role authenticated')
    await setActorJwt(
      actor,
      FIXTURE_USER_ID,
      DESIGN_WORKSPACE_IDS.processDevelopment,
      {
        session_id: 'design-session-fixture-owner-verification',
      },
    )
    await actor.query("select api.change_member_role($1,$2,'member')", [
      DESIGN_WORKSPACE_IDS.processDevelopment,
      DESIGN_USER_IDS.gareth,
    ])
    await expect(agentStep.run(db)).rejects.toThrow(
      'Only workspace owners can issue service credentials',
    )
    await actor.query("select api.change_member_role($1,$2,'owner')", [
      DESIGN_WORKSPACE_IDS.processDevelopment,
      DESIGN_USER_IDS.gareth,
    ])
    await actor.query('select api.suspend_member($1,$2)', [
      DESIGN_WORKSPACE_IDS.processDevelopment,
      DESIGN_USER_IDS.mei,
    ])
    await expect(tokenStep.run(db)).rejects.toThrow(
      'Credential fixture workspace membership required',
    )
    await actor.query('select api.reinstate_member($1,$2)', [
      DESIGN_WORKSPACE_IDS.processDevelopment,
      DESIGN_USER_IDS.mei,
    ])
    // Explicit auth-expiry negative control, not a business-event clock override.
    await migrator.query(
      'update internal.session set "expiresAt"=now()-interval \'1 second\' where id=$1',
      [DESIGN_SESSION_IDS.mei],
    )
    await expect(tokenStep.run(db)).rejects.toThrow(
      'Current native credential fixture session required',
    )
    expect(await credentialRows()).toEqual(rows)
    expect(await events()).toEqual(createdEvents)
  } finally {
    issued.length = 0
    vi.restoreAllMocks()
    await actor.end()
    await db.$client.end()
    await migrator.end()
  }
}, 180_000)
