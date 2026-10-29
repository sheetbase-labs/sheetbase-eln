import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'

import { db } from '#/db/client.server'
import { env } from '#/env.server'
import { isSameOriginRequest } from '#/lib/request-origin'
import { auth, recoverSigningPassword } from '#/lib/auth'
import {
  createSmtpTransport,
  readSmtpConfig,
} from '#/lib/email-delivery.server'
import type { EmailTransport } from '#/lib/email-delivery.server'

const workspaceId = z.uuid()
const password = z.string().min(1).max(1024)
const emailSecret = z.string().min(32).max(128)
const inputSchema = z.discriminatedUnion('purpose', [
  z
    .object({
      purpose: z.literal('sign'),
      workspaceId,
      password,
      submissionId: z.uuid(),
      revisionDigest: z.string().regex(/^[0-9a-f]{64}$/),
      signatureMeaning: z.enum([
        'reviewed',
        'reviewed-and-approved',
        'witnessed',
      ]),
    })
    .strict(),
  z
    .object({
      purpose: z.literal('author-submit'),
      workspaceId,
      password,
      recordId: z.uuid(),
      revisionDigest: z.string().regex(/^[0-9a-f]{64}$/),
      workflowDefinitionKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
      workflowDefinitionVersion: z.number().int().positive(),
      reviewerUserIds: z.array(z.string().min(1)).min(1),
      confirmed: z.boolean(),
      idempotencyKey: z.string().min(1).max(128),
      dueAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .strict(),
  z.object({ purpose: z.literal('certify'), workspaceId, password }).strict(),
  z.object({ purpose: z.literal('practice'), workspaceId, password }).strict(),
  z.object({ purpose: z.literal('enroll-request'), workspaceId }).strict(),
  z.object({ purpose: z.literal('recover-request'), workspaceId }).strict(),
  z
    .object({
      purpose: z.literal('enroll'),
      workspaceId,
      password,
      secret: emailSecret,
    })
    .strict(),
  z
    .object({
      purpose: z.literal('recover'),
      workspaceId,
      password,
      secret: emailSecret,
    })
    .strict(),
])

export interface SignatureStepUpDeps {
  database: typeof db
  authentication: typeof auth
  /** Explicit local test seam; production resolves its TLS-enforced SMTP transport. */
  transport?: EmailTransport
}

const realDeps: SignatureStepUpDeps = { database: db, authentication: auth }
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const reply = (status: number, body: object) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

/** Password evidence is minted only here, after Better Auth verification. */
export async function handleSignatureStepUp(
  request: Request,
  deps = realDeps,
): Promise<Response> {
  if (request.method !== 'POST')
    return reply(405, { message: 'POST required.' })
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return reply(403, { message: 'Same-origin request required.' })
  }
  let input: z.infer<typeof inputSchema>
  try {
    input = inputSchema.parse(await request.json())
  } catch {
    return reply(400, { message: 'Invalid signing request.' })
  }
  // Never use the demo/auth-free session resolver for regulated signing.
  const current = await deps.authentication.api.getSession({
    headers: request.headers,
  })
  // R5-SHELL-05: a distinct code separates "the session behind this attempt
  // has ended" from a refused password (also 401 below) so the signing surface
  // can send the person back to sign in instead of leaving a dead retry.
  if (!current)
    return reply(401, { code: 'session_expired', message: 'Sign in again.' })
  const userId = current.user.id
  const sessionId = current.session.id
  const client = await deps.database.$client.connect()
  let transaction = false
  async function audit(event: string) {
    await client.query(
      `INSERT INTO internal.signature_authentication_events
      (workspace_id,user_id,session_id,event) VALUES($1,$2,$3,$4)`,
      [input.workspaceId, userId, sessionId, event],
    )
  }
  async function commit() {
    await client.query('COMMIT')
    transaction = false
  }
  try {
    await client.query('BEGIN')
    transaction = true
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: userId,
        workspace_id: input.workspaceId,
        session_id: sessionId,
        role: 'authenticated',
      }),
    ])
    // Serializes password verification across all user sessions and workspaces.
    await client.query(
      `INSERT INTO internal.signature_password_attempts(user_id)
      VALUES($1) ON CONFLICT DO NOTHING`,
      [userId],
    )
    const attempts = await client.query<{ failures: number; locked: boolean }>(
      `SELECT failures,locked_until>clock_timestamp() AS locked
       FROM internal.signature_password_attempts WHERE user_id=$1 FOR UPDATE`,
      [userId],
    )
    if (attempts.rows[0]?.locked) {
      await audit('password-locked')
      await commit()
      return reply(423, {
        message:
          'Signing is locked for 15 minutes after three failed attempts.',
      })
    }
    await client.query(
      `UPDATE internal.signature_password_attempts SET failures=0,locked_until=NULL
      WHERE user_id=$1 AND locked_until IS NOT NULL AND locked_until<=clock_timestamp()`,
      [userId],
    )
    const identity = await client.query<{
      verified_email: string
      credential_session_id: string | null
      credential_authorization_id: string | null
      credential_authorization_consumed_at: Date | null
      authorization_current: boolean
      certified: boolean
    }>(
      `SELECT c.*,c.identity_verified_at>clock_timestamp()-interval '15 minutes' AS authorization_current,
      c.certified_at IS NOT NULL AND c.revoked_at IS NULL AND c.statement_version=1
        AND c.auth_method='password' AS certified
      FROM internal.signature_identity($1,$2,$3) c`,
      [input.workspaceId, userId, sessionId],
    )
    const certification = identity.rows.at(0)
    if (!certification) throw new Error('Missing independent verification')
    if (
      input.purpose === 'sign' ||
      input.purpose === 'practice' ||
      input.purpose === 'author-submit'
    ) {
      if (!certification.certified) {
        await commit()
        return reply(403, {
          message: 'Certify your signature in Settings before signing.',
        })
      }
    }
    let submissionArguments: unknown = null
    if (input.purpose === 'author-submit') {
      const eligible = await client.query(
        `SELECT r.id FROM api.records r JOIN internal.review_workflow_definitions w
         ON w.definition_key=$3 AND w.version=$4
         WHERE r.id=$1 AND r.workspace_id=$2 AND r.archived_at IS NULL AND r.deleted_at IS NULL
           AND r.locked_at IS NULL AND api.is_workspace_writer(r.workspace_id)
           AND internal.can_access_object('record',r.id,'edit')
           AND coalesce((w.definition->>'requiresSignature')::boolean,false) AND $5
           AND (api.preview_submission_digest(r.id)->>'sourceDigest')=$6
           AND NOT EXISTS(SELECT 1 FROM unnest($7::text[]) reviewer
             WHERE NOT EXISTS(SELECT 1 FROM api.workspace_memberships m
               WHERE m.workspace_id=r.workspace_id AND m.user_id=reviewer AND m.suspended_at IS NULL))`,
        [
          input.recordId,
          input.workspaceId,
          input.workflowDefinitionKey,
          input.workflowDefinitionVersion,
          input.confirmed,
          input.revisionDigest,
          input.reviewerUserIds,
        ],
      )
      if (eligible.rowCount !== 1) {
        await commit()
        return reply(403, {
          message: 'The controlled submission is not available to author.',
        })
      }
      const normalized = await client.query<{ arguments: unknown }>(
        'SELECT internal.signature_submission_arguments($1,$2,$3,$4,$5::text[],$6,$7,$8::timestamptz) AS arguments',
        [
          input.recordId,
          input.revisionDigest,
          input.workflowDefinitionKey,
          input.workflowDefinitionVersion,
          input.reviewerUserIds,
          input.confirmed,
          input.idempotencyKey,
          input.dueAt,
        ],
      )
      submissionArguments = normalized.rows[0]?.arguments
      if (!submissionArguments)
        throw new Error('Submission arguments unavailable')
    }
    if (input.purpose === 'sign') {
      await client.query('SELECT internal.assert_signature_target($1,$2,$3)', [
        input.submissionId,
        input.signatureMeaning,
        input.revisionDigest,
      ])
    }
    if (
      input.purpose === 'enroll-request' ||
      input.purpose === 'recover-request' ||
      input.purpose === 'enroll' ||
      input.purpose === 'recover'
    ) {
      const recovering =
        input.purpose === 'recover-request' || input.purpose === 'recover'
      if (
        !certification.authorization_current ||
        certification.credential_session_id !== sessionId ||
        !certification.credential_authorization_id ||
        certification.credential_authorization_consumed_at
      ) {
        await commit()
        return reply(403, {
          message:
            'Request fresh independent administrator verification for this session.',
        })
      }
      const existing = await client.query(
        `SELECT id FROM internal.account
        WHERE "userId"=$1 AND "providerId"='credential' AND password IS NOT NULL`,
        [userId],
      )
      if (Boolean(existing.rowCount) !== recovering) {
        await commit()
        return reply(409, {
          message: recovering
            ? 'No signing credential exists to recover.'
            : 'A signing credential already exists. Use independent recovery.',
        })
      }
      const purpose = recovering ? 'recover' : 'enroll'
      if (
        input.purpose === 'enroll-request' ||
        input.purpose === 'recover-request'
      ) {
        // Every reissue attempt invalidates the previous secret, even when
        // configuration or transport initialization fails before delivery.
        await client.query(
          `UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
          WHERE user_id=$1 AND purpose IN ('enroll','recover') AND consumed_at IS NULL`,
          [userId],
        )
        let transport: EmailTransport | null
        try {
          transport = deps.transport ?? (await configuredTransport())
        } catch {
          transport = null
        }
        if (!transport) {
          await audit(`${purpose}-delivery-unavailable`)
          await commit()
          return reply(503, {
            message:
              'Secure email delivery is not configured. Enrollment is unavailable.',
          })
        }
        // Reissue invalidation commits before delivery; a failed send never resurrects an old secret.
        const secret = randomBytes(32).toString('base64url')
        const tokenHash = hash(secret)
        const expiresAt = await insertGrant(client, {
          tokenHash,
          userId,
          sessionId,
          workspaceId: input.workspaceId,
          purpose,
          authorizationId: certification.credential_authorization_id,
        })
        await audit(`${purpose}-secret-issued`)
        await commit()
        try {
          await transport.send({
            to: certification.verified_email,
            subject: 'Sheetbase signing credential authorization',
            body: `Your one-use ${purpose === 'recover' ? 'recovery' : 'enrollment'} secret is:\n\n${secret}\n\nEnter it in Electronic signatures settings in the session you requested verification from. It expires in five minutes. Never share it or your password with an administrator.`,
          })
        } catch {
          await client.query(
            `UPDATE internal.signature_grants SET consumed_at=clock_timestamp() WHERE token_hash=$1`,
            [tokenHash],
          )
          await audit(`${purpose}-delivery-failed`)
          return reply(503, {
            message: 'Secure email delivery failed. No credential was changed.',
          })
        }
        return reply(200, { delivered: true, expiresAt })
      }
      const consumed = await client.query(
        `UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
        WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND workspace_id=$4 AND purpose=$5
          AND authorization_id=$6 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`,
        [
          hash(input.secret),
          userId,
          sessionId,
          input.workspaceId,
          purpose,
          certification.credential_authorization_id,
        ],
      )
      if (consumed.rowCount !== 1) {
        await commit()
        return reply(403, {
          message: 'The one-use authorization is invalid or expired.',
        })
      }
      await client.query(
        `UPDATE api.user_signature_certifications SET credential_authorization_consumed_at=clock_timestamp()
        WHERE workspace_id=$1 AND user_id=$2`,
        [input.workspaceId, userId],
      )
      await client.query(
        `UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
        WHERE user_id=$1 AND consumed_at IS NULL`,
        [userId],
      )
      if (recovering)
        await client.query(
          `UPDATE api.user_signature_certifications SET revoked_at=clock_timestamp()
        WHERE user_id=$1 AND revoked_at IS NULL`,
          [userId],
        )
      await audit(`${purpose}-authorization-spent`)
      await commit()
      // Credential failure is outside the committed grant transaction and cannot restore it.
      try {
        if (recovering)
          await recoverSigningPassword(
            {
              userId,
              email: certification.verified_email,
              newPassword: input.password,
            },
            deps.authentication,
          )
        else
          await deps.authentication.api.setPassword({
            headers: request.headers,
            body: { newPassword: input.password },
          })
      } catch {
        await audit(`${purpose}-credential-failed`)
        return reply(400, {
          message:
            'Credential operation failed. Request fresh independent verification before retrying.',
        })
      }
      await audit(`${purpose}-credential-completed`)
      return reply(200, { completed: true, signInAgain: recovering })
    }
    try {
      await deps.authentication.api.verifyPassword({
        headers: request.headers,
        body: { password: input.password },
      })
    } catch {
      // Commit the denial; throwing here would roll back the durable counter.
      const denied = await client.query<{ locked: boolean }>(
        `UPDATE internal.signature_password_attempts
        SET failures=failures+1,locked_until=CASE WHEN failures+1>=3 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END
        WHERE user_id=$1 RETURNING locked_until IS NOT NULL AS locked`,
        [userId],
      )
      await audit('password-failed')
      if (denied.rows[0]?.locked) {
        await audit('password-lockout-started')
        await client.query(
          `UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
        WHERE user_id=$1 AND consumed_at IS NULL`,
          [userId],
        )
      }
      await commit()
      return reply(denied.rows[0]?.locked ? 423 : 401, {
        message: denied.rows[0]?.locked
          ? 'Signing is locked for 15 minutes after three failed attempts.'
          : 'Signing password was not accepted.',
      })
    }
    await client.query(
      `UPDATE internal.signature_password_attempts SET failures=0,locked_until=NULL WHERE user_id=$1`,
      [userId],
    )
    const token = randomBytes(32).toString('base64url')
    const expiresAt = await insertGrant(client, {
      tokenHash: hash(token),
      userId,
      sessionId,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      submissionId: input.purpose === 'sign' ? input.submissionId : null,
      revisionDigest:
        input.purpose === 'sign' || input.purpose === 'author-submit'
          ? input.revisionDigest
          : null,
      recordId: input.purpose === 'author-submit' ? input.recordId : null,
      signatureMeaning:
        input.purpose === 'author-submit'
          ? 'authored'
          : input.purpose === 'sign'
            ? input.signatureMeaning
            : null,
      submissionArguments,
    })
    await audit(`${input.purpose}-password-verified`)
    await commit()
    return reply(200, { token, expiresAt, authMethod: 'password' })
  } catch (error) {
    if (transaction) await client.query('ROLLBACK')
    if (
      error instanceof Error &&
      'code' in error &&
      ['SB001', 'SB006', 'SB007', 'SB008'].includes(String(error.code))
    )
      return reply(403, {
        message:
          'The frozen revision is not eligible for this signature meaning.',
      })
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === '42501' || error.code === 'SB002')
    ) {
      return reply(403, {
        message:
          'Independent identity verification and a valid workspace session are required.',
      })
    }
    return reply(503, {
      message:
        'Signing authentication is unavailable. Check credential status before retrying; a spent authorization cannot be reused.',
    })
  } finally {
    client.release()
  }
}

