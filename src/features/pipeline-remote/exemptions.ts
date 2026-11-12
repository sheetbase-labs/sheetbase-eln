/**
 * The objects of this area that are not on the token API, each with the
 * technical reason. Everything else is in `operations.ts` or `api-tables.ts`.
 */
export const PIPELINE_REMOTE_NOT_EXPOSED = {} as const satisfies Readonly<
  Record<string, string>
>
