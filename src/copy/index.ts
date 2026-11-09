/**
 * The copy catalogue. Every piece of text the app shows comes from here:
 *
 *   import { t } from '#/copy'
 *   t('common.actions.cancel')                   // "Cancel"
 *   t('common.counts.rows', { count: 3 })        // "3 rows"
 *   rich('notebook.sign.certify', { link: (text) => <Link to="…">{text}</Link> })
 *
 * The active language is chosen once, when the app starts. English is the
 * only shipped language; `pseudo` stretches every string so text that skipped
 * the catalogue, or a layout that will not take a longer language, stands out.
 * Start the dev server with `VITE_SHEETBASE_LOCALE=pseudo` to see it.
 *
 * See docs/development/copy.md for how keys are named and how to add text.
 */
import { Fragment, createElement } from 'react'
import type { ReactNode } from 'react'
import { en } from './en'
import {
  interpolate,
  isMessage,
  isPlural,
  pseudo,
  selectPlural,
} from './format'
import type {
  CatalogueTree,
  CopyValue,
  Message,
  MessageAt,
  MessageKey,
  TagNames,
  ValueNames,
  Widen,
} from './types'

export type Catalogue = Widen<typeof en>

export type CopyKey = MessageKey<typeof en>

export type { CopyValue } from './types'

export type LocaleId = 'en' | 'pseudo'

const CATALOGUES: Record<Exclude<LocaleId, 'pseudo'>, Catalogue> = { en }

/** BCP 47 tag used for plural rules and number formatting. */
const INTL_LOCALE: Record<LocaleId, string> = { en: 'en-GB', pseudo: 'en-GB' }

function initialLocale(env: ImportMetaEnv | undefined): LocaleId {
  // Scripts run outside Vite (the seed, tsx tools) have no import.meta.env.
  const requested =
    env?.VITE_SHEETBASE_LOCALE ??
    (typeof process === 'undefined'
      ? undefined
      : process.env.VITE_SHEETBASE_LOCALE)

  return requested === 'pseudo' ? 'pseudo' : 'en'
}

let active: LocaleId = initialLocale(import.meta.env)

export function getLocale(): LocaleId {
  return active
}

/** Switches the language for text read from now on. Tests use this. */
export function setLocale(locale: LocaleId) {
  active = locale
}

/** The BCP 47 tag for the active language, for `Intl` formatters. */
export function intlLocale(): string {
  return INTL_LOCALE[active]
}

function lookup(key: string): Message {
  const catalogue = CATALOGUES[active === 'pseudo' ? 'en' : active]
  let node: Message | CatalogueTree | undefined = catalogue

  for (const part of key.split('.')) {
    // SAFETY: CopyKey's nonterminal segments name CatalogueTree sections; optional access keeps the missing-key fallback for callers that bypass the key type.
    node = (node as CatalogueTree | undefined)?.[part]
  }

  // A key the types accept always exists; this only guards bad casts.
  return isMessage(node) ? node : key
}

type Values<TKey extends CopyKey> = [
  ValueNames<MessageAt<typeof en, TKey>>,
] extends [never]
  ? []
  : [
      values: {
        readonly [TName in ValueNames<MessageAt<typeof en, TKey>>]: CopyValue
      },
    ]

function resolve(
  key: string,
  values: Readonly<Record<string, CopyValue>> | undefined,
) {
  const message = lookup(key)
  const locale = INTL_LOCALE[active]

  let text = isPlural(message)
    ? selectPlural(locale, message, Number(values?.count ?? 0))
    : message

  if (active === 'pseudo') text = pseudo(text)

  return interpolate(locale, text, values)
}

/** The text for `key`, with its values filled in. */
export function t<TKey extends CopyKey>(
  key: TKey,
  ...values: Values<TKey>
): string {
  return resolve(key, values[0])
}

type RichParts<TKey extends CopyKey> = {
  readonly [TName in ValueNames<MessageAt<typeof en, TKey>>]:
    CopyValue | ReactNode
} & {
  readonly [TName in TagNames<MessageAt<typeof en, TKey>>]: (
    text: ReactNode,
  ) => ReactNode
}

/**
 * The text for `key` as React nodes, for messages that wrap part of their
 * text in an element (`<link>Settings</link>`) or take an element as a
 * value. Each tag name maps to a function that renders its text.
 */
export function rich<TKey extends CopyKey>(
  key: TKey,
  parts: RichParts<TKey>,
): ReactNode {
  const all: Readonly<
    Record<string, ReactNode | ((text: ReactNode) => ReactNode)>
  > = parts

  const plain: Record<string, CopyValue> = {}
  const values: Record<string, ReactNode> = {}

  const renderers = new Map<string, (text: ReactNode) => ReactNode>()

  for (const [name, value] of Object.entries(all)) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- RichParts already restricts entries to ReactNode values or tag renderers; this separates the callable alternative without reparsing trusted nodes.
    if (typeof value === 'function') {
      renderers.set(name, value)
      continue
    }

    values[name] = value

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only trusted string/number ReactNode alternatives participate in text interpolation; elements, booleans, null and promises remain renderable values.
    if (typeof value === 'string' || typeof value === 'number')
      plain[name] = value
  }

  const text = resolve(key, plain)
  const nodes: Array<ReactNode> = []
  const pattern = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/g
  let last = 0

  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const [whole, tag, inner, name] = match

    if (tag) {
      const render = renderers.get(tag)
      nodes.push(render ? render(inner) : inner)
    } else if (name) {
      nodes.push(name in values ? values[name] : whole)
    }

    last = match.index + whole.length
  }

  if (last < text.length) nodes.push(text.slice(last))

  return createElement(
    Fragment,
    null,
    ...nodes.map((node, i) => createElement(Fragment, { key: i }, node)),
  )
}
