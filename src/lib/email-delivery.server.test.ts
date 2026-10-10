// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSecureContext, TLSSocket } from 'node:tls'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { processEmailDeliveries, readSmtpConfig } from './email-delivery.server'
import type { EmailDeliveryRow, EmailQuery } from './email-delivery.server'

function row(id: string): EmailDeliveryRow {
  return {
    id,
    workspace_id: 'w1',
    user_id: 'u1',
    to_email: 'g@x.test',
    event_type: 'review_requested',
    subject: 'Review requested',
    body: 'body',
    attempt: 1,
  }
}

function fakeQuery(rows: EmailDeliveryRow[]) {
  const calls: string[] = []
  const query: EmailQuery = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql)
      return { rows: sql.includes('claim_due_email_deliveries') ? rows : [] }
    }) as EmailQuery['query'],
  }
  return { query, calls }
}

describe('processEmailDeliveries', () => {
  it('sends each claimed delivery and records success', async () => {
    const { query, calls } = fakeQuery([row('d1'), row('d2')])
    const send = vi.fn(async () => {})
    const result = await processEmailDeliveries(query, { send })
    expect(result).toEqual({ processed: 2, sent: 2, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      calls.filter((sql) => sql.includes('finish_email_delivery($1, true')),
    ).toHaveLength(2)
  })

  it('records a failure so the outbox schedules the backoff', async () => {
    const { query, calls } = fakeQuery([row('d1')])
    const send = vi.fn(async () => {
      throw new Error('SMTP down')
    })
    const result = await processEmailDeliveries(query, { send })
    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(
      calls.some((sql) => sql.includes('finish_email_delivery($1, false')),
    ).toBe(true)
  })
})

describe('readSmtpConfig', () => {
  it('is null without a host and full when configured', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(
      readSmtpConfig({
        SMTP_HOST: 'smtp.test',
        SMTP_PORT: '465',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    ).toEqual({
      host: 'smtp.test',
      port: 465,
      user: 'u',
      pass: 'p',
      from: 'Sheetbase <no-reply@sheetbase.local>',
    })
  })
})

const run = promisify(execFile)

describe('real SMTP TLS boundary', () => {
  let directory: string
  let certificate: Buffer
  let key: Buffer
  let wrongCertificate: Buffer
  let wrongKey: Buffer

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sheetbase-smtp-'))
    for (const hostname of ['localhost', 'other.invalid']) {
      await run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${hostname}`,
        '-addext',
        `subjectAltName=DNS:${hostname}`,
        '-keyout',
        join(directory, `${hostname}.key`),
        '-out',
        join(directory, `${hostname}.crt`),
      ])
    }
    certificate = await readFile(join(directory, 'localhost.crt'))
    key = await readFile(join(directory, 'localhost.key'))
    wrongCertificate = await readFile(join(directory, 'other.invalid.crt'))
    wrongKey = await readFile(join(directory, 'other.invalid.key'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function exchange(
    mode: 'plain' | 'trusted' | 'untrusted' | 'wrong-host' | 'old-tls',
  ) {
    const sockets = new Set<Socket>()
    const commands: string[] = []
    const messages: string[] = []
    const protocols: Array<string | null> = []
    const context = createSecureContext({
      cert: mode === 'wrong-host' ? wrongCertificate : certificate,
      key: mode === 'wrong-host' ? wrongKey : key,
      ...(mode === 'old-tls'
        ? { minVersion: 'TLSv1.1' as const, maxVersion: 'TLSv1.1' as const }
        : {}),
    })
    function receive(socket: Socket, encrypted: boolean) {
      sockets.add(socket)
      socket.on('error', () => {})
      socket.on('close', () => sockets.delete(socket))
      let buffer = ''
      let data = false
      let body = ''
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString()
        let end: number
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (data) {
            if (line === '.') {
              messages.push(body)
              data = false
              socket.write('250 accepted\r\n')
            } else {
              body += `${line}\n`
            }
            continue
          }
          commands.push(line)
          if (line.startsWith('EHLO')) {
            socket.write(
              mode !== 'plain' && !encrypted
                ? '250-fixture\r\n250 STARTTLS\r\n'
                : '250 fixture\r\n',
            )
          } else if (line === 'STARTTLS' && mode !== 'plain') {
            socket.write('220 upgrade\r\n')
            socket.removeListener('data', onData)
            const secure = new TLSSocket(socket, {
              isServer: true,
              secureContext: context,
            })
            secure.on('secure', () => protocols.push(secure.getProtocol()))
            receive(secure, true)
            return
          } else if (
            line.startsWith('MAIL FROM:') ||
            line.startsWith('RCPT TO:')
          ) {
            socket.write('250 accepted\r\n')
          } else if (line === 'DATA') {
            data = true
            socket.write('354 data\r\n')
          } else if (line === 'QUIT') {
            socket.end('221 goodbye\r\n')
          } else {
            socket.write('502 unavailable\r\n')
          }
        }
      }
      socket.on('data', onData)
    }
    const server = createServer((socket) => {
      receive(socket, false)
      socket.write('220 fixture\r\n')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No SMTP port')
    // A separate Node process loads the real transport. NODE_EXTRA_CA_CERTS
    // supplies fixture trust at startup without relaxing certificate checks.
    const moduleUrl = new URL('./email-delivery.server.ts', import.meta.url)
      .href
    const code = `
      import { createSmtpTransport } from ${JSON.stringify(moduleUrl)};
      try {
        const transport = await createSmtpTransport({
          host: 'localhost', port: ${address.port}, user: null, pass: null,
          from: 'sender@sheetbase.test'
        });
        await transport.send({to:'recipient@sheetbase.test', subject:'TLS fixture', body:'Only over verified TLS'});
        console.log(JSON.stringify({ok:true}));
      } catch (error) {
        console.log(JSON.stringify({ok:false, code:error.code}));
      }
    `
    try {
      const { stdout } = await run(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', code],
        {
          env: {
            ...process.env,
            NODE_EXTRA_CA_CERTS:
              mode === 'untrusted'
                ? ''
                : join(
                    directory,
                    mode === 'wrong-host'
                      ? 'other.invalid.crt'
                      : 'localhost.crt',
                  ),
          },
          timeout: 10_000,
        },
      )
      const result: { ok: boolean; code?: string } = JSON.parse(stdout.trim())
      return { result, commands, messages, protocols }
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('refuses plaintext SMTP before sending any message', async () => {
    const outcome = await exchange('plain')
    expect(outcome.result.ok).toBe(false)
    expect(outcome.messages).toEqual([])
    expect(
      outcome.commands.some((command) => command.startsWith('MAIL FROM:')),
    ).toBe(false)
  })

  it('sends over STARTTLS with a trusted certificate', async () => {
    const outcome = await exchange('trusted')
    expect(outcome.result).toEqual({ ok: true })
    expect(outcome.protocols).toHaveLength(1)
    expect(['TLSv1.2', 'TLSv1.3']).toContain(outcome.protocols[0])
    expect(outcome.messages).toHaveLength(1)
    expect(outcome.messages[0]).toContain('Only over verified TLS')
  })

  it.each(['untrusted', 'wrong-host', 'old-tls'] as const)(
    'refuses %s TLS without plaintext fallback',
    async (mode) => {
      const outcome = await exchange(mode)
      expect(outcome.result.ok).toBe(false)
      expect(outcome.messages).toEqual([])
      expect(
        outcome.commands.some((command) => command.startsWith('MAIL FROM:')),
      ).toBe(false)
    },
  )
})
