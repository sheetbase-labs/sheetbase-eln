/**
 * What the runner does for plugin Python: each plugin's own limits, its own
 * installed packages, and the allow-listing proxy that is the only way out.
 *
 * Docker itself is not run here (there is none in the test environment); the
 * broker's Docker commands go to a fake that records them, and the proxy is
 * exercised over real sockets.
 */
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  buildEnvironment,
  buildFailureMessage,
  containerArguments,
  createEnvironments,
  environmentDockerfile,
  environmentId,
  limitsOf,
  PLUGIN_HOST,
  PLUGIN_REQUIREMENT,
  RunnerError,
  runDockerJob,
  validateJob,
  validateRequirements,
} from './pipeline-python-runner.mjs'
import {
  createEgressProxy,
  hostAllowed,
  isPrivateAddress,
} from './pipeline-python-egress.mjs'
import {
  hostProblem,
  requirementProblem,
} from '../src/lib/extensions/runtime-config'

const BASE = `python@sha256:${'a'.repeat(64)}`
const ENV_IMAGE_ID = `sha256:${'b'.repeat(64)}`

const limits = {
  timeoutSeconds: 900,
  memoryMb: 8192,
  cpus: 4,
  processes: 1024,
  scratchMb: 4096,
  bytes: 256 * 1024 * 1024,
  rows: 5_000_000,
}

const job = (extra: Record<string, unknown> = {}) => ({
  statement: 'def transform(i, p):\n    return []\n',
  inputs: {},
  parameters: {},
  ...extra,
})

describe('a plugin call carries its own limits', () => {
  it('replaces the fixed pipeline limits', () => {
    const plugin = limitsOf(job({ limits }))
    expect(plugin).toMatchObject({
      custom: true,
      rows: 5_000_000,
      timeoutMs: 900_000,
      memoryMb: 8192,
      cpus: 4,
    })
    expect(plugin.cells).toBe(Infinity)
    expect(plugin.fields).toBe(Infinity)
    expect(limitsOf(job())).toMatchObject({
      custom: false,
      rows: 100_000,
      memoryMb: 512,
      timeoutMs: 60_000,
    })
  })

  it('accepts what a pipeline step would be refused', () => {
    const rows = Array.from({ length: 150_000 }, (_, index) => ({ n: index }))
    expect(() => validateJob(job({ inputs: { data: rows } }))).toThrow(
      /row limit/,
    )
    expect(() =>
      validateJob(job({ inputs: { data: rows }, limits })),
    ).not.toThrow()
    // A plugin's files travel in the statement; they are bounded by its data limit instead.
    expect(() =>
      validateJob(job({ statement: `x = 1\n${'#'.repeat(200_000)}`, limits })),
    ).not.toThrow()
    expect(() =>
      validateJob(job({ statement: `x = 1\n${'#'.repeat(200_000)}` })),
    ).toThrow(RunnerError)
  })

  it('refuses limits that are not positive numbers', () => {
    expect(() =>
      validateJob(job({ limits: { ...limits, memoryMb: 0 } })),
    ).toThrow(/positive numbers/)
    expect(() =>
      validateJob(job({ limits: { ...limits, rows: 'many' } })),
    ).toThrow(RunnerError)
  })

  it('takes packages and hosts only from a call that has limits', () => {
    const environment = 'pe-0123456789abcdef'
    expect(() => validateJob(job({ environment }))).toThrow(RunnerError)
    expect(() => validateJob(job({ environment, limits }))).not.toThrow()
    expect(() => validateJob(job({ environment: 'rdkit', limits }))).toThrow(
      /not a valid name/,
    )
    expect(() =>
      validateJob(job({ network: ['eutils.ncbi.nlm.nih.gov'], limits })),
    ).not.toThrow()
    expect(() => validateJob(job({ network: ['localhost'], limits }))).toThrow(
      /host names/,
    )
    expect(() => validateJob(job({ network: ['example.org'] }))).toThrow(
      RunnerError,
    )
  })
})

