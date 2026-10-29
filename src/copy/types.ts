/**
 * Types for the copy catalogue. A catalogue is a tree of sections whose
 * leaves are either a message string or a plural message. Message strings
 * use `{name}` for values and `<tag>…</tag>` around text that renders as an
 * element (see `rich`). Keys are the dotted path to a leaf, and the values a
 * message needs are read from its placeholders, so a wrong key or a missing
 * value fails the type check.
 */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** A message chosen by `count`, using the locale's plural rules. */
export type PluralMessage = { readonly other: string } & {
  readonly [TCategory in Exclude<PluralCategory, 'other'>]?: string
}

export type Message = string | PluralMessage

export interface CatalogueTree {
  readonly [key: string]: Message | CatalogueTree
}

/** Every dotted key that names a message in `T`. */
export type MessageKey<T, TPrefix extends string = ''> = {
  [TKey in keyof T & string]: T[TKey] extends Message
    ? `${TPrefix}${TKey}`
    : MessageKey<T[TKey], `${TPrefix}${TKey}.`>
}[keyof T & string]

/** The message stored at dotted key `TKey` of `T`. */
export type MessageAt<
  T,
  TKey extends string,
> = TKey extends `${infer THead}.${infer TRest}`
  ? THead extends keyof T
    ? MessageAt<T[THead], TRest>
    : never
  : TKey extends keyof T
    ? T[TKey]
    : never

type Placeholders<TText> =
  TText extends `${string}{${infer TName}}${infer TRest}`
    ? TName | Placeholders<TRest>
    : never

type Tags<TText> = TText extends `${string}<${infer TName}>${infer TRest}`
  ? TName extends `/${string}`
    ? Tags<TRest>
    : TName | Tags<TRest>
  : never

type Strings<TMessage> = TMessage extends string
  ? TMessage
  : TMessage extends PluralMessage
    ? TMessage[keyof TMessage] & string
    : never

/** Names of the values message `TMessage` needs. Plurals always need `count`. */
export type ValueNames<TMessage> =
  | Placeholders<Strings<TMessage>>
  | (TMessage extends PluralMessage ? 'count' : never)

/** Names of the elements message `TMessage` wraps text in. */
export type TagNames<TMessage> = Tags<Strings<TMessage>>

export type CopyValue = string | number

/** The same tree shape with every message widened, for other locales. */
export type Widen<T> = {
  readonly [TKey in keyof T]: T[TKey] extends string
    ? string
    : T[TKey] extends PluralMessage
      ? PluralMessage
      : Widen<T[TKey]>
}
