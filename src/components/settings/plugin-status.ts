import type { Tone } from '#/components/ui/status'
import type { PluginEnvironmentState } from '#/lib/extensions/runtime-config'
import type { ConnectionWire } from '#/lib/extensions/outgoing-client'

export const environmentTone: Record<PluginEnvironmentState, Tone> = {
  none: 'none',
  building: 'progress',
  ready: 'ok',
  failed: 'bad',
  unavailable: 'warn',
}

/** Whether a connection still needs something filled in. */
export const connectionNeedsSetup = (connection: ConnectionWire) =>
  connection.settings.some((setting) => setting.required && !setting.isSet)