describe('containerArguments', () => {
  it('keeps the pipeline defaults for a step with no limits of its own', () => {
    const args = containerArguments(BASE, 'c1')
    expect(args).toContain('--memory=512m')
    expect(args).toContain('--pids-limit=64')
    expect(args).toContain('--network=none')
    expect(args.some((a: string) => a.startsWith('--env=HTTPS_PROXY'))).toBe(
      false,
    )
  })

  it('applies a plugin’s limits', () => {
    const args = containerArguments(BASE, 'c1', {
      limits: limitsOf(job({ limits })),
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '--memory=8192m',
        '--memory-swap=8192m',
        '--cpus=4',
        '--pids-limit=1024',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=4096m,mode=1777',
        '--env=OMP_NUM_THREADS=4',
        `--env=SHEETBASE_MAX_INPUT_BYTES=${256 * 1024 * 1024}`,
        '--network=none',
      ]),
    )
    // The sandbox itself is unchanged.
    expect(args).toEqual(
      expect.arrayContaining([
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges=true',
      ]),
    )
  })

  it('puts a plugin with approved hosts on the egress network, behind the proxy', () => {
    const args = containerArguments(BASE, 'c1', {
      limits: limitsOf(job({ limits })),
      egress: {
        network: 'sheetbase-egress',
        url: 'http://job:tok@runner:3128',
      },
    })
    expect(args).toContain('--network=sheetbase-egress')
    expect(args).toContain('--env=HTTPS_PROXY=http://job:tok@runner:3128')
    expect(args).toContain('--env=http_proxy=http://job:tok@runner:3128')
    expect(args).not.toContain('--network=none')
  })

  it('runs from an environment image by its id', () => {
    expect(containerArguments(ENV_IMAGE_ID, 'c1')).toContain(ENV_IMAGE_ID)
    expect(() => containerArguments('python:latest', 'c1')).toThrow(RunnerError)
  })
})

