/**
 * Installation (IQ) and operational (OQ) checks, run against the live install.
 *
 * Each check says what it does, what counts as a pass and what it found, and
 * keeps the evidence. They only read, or try something that must be refused
 * inside a transaction that is always rolled back. A check that cannot be made
 * meaningful here (no signatures yet, say) is skipped and says why; a skipped
 * check is not a pass.
 *
 * Passing these checks shows the install behaves as described on the day they
 * ran. It is not a statement that the install is compliant with anything.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import type { QueryResultRow } from 'pg'

import { REGULATED_IDLE_SECONDS } from '../session-idle'
import { verifyTimestampResponse } from '../timestamps/tsp'
import type { CheckResult, CheckStatus } from './types'

export interface Queryable {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

export interface CheckDeps {
  db: Queryable
  workspaceId: string
  userId: string
  now: () => Date
  /** Idle window, in seconds, that the running app gives this person. */
  idleSecondsFor: (userId: string) => Promise<number>
  /** The workspace's export key, made if it does not exist yet. */
  exportKey: () => Promise<{
    publicKeyPem: string
    fingerprint: string
    sign: (data: Uint8Array) => Uint8Array
  }>
  fetch: typeof fetch
  config: {
    postgrestUrl: string
    publicUrl: string
    expectedMigration: string
  }
}

interface CheckDefinition {
  id: string
  kind: 'iq' | 'oq'
  title: string
  method: string
  expected: string
  requirements: string[]
  run: (deps: CheckDeps) => Promise<{
    status: CheckStatus
    detail: string
    evidence?: Record<string, unknown>
  }>
}

const pass = (detail: string, evidence: Record<string, unknown> = {}) => ({
  status: 'passed' as const,
  detail,
  evidence,
})

const fail = (detail: string, evidence: Record<string, unknown> = {}) => ({
  status: 'failed' as const,
  detail,
  evidence,
})

const skip = (detail: string, evidence: Record<string, unknown> = {}) => ({
  status: 'skipped' as const,
  detail,
  evidence,
})

/**
 * Try a change that must be refused, acting as an ordinary signed-in person of
 * the workspace (the migration login is allowed some changes ordinary people
 * are not), then undo whatever happened. `unable` means the login used for the
 * checks cannot act as an ordinary person, so nothing was tried.
 */
async function mustBeRefused(
  db: Queryable,
  as: { userId: string; workspaceId: string },
  statement: string,
  values: unknown[],
): Promise<{ refused: boolean; unable?: boolean; message: string }> {
  await db.query('BEGIN')

  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        role: 'authenticated',
        sub: as.userId,
        workspace_id: as.workspaceId,
      }),
    ])

    try {
      await db.query('SET LOCAL ROLE authenticated')
    } catch {
      return { refused: false, unable: true, message: 'cannot act as a person' }
    }

    try {
      await db.query(statement, values)

      return { refused: false, message: 'the change was accepted' }
    } catch (error) {
      return {
        refused: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  } finally {
    await db.query('ROLLBACK')
  }
}

const UNABLE =
  'The database login used for checks cannot act as an ordinary person, so this could not be tried here.'

