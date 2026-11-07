/**
 * What goes in the folder-agent download, and the small facts the instrument
 * page needs about it. Pure, so the zip and the setup screens agree.
 */
export type AgentSystem = 'windows' | 'mac' | 'linux'

export const AGENT_SCOPES = ['files:write', 'datasets:write'] as const

/** An agent that signed in this recently counts as running. */
export const AGENT_SEEN_MINUTES = 20

export const AGENT_SYSTEMS: Array<{
  value: AgentSystem
  folderExample: string
}> = [
  { value: 'windows', folderExample: 'C:\\InstrumentResults' },
  { value: 'mac', folderExample: '/Users/lab/Results' },
  { value: 'linux', folderExample: '/home/lab/results' },
]

/** The name of the token made for one instrument's live-readings agent. */
export function liveAgentTokenName(instrumentLabel: string): string {
  return `Live agent · ${instrumentLabel}`
}

/** The name of the token made for one robot's agent. */
export function robotAgentTokenName(instrumentLabel: string): string {
  return `Robot agent · ${instrumentLabel}`
}

/** How the agent reaches the robot: its network address, or a folder its software reads. */
export type RobotInput =
  | { driver: 'opentrons'; address: string }
  | { driver: 'file'; dir: string }

/** Where live readings come from: a log file the instrument keeps writing, or a network port. */
export type LiveSourceInput =
  | { kind: 'file'; path: string; feed?: string; unit?: string }
  | {
      kind: 'network'
      host: string
      port: number
      feed?: string
      unit?: string
    }

/** The name of the token made for one instrument's agent. */
export function agentTokenName(connectorKey: string): string {
  return `Folder agent · ${connectorKey}`
}

/**
 * A connector key for an instrument: lowercase letters, digits and dashes,
 * starting with a letter (what the database accepts), and different for
 * instruments that share a name.
 */
export function connectorKeyForInstrument(
  name: string,
  displayId: string,
): string {
  const slugify = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const slug = slugify(name)
  const base = /^[a-z]/.test(slug) ? slug : `instrument-${slug}`
  const suffix = slugify(displayId)
  const key =
    suffix && !base.endsWith(suffix)
      ? `${base.slice(0, 48 - suffix.length)}-${suffix}`
      : base
  return key.slice(0, 49).replace(/-+$/g, '') || 'instrument'
}

export interface AgentFile {
  path: string
  content: string
  executable?: boolean
}

export function agentFiles(input: {
  agentSource: string
  url: string
  connectorKey?: string
  instrumentName: string
  folder?: string
  credential: string
  system: AgentSystem
  /** The instrument's id, needed to send live readings. */
  instrumentId?: string
  live?: LiveSourceInput[]
  robot?: RobotInput
}): AgentFile[] {
  const root = 'sheetbase-agent'
  const settings = JSON.stringify(
    {
      url: input.url,
      ...(input.connectorKey ? { connector: input.connectorKey } : {}),
      ...(input.folder ? { dir: input.folder } : {}),
      credential: input.credential,
      ...(input.live?.length || input.robot
        ? { instrumentId: input.instrumentId }
        : {}),
      ...(input.live?.length ? { live: input.live } : {}),
      ...(input.robot ? { robot: input.robot } : {}),
    },
    null,
    2,
  )
  const files: AgentFile[] = [
    { path: `${root}/instrument-agent.mjs`, content: input.agentSource },
    { path: `${root}/sheetbase-agent.json`, content: `${settings}\n` },
  ]
  if (input.system === 'windows') {
    files.push({
      path: `${root}/Start Sheetbase agent.bat`,
      content: [
        '@echo off',
        'cd /d "%~dp0"',
        'where node >nul 2>nul || (',
        '  echo Node.js is needed on this computer. Install it from https://nodejs.org, then open this file again.',
        '  pause',
        '  exit /b 1',
        ')',
        'node instrument-agent.mjs',
        'pause',
        '',
      ].join('\r\n'),
    })
  } else {
    const name =
      input.system === 'mac'
        ? 'Start Sheetbase agent.command'
        : 'start-sheetbase-agent.sh'
    files.push({
      path: `${root}/${name}`,
      executable: true,
      content: [
        '#!/bin/sh',
        'cd "$(dirname "$0")"',
        'if ! command -v node >/dev/null 2>&1; then',
        '  echo "Node.js is needed on this computer. Install it from https://nodejs.org, then run this again."',
        '  exit 1',
        'fi',
        'exec node instrument-agent.mjs',
        '',
      ].join('\n'),
    })
  }
  files.push({
    path: `${root}/README.txt`,
    content: readme(input),
  })
  return files
}

function readme(input: {
  instrumentName: string
  folder?: string
  system: AgentSystem
  live?: LiveSourceInput[]
  robot?: RobotInput
}): string {
  const start =
    input.system === 'windows'
      ? 'Open "Start Sheetbase agent.bat".'
      : input.system === 'mac'
        ? 'Open "Start Sheetbase agent.command".'
        : 'Run start-sheetbase-agent.sh.'
  if (input.robot && !input.folder) {
    return [
      `Sheetbase robot agent for ${input.instrumentName}`,
      '',
      '1. Install Node.js (version 22 or newer) from https://nodejs.org if this computer does not have it.',
      `2. ${start}`,
      '',
      input.robot.driver === 'opentrons'
        ? `It talks to the robot at ${input.robot.address}.`
        : `It hands worklists to the robot software through ${input.robot.dir}.`,
      '',
      'When someone sends a worklist to the robot in Sheetbase, this agent puts the run on the robot. The run starts only when a person presses Start in Sheetbase. What the robot did goes back to Sheetbase when it finishes.',
      '',
      'Keep the window open while the robot is in use.',
      '',
      'sheetbase-agent.json holds this robot’s access key. Keep this folder to yourself.',
      'Download the agent again from the instrument page to replace it.',
      '',
    ].join('\n')
  }
  if (input.live?.length && !input.folder) {
    return [
      `Sheetbase live readings for ${input.instrumentName}`,
      '',
      '1. Install Node.js (version 22 or newer) from https://nodejs.org if this computer does not have it.',
      `2. ${start}`,
      '',
      'It follows:',
      ...input.live.map((source) =>
        source.kind === 'file'
          ? `  - the file ${source.path}`
          : `  - the network port ${source.host}:${source.port}`,
      ),
      '',
      'Readings appear on the instrument page in Sheetbase as they arrive. If the computer or the connection drops, readings wait here and are sent when it is back.',
      '',
      'Keep the window open while the instrument is running.',
      '',
      'sheetbase-agent.json holds this instrument’s access key. Keep this folder to yourself.',
      'Download the agent again from the instrument page to replace it.',
      '',
    ].join('\n')
  }
  return [
    `Sheetbase agent for ${input.instrumentName}`,
    '',
    '1. Install Node.js (version 22 or newer) from https://nodejs.org if this computer does not have it.',
    `2. ${start}`,
    `3. Save or export the instrument's result files into ${input.folder}.`,
    '',
    'Each file is sent to Sheetbase once it has finished saving. Sent files move to a "processed" folder.',
    'A file Sheetbase can’t read moves to "failed" and shows up on the instrument page, where you can try it again.',
    '',
    'Keep the window open while the instrument is running. The instrument page in Sheetbase shows when the agent was last seen.',
    '',
    'sheetbase-agent.json holds this instrument’s access key. Keep this folder to yourself.',
    'Download the agent again from the instrument page to replace it.',
    '',
  ].join('\n')
}