describe('environments', () => {
  it('names the same packages on the same image the same, whatever the order', () => {
    const a = environmentId(BASE, ['rdkit>=2024.3', 'biopython==1.84'])
    expect(environmentId(BASE, ['biopython==1.84', 'rdkit>=2024.3'])).toBe(a)
    expect(a).toMatch(/^pe-[a-f0-9]{16}$/)
    expect(environmentId(BASE, ['rdkit>=2024.4', 'biopython==1.84'])).not.toBe(
      a,
    )
    expect(
      environmentId(`python@sha256:${'c'.repeat(64)}`, [
        'rdkit>=2024.3',
        'biopython==1.84',
      ]),
    ).not.toBe(a)
  })

  it('writes only pip requirement lines, never an option', () => {
    expect(() => validateRequirements(['rdkit>=2024.3'])).not.toThrow()
    for (const bad of [
      '--index-url https://evil.example',
      '-r other.txt',
      'rdkit\n--index-url https://evil.example',
      'rdkit --hash=sha256:00',
      'not a package',
      '',
    ])
      expect(() => validateRequirements([bad]), bad).toThrow(RunnerError)
    expect(() => validateRequirements([])).toThrow(RunnerError)
  })

  it('agrees with the app on what a package line and a host look like', () => {
    const lines = [
      'rdkit',
      'rdkit>=2024.3',
      'biopython==1.84',
      'pandas[performance]>=2,<3',
      'scikit-learn~=1.5; python_version >= "3.10"',
      'mytool @ https://example.org/mytool-1.0.tar.gz',
      '--index-url https://evil.example',
      '-r other.txt',
      'not a package',
      'a;b;c',
      'x @ git+https://example.org/x.git',
      '',
    ]
    for (const line of lines)
      expect(PLUGIN_REQUIREMENT.test(line.trim()), line).toBe(
        requirementProblem(line) === null,
      )
    const hosts = [
      'eutils.ncbi.nlm.nih.gov',
      '*.ebi.ac.uk',
      'localhost',
      'https://x.org',
      'x.org/path',
      'x.org:8080',
      'UPPER.example.org',
      '*.org',
      'a..b.org',
    ]
    for (const host of hosts)
      expect(PLUGIN_HOST.test(host), host).toBe(hostProblem(host) === null)
  })

  it('builds from the worker image with the plugin’s packages, with network', async () => {
    const written: Record<string, string> = {}
    const command = vi.fn(
      async (args: string[], options?: Record<string, unknown>) => {
        const folder = args.at(-1)!
        written.requirements = readFileSync(
          `${folder}/requirements.txt`,
          'utf8',
        )
        written.dockerfile = readFileSync(`${folder}/Dockerfile`, 'utf8')
        written.options = JSON.stringify(options)
        return { code: 0, stdout: '', stderr: '' }
      },
    )
    const id = await buildEnvironment(
      ['rdkit>=2024.3', 'biopython==1.84'],
      BASE,
      command,
      { pipIndexUrl: undefined },
    )
    expect(id).toBe(environmentId(BASE, ['rdkit>=2024.3', 'biopython==1.84']))
    const args = command.mock.calls[0][0]
    expect(args[0]).toBe('build')
    expect(args).toContain(`sheetbase-plugin-env:${id}`)
    expect(args).toContain(`BASE=${BASE}`)
    expect(args).not.toContain('--network=none')
    expect(written.requirements).toBe('rdkit>=2024.3\nbiopython==1.84\n')
    expect(written.dockerfile).toContain('pip install --no-cache-dir -r')
    expect(written.dockerfile).toContain('USER 65532:65532')
    // The time to build is the operator’s setting, not a fixed cap.
    expect(JSON.parse(written.options).timeoutMs).toBe(60 * 60_000)
  })

  it('points pip at a mirror when the operator set one', async () => {
    const command = vi.fn(async (_args: string[]) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }))
    await buildEnvironment(['rdkit'], BASE, command, {
      pipIndexUrl: 'https://pypi.example.org/simple',
    })
    expect(command.mock.calls[0][0]).toContain(
      'PIP_INDEX_URL=https://pypi.example.org/simple',
    )
    expect(environmentDockerfile({ pipIndexUrl: 'x' })).toContain(
      'ARG PIP_INDEX_URL',
    )
    expect(environmentDockerfile()).not.toContain('PIP_INDEX_URL')
  })

  it('says what pip said when a package cannot be installed', async () => {
    const stderr = [
      '#7 3.2 Collecting not-a-real-package',
      '#7 3.9 ERROR: Could not find a version that satisfies the requirement not-a-real-package (from versions: none)',
      '#7 3.9 ERROR: No matching distribution found for not-a-real-package',
    ].join('\n')
    await expect(
      buildEnvironment(['not-a-real-package'], BASE, async () => ({
        code: 1,
        stdout: '',
        stderr,
      })),
    ).rejects.toThrow(/No matching distribution found for not-a-real-package/)
    expect(buildFailureMessage('')).toMatch(/could not be installed/)
  })

  it('builds in the background and reports where it stands', async () => {
    let built = false
    const command = vi.fn(async (args: string[]) => {
      if (args[0] === 'image') {
        return built
          ? { code: 0, stdout: `${ENV_IMAGE_ID}\n`, stderr: '' }
          : { code: 1, stdout: '', stderr: 'No such image' }
      }
      if (args[0] === 'build') {
        built = true
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const environments = createEnvironments({
      image: BASE,
      command,
      inspect: async () => ({
        python: '3.12.4',
        packages: { rdkit: '2024.9.1', numpy: '2.2.6' },
      }),
    })
    const first = await environments.ensure(['rdkit>=2024.3'])
    expect(first.state).toBe('building')
    await environments.idle()
    expect(await environments.status(first.id)).toEqual({
      id: first.id,
      state: 'ready',
      packages: { rdkit: '2024.9.1', numpy: '2.2.6' },
    })
    // Asking again for the same packages builds nothing more.
    const builds = command.mock.calls.filter(([args]) => args[0] === 'build')
    expect((await environments.ensure(['rdkit>=2024.3'])).state).toBe('ready')
    expect(command.mock.calls.filter(([args]) => args[0] === 'build')).toEqual(
      builds,
    )
  })

  it('keeps a failed build’s reason, and builds again when asked again', async () => {
    let attempt = 0
    const command = vi.fn(async (args: string[]) => {
      if (args[0] === 'image') return { code: 1, stdout: '', stderr: '' }
      attempt += 1
      return attempt === 1
        ? {
            code: 1,
            stdout: '',
            stderr: 'ERROR: No matching distribution found for x',
          }
        : { code: 0, stdout: '', stderr: '' }
    })
    const environments = createEnvironments({
      image: BASE,
      command,
      inspect: async () => undefined,
    })
    const first = await environments.ensure(['x'])
    await environments.idle()
    expect(await environments.status(first.id)).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('No matching distribution'),
    })
    expect((await environments.ensure(['x'])).state).toBe('building')
    await environments.idle()
    expect(attempt).toBe(2)
  })
})