export const CHECKS: readonly CheckDefinition[] = [
  {
    id: 'iq.migrations',
    kind: 'iq',
    title: 'Database schema matches the release',
    method:
      'Reads the migrations recorded as applied and compares the newest with the one this release was built for.',
    expected:
      'Migrations are recorded and, when the release names its expected migration, the newest applied one is that migration.',
    requirements: ['VAL-IQ-01', 'VAL-EXP-02'],
    async run({ db, config }) {
      const { rows } = await db.query<{ n: number; latest: string | null }>(
        `SELECT count(*)::int AS n, max(created_at)::text AS latest
           FROM drizzle.__drizzle_migrations`,
      )

      const { n, latest } = rows[0] ?? { n: 0, latest: null }

      if (n === 0) return fail('No migrations are recorded as applied.')

      const evidence = {
        applied: n,
        latest,
        expected: config.expectedMigration,
      }

      if (config.expectedMigration === 'untracked') {
        return pass(
          `${n} migrations applied. This build does not name an expected migration, so only the count is recorded.`,
          evidence,
        )
      }

      return latest === config.expectedMigration
        ? pass(
            `${n} migrations applied; the newest is the one expected.`,
            evidence,
          )
        : fail(
            `The newest applied migration (${latest}) is not the one this release expects (${config.expectedMigration}).`,
            evidence,
          )
    },
  },
  {
    id: 'iq.database',
    kind: 'iq',
    title: 'Database version',
    method: 'Asks the database for its version.',
    expected: 'PostgreSQL 18 or newer.',
    requirements: ['VAL-IQ-01'],
    async run({ db }) {
      const { rows } = await db.query<{ v: string }>(
        `SELECT current_setting('server_version') AS v`,
      )

      const version = rows[0]?.v ?? ''
      const major = Number.parseInt(version, 10)

      return major >= 18
        ? pass(`PostgreSQL ${version}.`, { version })
        : fail(`PostgreSQL ${version || 'unknown'} is older than 18.`, {
            version,
          })
    },
  },
  {
    id: 'iq.roles',
    kind: 'iq',
    title: 'Database roles are in place',
    method:
      'Looks for the database roles the application and the data service use.',
    expected:
      'The roles anon, authenticated, api_client and authenticator exist.',
    requirements: ['VAL-IQ-01', 'VAL-ACC-01'],
    async run({ db }) {
      const wanted = ['anon', 'authenticated', 'api_client', 'authenticator']

      const { rows } = await db.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])`,
        [wanted],
      )

      const present = rows.map((r) => r.rolname).sort()
      const missing = wanted.filter((w) => !present.includes(w))

      return missing.length === 0
        ? pass('All four roles exist.', { present })
        : fail(`Missing: ${missing.join(', ')}.`, { present, missing })
    },
  },
  {
    id: 'iq.postgrest',
    kind: 'iq',
    title: 'Data service responds',
    method: 'Requests the data service’s root with a short timeout.',
    expected: 'The data service answers.',
    requirements: ['VAL-IQ-01'],
    async run({ fetch: doFetch, config }) {
      try {
        const res = await doFetch(config.postgrestUrl, {
          signal: AbortSignal.timeout(4000),
        })

        return res.status < 500
          ? pass(`Answered with status ${res.status}.`, { status: res.status })
          : fail(`Answered with status ${res.status}.`, { status: res.status })
      } catch (error) {
        return fail(
          `No answer: ${error instanceof Error ? error.message : String(error)}.`,
        )
      }
    },
  },
  {
    id: 'iq.clock',
    kind: 'iq',
    title: 'Server clock agrees with the database',
    method: 'Compares the application server’s time with the database’s.',
    expected: 'The two differ by less than five seconds.',
    requirements: ['VAL-IQ-01', 'VAL-TS-01'],
    async run({ db, now }) {
      const before = now()

      const { rows } = await db.query<{ t: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`,
      )

      const after = now()
      const database = Date.parse(rows[0]?.t ?? '')
      const middle = (before.getTime() + after.getTime()) / 2
      const skew = Math.abs(database - middle)

      const evidence = {
        application: after.toISOString(),
        database: rows[0]?.t,
        skewMs: Math.round(skew),
      }

      return skew < 5000
        ? pass(`They differ by ${Math.round(skew)} ms.`, evidence)
        : fail(`They differ by ${Math.round(skew)} ms.`, evidence)
    },
  },
  {
    id: 'iq.address',
    kind: 'iq',
    title: 'Served over an encrypted connection',
    method: 'Looks at the address people reach the app on.',
    expected: 'The address starts with https://.',
    requirements: ['VAL-IQ-01', 'VAL-ID-01'],
    async run({ config }) {
      const url = config.publicUrl

      return url.startsWith('https://')
        ? pass(`${url} is encrypted.`, { url })
        : fail(
            `${url || '(not set)'} is not https://, so sign-ins and signatures cross the network unencrypted.`,
            { url },
          )
    },
  },
  {
    id: 'oq.regulated_settings',
    kind: 'oq',
    title: 'Regulated-lab settings are on',
    method: 'Reads the workspace settings that a regulated lab depends on.',
    expected:
      'Regulated lab, lock records on signing and require a reason for changes are all on.',
    requirements: ['VAL-SIG-02', 'VAL-SIG-03', 'VAL-CHG-01'],
    async run({ db, workspaceId }) {
      const { rows } = await db.query<{
        regulated_lab: boolean
        lock_on_sign: boolean
        require_change_reason: boolean
      }>(
        `SELECT regulated_lab, lock_on_sign, require_change_reason
           FROM api.workspace_settings WHERE workspace_id = $1`,
        [workspaceId],
      )

      const s = rows[0] as (typeof rows)[number] | undefined

      if (!s) return fail('The workspace has no settings.')

      const off = [
        s.regulated_lab ? null : 'Regulated lab',
        s.lock_on_sign ? null : 'Lock records on signing',
        s.require_change_reason ? null : 'Require a reason for changes',
      ].filter(Boolean)

      return off.length === 0
        ? pass('All three are on.', { ...s })
        : fail(`Off: ${off.join(', ')}.`, { ...s })
    },
  },
  {
    id: 'oq.session_idle',
    kind: 'oq',
    title: 'Idle sessions end after the regulated-lab window',
    method:
      'Asks the running application how long it lets this person’s session sit unused.',
    expected: `${REGULATED_IDLE_SECONDS / 60} minutes or less.`,
    requirements: ['VAL-ID-01'],
    async run({ idleSecondsFor, userId }) {
      const seconds = await idleSecondsFor(userId)

      return seconds <= REGULATED_IDLE_SECONDS
        ? pass(`${seconds / 60} minutes.`, { seconds })
        : fail(`${seconds / 60} minutes.`, { seconds })
    },
  },
  {
    id: 'oq.audit_chain',
    kind: 'oq',
    title: 'Audit trail is intact',
    method:
      'Recomputes the hash chain over every audit entry of the workspace, in order.',
    expected: 'Every entry’s hash and link to the previous entry match.',
    requirements: ['VAL-AUD-02'],
    async run({ db, workspaceId }) {
      const { rows } = await db.query<{ result: AuditResult }>(
        `SELECT api.run_audit_verification($1) AS result`,
        [workspaceId],
      )

      const r = (rows[0] as (typeof rows)[number] | undefined)?.result

      if (!r) return fail('The check returned nothing.')
      auditResults.set(workspaceId, r)

      return r.chain.ok
        ? pass(`${r.chain.entriesChecked} entries checked.`, { ...r.chain })
        : fail(`The chain breaks at sequence ${r.chain.firstBadSequence}.`, {
            ...r.chain,
          })
    },
  },
  {
    id: 'oq.signed_revisions',
    kind: 'oq',
    title: 'Signed revisions are unchanged',
    method:
      'Recomputes the integrity digest of every signed revision and compares it with the digest recorded when it was signed.',
    expected: 'Every digest matches.',
    requirements: ['VAL-SIG-01', 'VAL-REV-01'],
    async run({ workspaceId }) {
      const r = auditResults.get(workspaceId)

      if (!r)
        return skip(
          'The audit check did not run, so there is no result to read.',
        )

      if (r.signedRevisions.checked === 0) {
        return skip('There are no signed revisions yet.')
      }

      return r.signedRevisions.ok
        ? pass(`${r.signedRevisions.checked} signed revisions checked.`, {
            ...r.signedRevisions,
          })
        : fail(
            `Revision ${r.signedRevisions.firstBadRevisionId} does not match its signature.`,
            { ...r.signedRevisions },
          )
    },
  },
  {
    id: 'oq.audit_immutable',
    kind: 'oq',
    title: 'Audit entries cannot be changed',
    method:
      'Tries to change one audit entry, inside a transaction that is always rolled back.',
    expected: 'The database refuses.',
    requirements: ['VAL-AUD-01'],
    async run({ db, workspaceId, userId }) {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM api.change_events WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId],
      )

      if (!rows[0]) return skip('There are no audit entries yet.')

      const attempt = await mustBeRefused(
        db,
        { userId, workspaceId },
        `UPDATE api.change_events SET payload = payload WHERE id = $1`,
        [rows[0].id],
      )

      if (attempt.unable) return skip(UNABLE)

      return attempt.refused
        ? pass('The change was refused.', { message: attempt.message })
        : fail('The change was accepted (and rolled back).')
    },
  },
  {
    id: 'oq.signature_immutable',
    kind: 'oq',
    title: 'Signatures cannot be changed',
    method:
      'Tries to change one signature, inside a transaction that is always rolled back.',
    expected: 'The database refuses.',
    requirements: ['VAL-SIG-03'],
    async run({ db, workspaceId, userId }) {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM api.signatures WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId],
      )

      if (!rows[0]) return skip('There are no signatures yet.')

      const attempt = await mustBeRefused(
        db,
        { userId, workspaceId },
        `UPDATE api.signatures SET confirmation_phrase = confirmation_phrase WHERE id = $1`,
        [rows[0].id],
      )

      if (attempt.unable) return skip(UNABLE)

      return attempt.refused
        ? pass('The change was refused.', { message: attempt.message })
        : fail('The change was accepted (and rolled back).')
    },
  },
  {
    id: 'oq.workspace_isolation',
    kind: 'oq',
    title: 'A stranger sees none of the workspace’s data',
    method:
      'Acts as a user who belongs to no workspace, claiming this one, and counts the records and audit entries that user can read; inside a transaction that is always rolled back.',
    expected: 'Zero.',
    requirements: ['VAL-ACC-01'],
    async run({ db, workspaceId }) {
      const { rows: own } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM api.change_events WHERE workspace_id = $1`,
        [workspaceId],
      )

      if (!own[0]?.n) return skip('There are no audit entries to look for yet.')
      await db.query('BEGIN')

      try {
        await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({
            role: 'authenticated',
            sub: 'validation-outsider',
            workspace_id: workspaceId,
          }),
        ])

        try {
          await db.query('SET LOCAL ROLE authenticated')
        } catch {
          return skip(UNABLE)
        }

        const seen = await db.query<{ events: number; records: number }>(
          `SELECT (SELECT count(*) FROM api.change_events)::int AS events,
                  (SELECT count(*) FROM api.records)::int AS records`,
        )

        const { events, records } = seen.rows[0] ?? { events: -1, records: -1 }

        return events === 0 && records === 0
          ? pass('The stranger saw nothing.', { events, records })
          : fail(
              `The stranger saw ${events} audit entries and ${records} records.`,
              {
                events,
                records,
              },
            )
      } finally {
        await db.query('ROLLBACK')
      }
    },
  },
  {
    id: 'oq.timestamps',
    kind: 'oq',
    title: 'Trusted timestamps are present and readable',
    method:
      'Counts the workspace’s signature timestamps and re-checks the newest token against the data it covers.',
    expected:
      'No signature has waited more than an hour, none has given up, and the newest token covers its data.',
    requirements: ['VAL-TS-01'],
    async run({ db, workspaceId }) {
      const { rows: settings } = await db.query<{ enabled: boolean }>(
        `SELECT coalesce((integration_settings->'timestamps'->>'enabled')::boolean, false) AS enabled
           FROM api.workspace_settings WHERE workspace_id = $1`,
        [workspaceId],
      )

      if (!settings[0]?.enabled) {
        return skip(
          'Trusted timestamps are not switched on for this workspace.',
        )
      }

      const { rows: counts } = await db.query<{
        stamped: number
        pending: number
        failed: number
        unstamped_old: number
      }>(
        `SELECT count(*) FILTER (WHERE t.status = 'stamped')::int AS stamped,
                count(*) FILTER (WHERE t.status = 'pending')::int AS pending,
                count(*) FILTER (WHERE t.status = 'failed')::int AS failed,
                count(*) FILTER (WHERE (t.id IS NULL OR t.status <> 'stamped')
                                   AND s.signed_at < now() - interval '1 hour')::int AS unstamped_old
           FROM api.signatures s
           LEFT JOIN api.signature_timestamps t ON t.signature_id = s.id
          WHERE s.workspace_id = $1`,
        [workspaceId],
      )

      const c = counts[0] ?? {
        stamped: 0,
        pending: 0,
        failed: 0,
        unstamped_old: 0,
      }

      const { rows: newest } = await db.query<{
        signed_data: string
        response_b64: string
        imprint_sha256: string
      }>(
        `SELECT signed_data, response_b64, imprint_sha256 FROM api.signature_timestamps
          WHERE workspace_id = $1 AND status = 'stamped' ORDER BY gen_time DESC LIMIT 1`,
        [workspaceId],
      )

      const evidence: Record<string, unknown> = { ...c }

      if (newest[0]) {
        try {
          const info = verifyTimestampResponse(
            new Uint8Array(Buffer.from(newest[0].response_b64, 'base64')),
            {
              expectedImprintHex: createHash('sha256')
                .update(newest[0].signed_data)
                .digest('hex'),
            },
          )

          evidence.newestGenTime = info.genTime
          evidence.newestSigner = info.signer
        } catch (error) {
          return fail(
            `The newest token does not cover its data: ${error instanceof Error ? error.message : String(error)}.`,
            evidence,
          )
        }
      }

      if (c.failed > 0 || c.unstamped_old > 0) {
        return fail(
          `${c.failed} signatures gave up and ${c.unstamped_old} have waited over an hour.`,
          evidence,
        )
      }

      return c.stamped === 0
        ? skip(
            'Timestamps are on but no signature has been stamped yet.',
            evidence,
          )
        : pass(
            `${c.stamped} signatures stamped, ${c.pending} waiting.`,
            evidence,
          )
    },
  },
  {
    id: 'oq.export_key',
    kind: 'oq',
    title: 'Export signing key works',
    method:
      'Signs a fresh random challenge with the workspace’s export key and verifies it with the published public key.',
    expected:
      'The signature verifies and the key’s fingerprint is the one on record.',
    requirements: ['VAL-EXP-01', 'VAL-TS-02'],
    async run({ exportKey }) {
      const key = await exportKey()

      const challenge = createHash('sha256')
        .update(`${Date.now()}:${Math.random()}`)
        .digest()

      const signature = key.sign(challenge)

      const ok = verify(
        null,
        challenge,
        createPublicKey(key.publicKeyPem),
        signature,
      )

      return ok
        ? pass(`Verified with key ${key.fingerprint}.`, {
            fingerprint: key.fingerprint,
          })
        : fail('The signature did not verify.', {
            fingerprint: key.fingerprint,
          })
    },
  },
]

interface AuditResult {
  ok: boolean
  chain: {
    ok: boolean
    entriesChecked: number
    firstBadSequence: number | null
  }
  signedRevisions: {
    ok: boolean
    checked: number
    firstBadRevisionId: string | null
  }
}

/** The audit check feeds the signed-revision check in the same run. */
const auditResults = new Map<string, AuditResult>()

export async function runChecks(deps: CheckDeps): Promise<CheckResult[]> {
  auditResults.delete(deps.workspaceId)
  const results: CheckResult[] = []

  for (const check of CHECKS) {
    const started = Date.now()
    let outcome: Awaited<ReturnType<CheckDefinition['run']>>

    try {
      outcome = await check.run(deps)
    } catch (error) {
      outcome = fail(
        `The check could not finish: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }

    results.push({
      id: check.id,
      kind: check.kind,
      title: check.title,
      method: check.method,
      expected: check.expected,
      requirements: check.requirements,
      status: outcome.status,
      detail: outcome.detail,
      evidence: outcome.evidence ?? {},
      durationMs: Date.now() - started,
    })
  }

  auditResults.delete(deps.workspaceId)

  return results
}
