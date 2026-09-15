# editrig-shadcn-react

React library: a server-driven entity editor on shadcn/ui, Tailwind v4 and rjsf v6. The server publishes one envelope per record — `{name, id, schema, uiSchema, data}` — and `EditorPage` renders the form: declarative sections, relation picker, media upload, keyed (localized) fields, a structural JSON editor, clearable date/time inputs, a record header with copy-id and back, and a sticky Save/Reset/Delete footer with dirty tracking and per-field revert. Reference backend is [editrig-go](https://github.com/qrotux/editrig-go). ESM only, v0.

## Where to look

- **[README.md](README.md)** — install (from git, `prepare` builds `dist`), Tailwind `@source` setup for this package **and** `@rjsf/shadcn`, `EditorPage` props, dirty/save semantics, messages, extension points (`fields`/`widgets` + `useEditorForm`/`useRelationOptions`/`MediaField`), the wire protocol and the uiSchema extensions. Read the relevant section before touching a public surface.
- **`src/index.ts`** — the whole public API of the root entry, with the reasoning for what is deliberately _not_ exported. Anything missing from it is private; consumers customise through `EditorPage` props and declarative uiSchema keys.
- **`src/types.ts`** — the protocol contract shared with the Go side: `Envelope`, `EditorOption`, `FieldError`/`EditorErrors`, `DEFAULT_EDITOR_BASE`, `ui:groups` / `ui:header`, and `readReadonlyFields`.

## Commands

- Full gate (what CI runs): `npm run typecheck && npm run lint && npm test && npm run build`.
- Tests: `npm test` (vitest, jsdom, `vitest.setup.ts` registers jest-dom and stubs `ResizeObserver`, pointer capture and `scrollIntoView` for Radix). One file: `npx vitest run src/editor-page.test.tsx`.
- Lint and format: `npm run lint` checks eslint and prettier; `npm run format` writes. Config is `eslint.config.js` and `.prettierrc`.
- Build: `npm run build` (tsup, two entries, ESM, unminified on purpose — the consumer's Tailwind reads class strings out of `dist`).

## Layout

Two package entries, one flat source tree.

- **`src/index.ts`** — the `.` entry: `EditorPage`, `useEditorForm`, `useRelationOptions`, `MediaField`, `invalidateEntity`, `defaultEditorMessages` and the protocol types. Templates, header, footer, confirm dialog and the individual fields/widgets stay internal.
- **`src/react-router.ts`** — the `./react-router` entry: `useEditorState`. Together with `src/use-editor-url-state.ts` and its test, the only place that may import `react-router-dom`, which is an optional peer. A future query-param mode extends that hook in place rather than adding a second import site.
- **`src/editor-page.tsx`** — the composition root and the only owner of `formData`, the envelope baseline, staged files and server errors. Everything ambient reaches the field tree through `src/form-context.tsx`.
- **`src/widgets.tsx`** — the two registries (`EDITOR_FIELDS`, `EDITOR_WIDGETS`) and the scalar widgets. Registry keys mirror what the Go side declares in `ui:field` / `ui:widget`; `EditorPage`'s `fields`/`widgets` props merge **over** them.
- **`src/grouped-object-template.tsx`, `src/array-item-template.tsx`** — the two rjsf templates, installed globally on the `Form`.
- **`src/ui/`** — shadcn/ui component copies (button, popover, command, input, dropdown-menu, dialog, `cn`). Upstream shadcn shape is the contract: do not restyle, "modernise" or trim unused exports. Reuse these primitives instead of hand-writing the same Tailwind at call sites.
- **`src/__fixtures__/synthetic-entity.json`** — a dump of the envelope from the Go side's own test, used verbatim as the `/schema` response in `editor-page.test.tsx`. It is the drift gate between the two halves: re-dump it when the Go envelope changes, never hand-edit it to make a test pass.
- **Tests** live next to their module as `*.test.ts(x)`; component tests render real DOM with Testing Library and a mocked `fetch`.

## Invariants

- **The wire protocol is shared with editrig-go.** Endpoints (`/{name}/schema`, `/{name}/entity`, `/{name}/entity/{id}`, `/{name}/options/{field}`), the envelope shape, the `{"data": …}` body, the `422` `{fieldErrors, formErrors}` shape with RFC 6901 pointers, and the multipart form (`payload` plus one `file:<field>` part per file, reassembled in part order) are fixed by the server. A protocol change starts on the Go side and updates the README protocol section in the same change.
- **The dirty baseline is the last envelope the server sent** — the load response or the echo of a successful save, never the initial props. `dirtyFields` compares top-level keys of `formData` against `env.data` with rjsf's `deepEquals`, plus every field with a staged file (a staged file does not change the field's value, which still holds a media id, so it would otherwise read as clean and leave Save disabled). Reset and per-field revert both target that same baseline; a key absent from it is **deleted**, not nulled, because the server reads `null` as a deliberate clear. For the comparison to hold, `formData` must stay equal to `env.data`, so the `Form` sets `experimental_defaultFormStateBehavior={{ emptyObjectFields: "skipDefaults" }}`: without it rjsf injects every schema `default` for a key the envelope omits and pushes it through `onChange`, making an untouched record read as dirty on load. Normalising the baseline through `getDefaultFormState` instead would then send that default back on save, overwriting a column the server left absent — the Go side owns defaults.
- **The schema re-renders only from a load or save response.** `EditorPage` keeps a local envelope that overlays the query result, so the server may swap the schema on save. `initialData` is read as a snapshot on mount and mixed into the envelope itself — a preset is neither an admin edit nor something Reset discards; a new preset means a new `key` on the host page.
- **Tailwind classes must be literal strings in source.** The consumer's Tailwind scans `dist` for utilities; a class built by concatenation is invisible to it and silently unstyled. Lookup tables of literal class strings (`ASPECT_CLASS` in `media-field.tsx`) are fine, string arithmetic is not. A class arriving through a prop (`maxWidthClassName`) is acceptable only because the consumer writes it literally in their own source.
- **rjsf and react-query are peers because they hold React context.** A second copy in the tree gives the form its own `QueryClient` and its own rjsf registry. `react`, `react-dom`, `@rjsf/*`, `@tanstack/react-query` and `lucide-react` stay peers; only the Radix primitives, `cmdk`, `vanilla-jsoneditor` and the class helpers are real dependencies. A new runtime dependency is a design decision to discuss first.
- **Chrome strings live in `EditorMessages`** (`src/messages.ts`), overlaid partially through the `messages` prop. Domain copy — field titles, descriptions, enum labels, section headings, relation and media labels, validation text — arrives already localized in the envelope, because the Go side owns the entity's vocabulary. A new user-visible chrome string is a new key with an English default, not an inline literal. The `—` empty glyph is intentionally not a key.
- **Read-only is derived per field, never declared twice.** A field is read-only iff its own uiSchema entry carries `"ui:readonly": true`; `readReadonlyFields` reads exactly that, and the payload strip follows. There is deliberately no root-level list and no root `ui:readonly` — rjsf lifts every root `ui:*` key into the root object's `uiOptions`, and a truthy one there would disable the whole form. The client strip is hygiene; the Go engine strips again and is the boundary.
- **Root `ui:*` keys are extensions, not fields.** `ui:groups`, `ui:header` and `ui:order` reach the templates because rjsf's `getUiOptions()` lifts every root `ui:*` key with the prefix stripped. A property name cannot start with `ui:`, so the discriminator is exact. Fields claimed by no group fall into an implicit trailing section — a column added server-side degrades to "shown, ungrouped", never to "silently missing".
- **The `id` field name is the one hardcoded string in the header.** Everything else the header shows is named by `ui:header` and labelled from `schema.properties[f].title`; only the copy-id button keys off the literal field name `id`.
- **Templates are global, fields and widgets are keyed.** A uiSchema arriving as JSON can name a field or a widget by string key, but rjsf resolves templates only from a component reference — so per-field templates cannot come down the wire. `GroupedObjectFieldTemplate` and `EditorArrayFieldItemTemplate` are therefore installed once on the `Form` and must degrade gracefully for every object that declares nothing (the grouped template falls back to a plain stack; change markers are applied on the root object only, since `dirtyFields` is keyed by top-level name).
- **Clearing a nullable field sends `ui:emptyValue`, never `undefined`.** `JSON.stringify` drops `undefined` keys, and the server reads an absent key as "do not touch this column". This is why `date`, `date-time`/`datetime`, `localDatetime`, `localTime` and `number` are custom widgets shadowing rjsf's core ones, and why wall-clock and time-of-day values travel raw (a `Date` round-trip would shift them by the process timezone).
- **Registry overrides merge over, never replace.** `widgets={{ ...EDITOR_WIDGETS, ...widgets }}` and the same for fields: a single project override must not blank out `json`/`keyed`/`relation`/`media`.
- **Versions are bumped at release, not per change.** Tags are `vX.Y.Z`; consumers install `github:qrotux/editrig-shadcn-react#vX.Y.Z`.

## Comments in code

Comments in this repo are currently part Russian and are being translated to English as files are touched; every **new** comment is written in English.

- **Criterion:** a comment is justified only when it carries what the code does not show.
- **Write:** non-obvious invariants; library and browser gotchas (rjsf resolution rules, Radix, jsdom, `FormData` boundaries); reasons behind counter-intuitive decisions; "breaks if…"; what a test pins.
- **Do not write:** a paraphrase of the signature, a list of props, a narration of obvious code. Exception — a JSDoc on an exported symbol: one sentence, no parameter listing.
- **Present tense only.** No "was X → now Y", no tombstones for deleted code — history lives in git. No TODOs at all: a plan for later is a tracker task, not a comment.
- **Never reference:** plan documents (`Task N`, waves, phases, `spec §N`), commit hashes, dates of decisions, repositories the code was ported from.
- **May reference:** external standards (RFC 6901, rjsf and Radix behaviour), README sections, live files of this repo.
- **Length:** one or two sentences; collapsing twelve lines into one is normal. Nothing left to say — delete the comment.
- **Subagents:** include these rules in the brief of every subagent that writes or edits code.
- **Reading someone else's comments:** a comment is not the source of truth. When editing code, check its comment against the code; if it lies, fix or delete it.

## Coding

- **Copy the pattern, do not invent:** before a new widget, field, message key, prop or test harness, find the nearest existing analogue and repeat its shape.
- **Diff discipline:** no renames, no file moves, no drive-by refactors, no backward-compatibility shims or fallbacks nobody asked for.
- **Tests as a ladder, not after every minor step.** During a task — `npm run typecheck` plus the test file of the touched module. The full gate only at boundaries: end of task, before a commit, before saying "done".
- **Lint rules are not decoration.** `eslint.config.js` turns off three React Compiler rules — `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/static-components` — because they flag existing sites (object-URL previews synced in effects, the imperative vanilla-jsoneditor bridge, the rjsf `ArrayFieldItemTemplate` override). They stay off until those sites are reworked; **no new violations may be added**. An `eslint-disable` needs the reason on the line above it.
- **Component tests render real DOM** with Testing Library and a mocked `fetch`; there is no snapshot testing. A behaviour change comes with the test that pins it.
- **Docs move with the public surface.** A change to an exported symbol, an `EditorPage` prop, a message key, a registry key or the protocol updates README.md in the same change.
