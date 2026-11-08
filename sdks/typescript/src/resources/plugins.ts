/**
 * Plugins: call an operation an installed plugin declares.
 *
 * Every operation a plugin declares gets an API route,
 * `POST /api/plugins/<key>/<operation>`; this is the one generic way to reach
 * all of them. `key` is the plugin's name in the workspace (the last part of its
 * id, so `acme.cell-count` is `cell-count`). Use a personal token: a service
 * token is refused so every call is attributed to a person. A read operation
 * needs a `:read` scope; a write operation needs `lab:write`.
 */
import type { HttpTransport } from '../http.js'

export class PluginsResource {
  constructor(private transport: HttpTransport) {}

  /** Runs an operation and returns its declared outputs. */
  async call(
    key: string,
    operation: string,
    input: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const result = (await this.transport.post(
      `/api/plugins/${key}/${operation}`,
      { jsonBody: { input } },
    )) as { output: Record<string, unknown> }
    return result.output
  }
}
