/**
 * A scripted model for end-to-end assistant tests.
 *
 * It is a real HTTP server that speaks the OpenAI chat-completions streaming
 * protocol, so the assistant's own provider code, gateway, tool selection and
 * tool runner all run for real; only the words and tool calls the "model"
 * chooses are scripted. A script is a function of what the model was sent (the
 * conversation so far and the tools on offer), so a step can use an id that an
 * earlier tool result returned, exactly as a real model would.
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string; text?: string }> | null
  tool_calls?: Array<{
    id: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface ModelRequest {
  messages: WireMessage[]
  /** Names of the tools offered, in wire spelling (`sheetbase__project__create`). */
  toolNames: string[]
  /** The system prompt, as one string. */
  system: string
  /** Text of the latest user message. */
  question: string
  /** Tool results since the last user message, oldest first. */
  toolResults: Array<{ id: string; text: string }>
  /** How many model steps this turn has taken so far (0 for the first). */
  step: number
}

export interface ToolCall {
  /** The tool's name, dotted (`sheetbase.project.create`) or wire spelling. */
  name: string
  arguments: Record<string, unknown>
  id?: string
}

export interface ModelReply {
  text?: string
  calls?: ToolCall[]
}

export type ModelScript = (request: ModelRequest) => ModelReply

function textOf(content: WireMessage['content']): string {
  if (typeof content === 'string') return content
  if (!content) return ''

  return content.map((part) => part.text ?? '').join('')
}

export interface MockModel {
  baseUrl: string
  /** Every request the server received, newest last. */
  requests: ModelRequest[]
  /** Replace the script that answers the next turns. */
  use: (script: ModelScript) => void
  stop: () => Promise<void>
}

function frame(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
}

export async function startMockModel(): Promise<MockModel> {
  let script: ModelScript = () => ({ text: 'No script is set.' })
  const requests: ModelRequest[] = []
  let counter = 0

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      if (!req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end()

        return
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages: WireMessage[]
        tools?: Array<{ function: { name: string } }>
      }

      const lastUser = body.messages.findLastIndex(
        (message) => message.role === 'user',
      )

      const sinceUser = body.messages.slice(lastUser + 1)

      const request: ModelRequest = {
        messages: body.messages,
        toolNames: (body.tools ?? []).map((tool) => tool.function.name),
        system: body.messages
          .filter((message) => message.role === 'system')
          .map((message) => textOf(message.content))
          .join('\n'),
        question: textOf(body.messages[lastUser]?.content),
        toolResults: sinceUser
          .filter((message) => message.role === 'tool')
          .map((message) => ({
            id: message.tool_call_id ?? '',
            text: textOf(message.content),
          })),
        step: sinceUser.filter((message) => message.role === 'assistant')
          .length,
      }

      requests.push(request)
      const reply = script(request)

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      })

      if (reply.text) {
        res.write(
          frame({ choices: [{ index: 0, delta: { content: reply.text } }] }),
        )
      }

      reply.calls?.forEach((call, index) => {
        res.write(
          frame({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index,
                      id: call.id ?? `call_${++counter}`,
                      type: 'function',
                      function: {
                        name: call.name.replaceAll('.', '__'),
                        arguments: JSON.stringify(call.arguments),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        )
      })

      res.write(
        frame({
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: reply.calls?.length ? 'tool_calls' : 'stop',
            },
          ],
        }),
      )
      res.write(
        frame({
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      )
      res.write(frame('[DONE]'))
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') throw new Error('No port')

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    use: (next) => {
      script = next
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