describe('runDockerJob for a plugin', () => {
  function docker(options: { environmentBuilt?: boolean } = {}) {
    return vi.fn(async (args: string[], _options?: Record<string, unknown>) => {
      if (args[0] === 'image')
        return options.environmentBuilt === false
          ? { code: 1, stdout: '', stderr: 'No such image' }
          : { code: 0, stdout: `${ENV_IMAGE_ID}\n`, stderr: '' }
      if (args[0] === 'start')
        return {
          code: 0,
          stdout: JSON.stringify({ rows: [{ a: 1 }], logs: ['hi'] }),
          stderr: '',
        }
      return { code: 0, stdout: '', stderr: '' }
    })
  }

  it('runs from the plugin’s own image with its limits and reports that image', async () => {
    const command = docker()
    const result = await runDockerJob(
      job({ limits, environment: 'pe-0123456789abcdef' }),
      BASE,
      command,
    )
    const create = command.mock.calls.find(([args]) => args[0] === 'create')![0]
    expect(create).toContain(ENV_IMAGE_ID)
    expect(create).toContain('--memory=8192m')
    const start = command.mock.calls.find(([args]) => args[0] === 'start')!
    expect(start[1]).toMatchObject({ timeoutMs: 900_000 })
    expect(result.runtime).toBe(`sheetbase-plugin-env@${ENV_IMAGE_ID}`)
    expect(result.rows).toEqual([{ a: 1 }])
  })

  it('says so when the packages are not on this runner', async () => {
    await expect(
      runDockerJob(
        job({ limits, environment: 'pe-0123456789abcdef' }),
        BASE,
        docker({ environmentBuilt: false }),
      ),
    ).rejects.toMatchObject({ code: 'environment_not_ready', status: 409 })
  })

  it('refuses approved hosts on a runner with no egress network, instead of running without them', async () => {
    await expect(
      runDockerJob(
        job({ limits, network: ['example.org'] }),
        BASE,
        docker(),
        {},
      ),
    ).rejects.toMatchObject({ code: 'network_unavailable', status: 503 })
  })

  it('gives the call its own proxy credential and takes it back afterwards', async () => {
    const command = docker()
    const proxy = createEgressProxy()
    let during = -1
    const spied = vi.fn(
      async (args: string[], options?: Record<string, unknown>) => {
        if (args[0] === 'start') during = proxy.activeGrants
        return command(args, options)
      },
    )
    await runDockerJob(
      job({ limits, network: ['eutils.ncbi.nlm.nih.gov'] }),
      BASE,
      spied,
      {
        proxy,
        egress: { network: 'sheetbase-egress', host: 'runner', port: 3128 },
      },
    )
    const create = command.mock.calls.find(([args]) => args[0] === 'create')![0]
    expect(create).toContain('--network=sheetbase-egress')
    expect(
      create.find((a: string) => a.startsWith('--env=HTTPS_PROXY=http://job:')),
    ).toMatch(/@runner:3128$/)
    expect(during).toBe(1)
    expect(proxy.activeGrants).toBe(0)
  })

  it('names the limit that was hit', async () => {
    const command = vi.fn(async (args: string[]) => {
      if (args[0] === 'start') return { code: 137, stdout: '', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    })
    await expect(runDockerJob(job({ limits }), BASE, command)).rejects.toThrow(
      /run out of memory.*Settings → Plugins/,
    )
  })
})

describe('the egress proxy', () => {
  async function listen(server: ReturnType<typeof createServer>) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }

  async function setup(allowPrivate = true) {
    const target = createServer((request, response) => {
      response.end(`hello from ${request.headers.host}`)
    })
    const targetPort = await listen(target)
    const proxy = createEgressProxy({
      allowPrivate,
      resolve: async () => [{ address: '127.0.0.1' }],
    })
    const proxyPort = await listen(proxy.server)
    return {
      proxy,
      targetPort,
      proxyPort,
      close: () => {
        proxy.server.close()
        target.close()
        proxy.server.closeAllConnections()
        target.closeAllConnections()
      },
    }
  }

  const auth = (token: string) =>
    `Basic ${Buffer.from(`job:${token}`).toString('base64')}`

  function connectThrough(
    proxyPort: number,
    target: string,
    token: string | null,
  ): Promise<string> {
    return new Promise((resolve) => {
      const socket = connect(proxyPort, '127.0.0.1', () => {
        socket.write(
          `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${token ? `Proxy-Authorization: ${auth(token)}\r\n` : ''}\r\n`,
        )
      })
      let received = ''
      socket.on('data', (chunk) => {
        received += chunk.toString()
        if (received.includes('200 Connection Established')) {
          socket.write(
            'GET / HTTP/1.1\r\nHost: api.example.org\r\nConnection: close\r\n\r\n',
          )
        }
      })
      socket.on('close', () => resolve(received))
      socket.setTimeout(3000, () => socket.destroy())
    })
  }

  it('tunnels HTTPS-style CONNECT to an approved host', async () => {
    const { proxy, targetPort, proxyPort, close } = await setup()
    const grant = proxy.register(['api.example.org'])
    const answer = await connectThrough(
      proxyPort,
      `api.example.org:${targetPort}`,
      grant.token,
    )
    expect(answer).toContain('200 Connection Established')
    expect(answer).toContain('hello from api.example.org')
    grant.release()
    close()
  })

  it('forwards plain http requests to an approved host', async () => {
    const { proxy, targetPort, proxyPort, close } = await setup()
    const grant = proxy.register(['*.example.org'])
    const body = await new Promise<{ status: number; text: string }>(
      (resolve) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: proxyPort,
            method: 'GET',
            path: `http://data.example.org:${targetPort}/x`,
            headers: { 'Proxy-Authorization': auth(grant.token) },
          },
          (res) => {
            let text = ''
            res.on('data', (c) => (text += c))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
          },
        )
        req.end()
      },
    )
    expect(body.status).toBe(200)
    expect(body.text).toContain('hello from data.example.org')
    grant.release()
    close()
  })

  it('refuses a host the administrator did not approve', async () => {
    const { proxy, targetPort, proxyPort, close } = await setup()
    const grant = proxy.register(['api.example.org'])
    const answer = await connectThrough(
      proxyPort,
      `other.example.net:${targetPort}`,
      grant.token,
    )
    expect(answer).toContain('403 Forbidden')
    grant.release()
    close()
  })

  it('refuses a call with no credential, a wrong one, or one that has ended', async () => {
    const { proxy, targetPort, proxyPort, close } = await setup()
    const grant = proxy.register(['api.example.org'])
    const target = `api.example.org:${targetPort}`
    expect(await connectThrough(proxyPort, target, null)).toContain('407')
    expect(await connectThrough(proxyPort, target, 'wrong')).toContain('407')
    grant.release()
    expect(await connectThrough(proxyPort, target, grant.token)).toContain(
      '407',
    )
    close()
  })

  it('does not reach the lab’s own network unless the operator allows it', async () => {
    const { proxy, targetPort, proxyPort, close } = await setup(false)
    const grant = proxy.register(['api.example.org'])
    expect(
      await connectThrough(
        proxyPort,
        `api.example.org:${targetPort}`,
        grant.token,
      ),
    ).toContain('403 Forbidden')
    grant.release()
    close()
  })

  it('matches names the way the app does', () => {
    expect(hostAllowed(['api.example.org'], 'API.example.org.')).toBe(true)
    expect(hostAllowed(['*.example.org'], 'a.b.example.org')).toBe(true)
    expect(hostAllowed(['*.example.org'], 'example.org')).toBe(false)
    expect(hostAllowed(['example.org'], 'evilexample.org')).toBe(false)
    expect(hostAllowed(['*.example.org'], 'evilexample.org')).toBe(false)
    expect(hostAllowed([], 'example.org')).toBe(false)
  })

  it('knows which addresses are inside the lab', () => {
    for (const inside of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(inside), inside).toBe(true)
    for (const outside of [
      '8.8.8.8',
      '130.14.29.110',
      '172.32.0.1',
      '2606:4700::1111',
    ])
      expect(isPrivateAddress(outside), outside).toBe(false)
  })
})