async function configuredTransport(): Promise<EmailTransport | null> {
  const config = readSmtpConfig()
  return config ? createSmtpTransport(config) : null
}

async function insertGrant(
  client: PoolClient,
  input: {
    tokenHash: string
    userId: string
    sessionId: string
    workspaceId: string
    purpose: string
    authorizationId?: string
    submissionId?: string | null
    revisionDigest?: string | null
    recordId?: string | null
    signatureMeaning?: string | null
    submissionArguments?: unknown
  },
): Promise<string> {
  const result = await client.query<{ expires_at: Date }>(
    `INSERT INTO internal.signature_grants
    (token_hash,user_id,session_id,workspace_id,purpose,authorization_id,submission_id,revision_digest,record_id,signature_meaning,submission_arguments,auth_method,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'password',clock_timestamp()+interval '5 minutes') RETURNING expires_at`,
    [
      input.tokenHash,
      input.userId,
      input.sessionId,
      input.workspaceId,
      input.purpose,
      input.authorizationId ?? null,
      input.submissionId ?? null,
      input.revisionDigest ?? null,
      input.recordId ?? null,
      input.signatureMeaning ?? null,
      input.submissionArguments ?? null,
    ],
  )
  const row = result.rows.at(0)
  if (!row) throw new Error('Grant was not created')
  return row.expires_at.toISOString()
}
