# Copy catalogue

Every piece of text the app shows lives in one catalogue under `src/copy`.
Components read it with `t()`; nothing is typed straight into JSX. This keeps
wording consistent, lets the copy be reviewed in one place, and makes a second
language a matter of adding a folder.

## Using it

```tsx
import { rich, t } from '#/copy'

<Button>{t('common.actions.cancel')}</Button>
<p>{t('common.counts.rows', { count: rows.length })}</p>
<p>
  {rich('common.errors.askAdminForAccess', {
    link: (text) => <Link to="/settings/members">{text}</Link>,
  })}
</p>
```

- `t(key, values?)` returns a string. Keys and values are type checked: a
  wrong key, or a message whose `{name}` is not passed, fails `tsc`.
- `rich(key, parts)` returns React nodes, for a sentence with a link, bold
  text or an element inside it. Each `<tag>…</tag>` in the message needs a
  render function, and `{name}` values may be elements.
- Plurals are objects keyed by plural category and chosen by `count`:
  `{ one: '{count} row', other: '{count} rows' }`. Add `zero` for a different
  sentence at zero. Never build a plural in code (`row${n === 1 ? '' : 's'}`).
- Numbers passed as values are formatted for the language (`1,200`).
- Code that is not a component (a `lib` module building a message) imports
  `t` the same way.

## Where text goes

`src/copy/en/` holds one file per area, joined in `src/copy/en/index.ts`:

| File          | Area                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `common.ts`   | Everyday actions, states, errors and counts used everywhere          |
| `notebook.ts` | Notebooks, sheets, records, comments, the assistant guide            |
| `data.ts`     | Datasets, imports, analysis, charts, pipelines                       |
| `library.ts`  | Models, templates, protocols, samples, materials, instruments        |
| `settings.ts` | Settings, administration, sign-in, help, the app shell and UI kit    |
| `projects.ts` | Projects, experiments, review, home, search, schedule, the workspace |

Inside an area, nest by screen or component, then name the text by its job:
`data.columnInspector.unitHint`, `library.samples.withdraw.title`. Use camel
case. Prefer the job (`title`, `empty`, `confirm`, `hint`, `error`) to the
words, so a key survives a rewording.

Use `common` for text that means the same thing everywhere (Cancel, Save,
Loading…). Do not add near-copies of a common message to an area file.

## Writing the text

Product voice is in `docs/knowledge/PRODUCT.md`: concise, direct, professional.
These house rules were agreed in the October 2026 copy review:

- Sentence case for headings, buttons, tabs and labels, and lowercase object
  names in running text: "Append to a dataset", not "Append to a Dataset".
- Name things the way a scientist would, not the way the code does. No IDs,
  UUIDs, RPC or function names, ticket numbers, or words like "canonical",
  "payload", "server" or "build".
- Keep explanations to one or two short sentences. Say what happens and what
  the person can do.
- Contractions in hints and errors ("Couldn’t load", "You can’t sign this
  yet"). Statements a person signs keep their exact formal wording.
- Curly quotes and apostrophes (’ “ ”) and a real ellipsis (…).
- "Try again", never "Retry".
- A one-line empty state has no full stop: "No runs yet".
- Delete means gone for good. Remove takes something off a list and the thing
  itself stays. Archive hides it and it can be restored.
- Roles are "admin" and "data steward", lowercase.
- Plurals come from plural messages, never from code.
- Units, identifiers and scientific notation are content: keep them exact.

Plain terms to use:

| Instead of                         | Say                                |
| ---------------------------------- | ---------------------------------- |
| Promote a column, promotion        | Add to dataset, column request     |
| Materialise                        | Save as dataset                    |
| Canonical                          | (leave it out)                     |
| Dataset schema, schema version     | Dataset structure, dataset version |
| Provenance                         | Source                             |
| Server version, changed on server  | Their version, someone else saved  |
| Payload, raw JSON                  | Details, full result               |
| Hash, digest (outside audit pages) | Fingerprint                        |

## What stays out

- Demo seed data (`src/db/seed`).
- Developer-only pages and tools (foundations, component comparison,
  components page, dev toolbar).
- Public API and agent tool descriptions, which developers read.
- Internal validation messages (`instanceId must be a UUID`). If one can
  reach the screen, show a catalogue message instead.
- Text from a test file, a story, or a third-party source under
  `src/components/reui`.

## The check

`pnpm check:copy` (part of `pnpm check`) fails when a `.tsx` file under
`src/components` or `src/routes` has text in JSX, in a readable attribute
(`title`, `aria-label`, `placeholder`, `label`, `alt`, …), in a text property
(`label:`, `description:`, …) or passed to `toast`.

Files that have not moved yet are listed in `scripts/copy-pending.txt` and
skipped. The list only shrinks: once a file is clean the check asks you to run
`pnpm check:copy --update`, which drops it. For the rare line that must stay
literal, put a `copy-ignore-next-line` comment on the line above.

## Testing other languages

Start the dev server with `VITE_SHEETBASE_LOCALE=pseudo` to see the stretched
test language: every catalogue string is accented, padded by about a third and
bracketed (`⟦Çáñçéļ··⟧`). Plain English on screen did not come from the
catalogue, and anything that clips or overflows will break in a longer
language.

## Moving a file into the catalogue

1. Move each string word for word into the area file, and commit that move
   on its own. Then apply the house rules above in the catalogue in a
   separate `fix(copy):` commit, so the move and the rewording can be
   reviewed apart.
2. Replace the literal with `t()` or `rich()`. Replace hand-built plurals with
   a plural message.
3. Tests that assert on English text keep passing after the move. Update
   them in the rewording commit, alongside the text they check.
4. Run `pnpm check:copy --update`, `tsc`, and the file's tests.
