/**
 * Draft the steps of a protocol. The model proposes a short list; the person
 * edits it and chooses to add it, and each step then goes in as an ordinary
 * procedure-step block through the notebook's own insert. Pure parts only.
 */

export const STEPS_INSTRUCTION =
  'Draft the numbered steps of this laboratory procedure, one step per line, each a single clear action in the imperative. Include amounts, times and temperatures only when the context states them; otherwise leave them out and do not invent them. Reply with the steps only, no heading and no commentary.'

export const MAX_DRAFT_STEPS = 40
export const MAX_STEP_CHARS = 600

/** Turn the model's reply into clean step text: no numbering or bullets. */
export function parseSteps(answer: string): string[] {
  return answer
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(
          /^(?:[-*•]\s+|\(?\d{1,3}[.)]\s+|step\s+\d{1,3}\s*[:.)-]\s*)/i,
          '',
        )
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, MAX_STEP_CHARS))
    .slice(0, MAX_DRAFT_STEPS)
}

/** What to tell the model about the protocol it is drafting for. */
export function buildStepsText(title: string, brief: string): string {
  return [`Protocol: ${title.trim()}`, brief.trim() && `Notes: ${brief.trim()}`]
    .filter(Boolean)
    .join('\n')
}
