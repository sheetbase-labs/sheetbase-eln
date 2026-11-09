/**
 * Tidy model output before a person sees it.
 *
 * Small models, especially free ones, sometimes answer with raw chat-template
 * tokens or a tool call they were never offered, e.g.
 * `<|tool_call_start|>[sheetbase(query='list all')]<|tool_call_end|>`. That is
 * not an answer. `AnswerCleaner` removes those spans from a stream as it
 * arrives: it only ever releases text that is final, so a half-arrived token
 * never flashes on screen and the visible text only grows.
 */

const TOOL_CALL_SPAN =
  /<\|(?:tool_call_start|tool_calls_begin|python_tag)\|>[\s\S]*?<\|(?:tool_call_end|tool_calls_end|eom_id|eot_id)\|>/g

/** An opened tool call that has not closed (yet): drop it and what follows. */
const OPEN_TOOL_CALL =
  /<\|(?:tool_call_start|tool_calls_begin|python_tag)\|>[\s\S]*$/

/** Any other chat-template token such as `<|im_end|>` or `<|endoftext|>`. */
const SPECIAL_TOKEN = /<\|[a-z0-9_ ]{1,40}\|>/gi

/** A token that may still be arriving: `<`, `<|`, `<|tool_ca` at the very end. */
const PARTIAL_TOKEN = /<(?:\|[a-z0-9_ ]{0,40})?$/i

export function cleanAnswer(raw: string, final: boolean): string {
  let text = raw.replace(TOOL_CALL_SPAN, '').replace(OPEN_TOOL_CALL, '')
  text = text.replace(SPECIAL_TOKEN, '')

  if (!final) text = text.replace(PARTIAL_TOKEN, '')

  return text
}

export const EMPTY_ANSWER_MESSAGE =
  'I could not put together an answer from that. Try asking about a specific record, sample or experiment, or open the page you mean and ask again.'

export class AnswerCleaner {
  private raw = ''
  private released = 0

  /** Feed a raw delta; returns the newly safe-to-show text (maybe empty). */
  push(delta: string): string {
    this.raw += delta

    return this.release(false)
  }

  /** Call once at the end; returns any held-back tail. */
  finish(): string {
    return this.release(true)
  }

  /** Whether anything readable has been released so far. */
  get hasContent(): boolean {
    return cleanAnswer(this.raw, true).trim().length > 0
  }

  private release(final: boolean): string {
    const clean = cleanAnswer(this.raw, final)

    if (clean.length <= this.released) return ''
    const next = clean.slice(this.released)
    this.released = clean.length

    return next
  }
}
