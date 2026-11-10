/**
 * Code is text. Lone surrogates and NUL become U+FFFD so a corrupt statement
 * renders as visibly broken text rather than throwing or smuggling a control
 * character into the DOM. Valid characters, including astral pairs, pass through
 * unchanged.
 */
export function codeText(value: string): string {
  let out = ''

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const loneSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff
    out += loneSurrogate || codePoint === 0 ? '\uFFFD' : character
  }

  return out
}
