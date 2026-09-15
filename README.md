# @qrotux/editrig-shadcn-react

Server-driven entity editor for React, styled with shadcn/ui and Tailwind v4.
The server describes one record — JSON Schema, uiSchema and data in a single
envelope — and `EditorPage` renders the form with
[rjsf](https://github.com/rjsf-team/react-jsonschema-form) v6: sections, a
relation picker, media upload, keyed (localized) fields, a structural JSON
editor, clearable date/time inputs, a record header with copy-id and back, and
a sticky Save / Reset / Delete footer with dirty tracking and per-field revert.

The reference server implementation is
[editrig-go](https://github.com/qrotux/editrig-go). Any backend that speaks the
wire protocol below works.

## Install

```sh
npm install @qrotux/editrig-shadcn-react
```

Installing straight from git also works; the `prepare` script builds `dist` on
install.

```sh
npm install github:qrotux/editrig-shadcn-react#v0.1.0
```

Peer dependencies: `react`, `react-dom`, `@rjsf/core`, `@rjsf/shadcn`,
`@rjsf/utils`, `@rjsf/validator-ajv8`, `@tanstack/react-query`,
`lucide-react`. `react-router-dom` is optional and only needed for the
`./react-router` entry. Install them in one go if your project does not have
them yet:

```sh
npm install react react-dom @rjsf/core @rjsf/shadcn @rjsf/utils \
  @rjsf/validator-ajv8 @tanstack/react-query lucide-react
```

rjsf and react-query are peers, not dependencies, on purpose: both hold React
context that the host application shares with the rest of its pages. A second
copy in the tree would give the form its own `QueryClient` and its own rjsf
registry.

## Styling

The components carry Tailwind utility classes and use the shadcn theme
variables (`--background`, `--muted`, `--accent`, `--primary`, `--destructive`,
`--input`, `--ring`, `--popover`, `--card`, `--secondary`, and their
`-foreground` pairs). The form body is rendered by the `@rjsf/shadcn` theme,
which carries its own classes, so your Tailwind setup must scan both packages:

```css
@import "tailwindcss";
@import "@qrotux/editrig-shadcn-react/theme.css";

@source "../node_modules/@qrotux/editrig-shadcn-react/dist";
@source "../node_modules/@rjsf/shadcn/lib";
```

Adjust the relative `@source` paths to your CSS entry file.

`theme.css` does two things: it maps the shadcn tokens to Tailwind utilities so
`bg-background`, `text-muted-foreground`, `border-input` and `rounded-md` are
generated at all, and it supplies default token _values_ so a project with no
theme of its own is styled out of the box. The defaults are declared at zero
specificity, so an application that already defines the shadcn tokens (its own
`:root { --background: … }`, layered or not) overrides them with no import-order
requirement — a real `:root` beats the file's `:where(:root)`, and an
`@layer base` declaration beats its `@layer theme` one. So the import is safe
either way: it fills only the tokens you leave undefined, and it follows your
`--radius` for the corner scale (`rounded-md` is `calc(var(--radius) - 2px)`,
the canonical shadcn formula).

For dark mode, `theme.css` carries the `.dark` token values, but the `dark:`
utilities in the form body come from `@rjsf/shadcn` and need the host to declare
the class variant once, as any shadcn project does:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

## Usage

`EditorPage` renders one record. `name` selects the entity, `id` is `null` for
the create form and the record id otherwise. A `QueryClientProvider` must be
mounted above it.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { EditorPage } from "@qrotux/editrig-shadcn-react";
import { useEditorState } from "@qrotux/editrig-shadcn-react/react-router";

const qc = new QueryClient();

export function UserEditorPage() {
  const { id: routeId } = useParams();
  const { id } = useEditorState(routeId);
  const navigate = useNavigate();

  return (
    <QueryClientProvider client={qc}>
      <EditorPage
        name="users"
        id={id}
        onSaved={(savedId) => navigate(`/admin/users/${savedId}`, { replace: true })}
        onDeleted={() => navigate("/admin/users")}
        onCancel={() => navigate("/admin/users")}
      />
    </QueryClientProvider>
  );
}
```

`useEditorState(routeId)` maps the route parameter to the editor's `id`: the
literal segment `new` (and a missing parameter) become `null`, i.e. the create
form. It needs no Router context of its own. It lives in the `./react-router`
entry because that entry is the one place allowed to import `react-router-dom`;
a project on another router derives `id` from its own route and passes it
directly.

### EditorPage props

| Prop                | Description                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | Entity name; forms the endpoint path.                                                                                                                                                                |
| `id`                | Record id, or `null` for the create form.                                                                                                                                                            |
| `basePath`          | Endpoint prefix, default `/api/admin/entities` (`DEFAULT_EDITOR_BASE`). An absolute URL works too.                                                                                                   |
| `fetch`             | Transport for every request the page and its fields make (`FetchLike`, i.e. `typeof fetch`). Defaults to the global `fetch`; see [Transport](#transport).                                            |
| `locale`            | BCP-47 tag used for `Intl` formatting in the header and read-only widgets, default `en-GB`. Not the key of keyed fields.                                                                             |
| `onSaved(id)`       | Called after a successful save. The page stays on the record — use it to put a freshly created id into the URL.                                                                                      |
| `onDeleted()`       | Called after a successful delete. The record is gone, so the page renders nothing until the host navigates away — use this to leave the record route.                                                |
| `onCancel()`        | Handler for "Back to list" in the header. The header renders no back button without it.                                                                                                              |
| `canDelete`         | Defaults to "the record already exists" (`id != null`). Pass `false` for read-mostly entities. The flag can only remove the button, never show it on the create form (there is no record to delete). |
| `maxWidthClassName` | Reading-width class on the form column, default `max-w-3xl`.                                                                                                                                         |
| `transformSchema`   | `(schema, uiSchema, formData) => { schema, uiSchema }`, applied to the envelope before rendering. Project-side schema tweaks live here.                                                              |
| `initialData`       | Preset values for the **create** form, read as a snapshot on mount and mixed into the envelope itself (so a preset is neither "dirty" nor lost on Reset).                                            |
| `messages`          | Partial `EditorMessages` overriding the English chrome strings.                                                                                                                                      |
| `fields`            | `RegistryFieldsType` merged **over** the built-in fields, keyed by `ui:field`.                                                                                                                       |
| `widgets`           | `RegistryWidgetsType` merged **over** the built-in widgets, keyed by `ui:widget`.                                                                                                                    |

### Transport

Every request goes through one function: the `fetch` prop when given, the
global `fetch` otherwise, always with `credentials: "include"`. A host that
needs an auth header, a CSRF token or another origin wraps `fetch` once and
passes the wrapper in; the fields that talk to the server on their own (the
relation and media pickers) receive the same wrapper through the form context.

```tsx
import type { FetchLike } from "@qrotux/editrig-shadcn-react";

const authedFetch: FetchLike = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

<EditorPage name="users" id={id} basePath="https://api.example.com/admin/entities" fetch={authedFetch} />;
```

The wrapper must pass `init` through untouched apart from what it adds: a
multipart submit relies on `fetch` deriving `Content-Type` from the `FormData`
body.

### Save, Reset and dirty state

The dirty baseline is the **last envelope the server sent** — the load response,
or the echo of the last successful save. `EditorPage` compares top-level keys of
the form data against `envelope.data` (with rjsf's `deepEquals`), and adds every
field that has a file staged for upload. Save and Reset are both disabled while
nothing differs.

Each changed field carries a revert control (`messages.revertField`) that puts
that one field back to the baseline. A key that was absent from the baseline is
removed rather than nulled, because the server reads `null` as a deliberate
clear and an absent key as "leave this column alone".

A save response replaces the whole envelope, so the server may swap the schema
on save (for example, unlocking fields once a record exists). The schema is
re-read from load and save responses only — nothing else re-renders it.

Fields the server marked `"ui:readonly": true` are stripped from every
create/update payload. That strip is hygiene; the Go engine strips them again
and remains the boundary.

### Cache invalidation

The envelope is cached by react-query under `["editor", name, id, base]` (the
`basePath` sits last so two pages on different bases but the same name and id do
not share an entry; `invalidateEntity` still matches by prefix). The create
schema (`id === null`) is cached with `staleTime: Infinity`; a loaded record is
always fresh-checked. `EditorPage` invalidates its own entry after a save and
the whole entity after a delete. From outside:

```ts
import { invalidateEntity } from "@qrotux/editrig-shadcn-react";

invalidateEntity(qc, "users"); // every record of the entity
invalidateEntity(qc, "users", "42"); // one record (null = the create schema)
```

Relation options are cached separately under
`["editor-options", base, entity, field, search, parent]` with a 60 s
`staleTime`.

## Messages and i18n

All chrome strings live in one dictionary:

```tsx
import { defaultEditorMessages, type EditorMessages } from "@qrotux/editrig-shadcn-react";

<EditorPage name="users" id={id} messages={{ save: "Сохранить", back: "К списку" }} />;
```

`messages` is a partial overlay on `defaultEditorMessages`, so the keys you do
not pass keep their English default. The dictionary covers exactly the frame the
library owns: loading and the load-failure prefix, Save/Saving/Saved and the
save-failure prefix, Delete/Deleting and the confirm
dialog, Reset and per-field revert, Back, Copy ID, the create hint, the
"Untitled" header fallback, select-all/none, the relation picker (select,
search, empty, remove, reorder), media upload (hint, remove, choose from
uploaded, the four rejection reasons, reorder, add more) and the clear control
of nullable date/time inputs.

Domain copy is deliberately **not** here. Field titles, descriptions, enum
labels, section headings, relation labels and validation messages all arrive
already localized inside the server envelope, because the server owns the
entity's vocabulary. A new user-visible chrome string is a new
`EditorMessages` key with an English default, never an inline literal.

## Extending with project-specific renderers

`fields` and `widgets` are merged **over** the built-in registries, so replacing
one renderer leaves the rest intact. The key is whatever the server declares in
`ui:field` / `ui:widget`:

```tsx
<EditorPage name="users" id={id} fields={{ media: MyMediaField }} />
```

Built-in `ui:field` keys: `json`, `keyed`, `relation`, `media`. Built-in
`ui:widget` keys: `readonlyDisplay`, `number`, `date`, `datetime`, `date-time`,
`localDatetime`, `localTime`. The `date` / `date-time` entries deliberately
shadow rjsf's format-resolved core widgets, whose "clear" path yields
`undefined`; `undefined` is dropped by `JSON.stringify`, which would turn
clearing a nullable column into "do not touch it".

A replacement renderer gets the same ambient state the built-ins use, through
two public helpers.

`useEditorForm()` returns the form-wide context rjsf does not thread down:

| Field                                      | Use                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `messages`                                 | the resolved `EditorMessages`                                                                |
| `setFieldValues(patch)`                    | shallow-merge a patch into the form data (rjsf gives object templates no whole-object write) |
| `disabled`                                 | true while saving or deleting                                                                |
| `dirtyFields`, `resetField(f)`             | the change markers and the per-field revert                                                  |
| `locale`                                   | BCP-47 tag for `Intl`                                                                        |
| `contentKey`, `setContentKey`              | the form-wide key of keyed fields, so switching one translation switches the others          |
| `entity`, `base`                           | what a field needs to call the API on its own                                                |
| `stagedFiles`, `stageFiles`, `clearStaged` | the not-yet-uploaded files, keyed by field name                                              |
| `isNew`, `recordId`                        | create vs. edit, and the id used as `?parent` when scoping a picker                          |
| `rootData`                                 | the root form data, for a field scoped by a sibling (`ui:options.parentField`)               |

`useRelationOptions(entity, field, search, enabled, base?, parent?, fetch?)` is
the option query behind the pickers. It stays idle while `enabled` is false, so
a form with four relation fields costs no requests until a picker is opened.
Pass `useEditorForm().fetch` as the last argument so a transport override
reaches the picker.

`MediaField` is exported so a project renderer can wrap it rather than copy it:
staging a file, building a preview and enforcing the client-side rejections is
most of the component.

## Wire protocol

Every request is sent with `credentials: "include"`. All paths are relative to
`basePath` (default `/api/admin/entities`, exported as `DEFAULT_EDITOR_BASE`).

| Request                                        | Meaning                                               |
| ---------------------------------------------- | ----------------------------------------------------- |
| `GET {base}/{name}/schema`                     | the create form: an envelope with `id: null`, no data |
| `GET {base}/{name}/entity/{id}`                | load one record                                       |
| `POST {base}/{name}/entity`                    | create; returns the saved envelope                    |
| `PATCH {base}/{name}/entity/{id}`              | update; returns the saved envelope                    |
| `DELETE {base}/{name}/entity/{id}`             | delete; `204`, no body                                |
| `GET {base}/{name}/options/{field}?q=&parent=` | relation/media options: `{ "options": [...] }`        |

The envelope is the whole contract:

```json
{
  "name": "users",
  "id": "42",
  "schema": { "type": "object", "required": ["title"], "properties": {} },
  "uiSchema": {},
  "data": {}
}
```

`schema` is a JSON Schema (rjsf `RJSFSchema`), `uiSchema` an rjsf `UiSchema`
carrying the library's declarative extensions, and `data` the record. Titles,
descriptions and enum labels inside them are already localized.

Create and update bodies are `{"data": {...}}`. The response of both is a full
envelope, which becomes the new baseline.

One option looks like `{"value": "...", "label": "..."}` — the label arrives
already localized. Labels of values that are **already selected** do not come
from this endpoint: the server ships them in the load envelope under the
field's `ui:options.labels`, so mounting a form costs no extra request. `q` is
the search term, `parent` scopes the list to an owner (the media picker asks
for the files of the record being edited).

### uiSchema extensions

Two keys live on the **root** uiSchema. rjsf lifts every root `ui:*` key into
the root object's `uiOptions` with the prefix stripped, so they reach the
library's templates untouched.

`ui:groups` is the section layout — an array of
`{ id, title?, description?, columns?: 1 | 2, toggleAll?, fields: string[] }`.
Fields named in no group fall through to an implicit trailing section, so a
newly added server-side column can never silently disappear.

`ui:header` is `{ titleField?, subtitleField?, metaFields? }`: which data fields
are promoted out of the form body into the record header. Meta labels come from
`schema.properties[f].title`. A meta field literally named `id` gets the copy
button — that one name is hardcoded, everything else about the header is
declarative.

Per-field, the library reads `"ui:readonly": true` (read-only, and stripped from
the payload), `ui:widget` and `ui:field` from the registry keys above, and
`ui:emptyValue` (what a cleared nullable field sends — `null` rather than
`undefined`). A read-only field is derived from its own entry alone; there is no
root-level list of read-only field names, and deliberately no root
`ui:readonly`, which rjsf would read as "disable the whole form".

The built-in fields and widgets read these `ui:options` keys:

| Renderer             | Key                             | Meaning                                                                                                                                   |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ui:field: relation` | `multi`                         | `true` for an array of ids (the schema is then `{type: "array", items: {type: "string"}}`); default a single id.                          |
|                      | `labels`                        | `{ [id]: label }` for the values already selected, so mounting the form costs no options request.                                         |
|                      | `parentField`                   | Name of a sibling field whose value is sent as `?parent=` when loading options; the list is then scoped by that field, not by the record. |
|                      | `collection`                    | Informational: the collection behind the field. Options are requested by field name.                                                      |
| `ui:field: media`    | `multi`, `labels`, `collection` | As for `relation`; a label is the thumbnail URL of the stored file.                                                                       |
|                      | `aspect`                        | Preview box ratio: `1:1` (default), `2:1`, `4:3` or `3:2`. Unknown values fall back to `1:1`.                                             |
|                      | `maxBytes`                      | Client-side size ceiling per file; default 10 MiB.                                                                                        |
|                      | `accept`                        | MIME allow-list, also used as the file input's `accept`; default `image/jpeg`, `image/png`, `image/webp`. HEIC/HEIF is always rejected.   |
| `ui:field: keyed`    | `keys`                          | `[{ value, label? }]`: the switchable keys (locales, tiers). Value and label travel together.                                             |
|                      | `default`                       | The key opened first when the form-wide key is not set.                                                                                   |
|                      | `layout`                        | `popover` (default), `chips` or `expanded`: how the key switcher is offered.                                                              |
|                      | `inner`                         | uiSchema of the inner field, one copy for every key (`"ui:widget": "textarea"`, …).                                                       |
| `ui:widget: number`  | `decimals`                      | Fixed number of decimals shown while the input is not focused.                                                                            |
| `ui:field: json`     | —                               | No options; a schema on the field drives the editor's own validation.                                                                     |

`relation` and `media` are **top-level fields only**. Both request options by
bare field name, and `media` additionally stages files and keys the multipart
part by that name, so the same field inside an array item or a nested object
would collide across rows. A nested `media` field degrades to a read-only view
of its value (with a `console.warn`); a nested `relation` still renders but its
picker shows an empty list, since the server does not know the nested name.

### Errors

A non-2xx response raises an `Error` carrying `status` and the parsed `body`.
The message is the body's `error` string when there is one, `HTTP <status>`
otherwise; that message is what a non-`422` failure shows in the form-level
alert. On `422` the body is:

```json
{
  "fieldErrors": [{ "field": "/email", "message": "already taken" }],
  "formErrors": []
}
```

`field` is a JSON Pointer (RFC 6901) rooted at the form data; `""` or `"/"`
means a form-level error. `toExtraErrors` folds the flat list into the nested
tree rjsf wants for `extraErrors`, and the errors block submit until the next
edit clears them. Any other failure (network, `500`) surfaces as a single
form-level alert prefixed with `messages.saveFailed`, and a failed initial load
renders an alert prefixed with `messages.loadFailed`. A `DELETE` that fails with
`formErrors` (a `409` on a record still referenced elsewhere) shows the server's
own text unprefixed, since it is already localized.

### File upload

A submit with staged files goes out as `multipart/form-data` instead of JSON:
a `payload` part carrying the same `{"data": ...}` JSON, plus one `file:<field>`
part per file (several parts under one name for a multi-value media field,
reassembled server-side in part order). `Content-Type` is never set by hand —
`fetch` derives it from the `FormData` body, together with the boundary. With
no staged files the request is byte-for-byte the plain JSON path.

Before a file is staged the client rejects HEIC/HEIF by extension, anything
outside `ui:options.accept` (falling back to `image/jpeg`, `image/png`,
`image/webp`), files over `ui:options.maxBytes` (falling back to 10 MiB) and a
batch that does not fit the field's `maxItems`. These are fast refusals, not the security boundary — the
server checks again.

## Golden fixture

`src/__fixtures__/synthetic-entity.json` is a dump of the envelope produced by
the Go side's own test, used verbatim as the `/schema` response in
`editor-page.test.tsx`. It is the drift gate between the two halves: when the Go
envelope changes shape, the fixture is re-dumped and this suite is what notices.
Never hand-edit it to make a test pass.

## Entries

| Entry            | Contents                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`              | `EditorPage`, `useEditorForm`, `useRelationOptions`, `MediaField`, `invalidateEntity`, `defaultEditorMessages`, the `FetchLike` transport type and the protocol types (`Envelope`, `EditorOption`, `EditorGroup`, `EditorHeaderSpec`, `FieldError`, `EditorErrors`, `DEFAULT_EDITOR_BASE`). |
| `./react-router` | `useEditorState(routeId)`; the entry reserved for `react-router-dom` bindings.                                                                                                                                                                                                              |

Everything else — the form templates, header, footer, confirm dialog, the
individual fields and widgets — is internal. Consumers customise through
`EditorPage` props and the declarative uiSchema keys.

The optional default theme is also published, imported from CSS rather than JS:
`@qrotux/editrig-shadcn-react/theme.css` (see [Styling](#styling)).

## Examples

[`examples/`](examples) holds complete, pastable pages — the minimal
react-router setup, driving `id` without a router, custom renderers, and testing
one through the public surface. They import the package by name and are checked
by `npm run typecheck` and `npm test`, so a breaking change to the public API
fails there. See [examples/README.md](examples/README.md).

## Development

```sh
npm install
npm run typecheck   # checks src and examples/
npm run lint
npm test
npm run build
```

Tests run on vitest with jsdom and Testing Library (`vitest.setup.ts` registers
jest-dom and stubs the `ResizeObserver` / pointer-capture APIs Radix expects).
The build is tsup, ESM only, two entries, unminified so the consumer's Tailwind
can read the class strings out of `dist`.

## Links

- Server: [editrig-go](https://github.com/qrotux/editrig-go)
- npm: [@qrotux/editrig-shadcn-react](https://www.npmjs.com/package/@qrotux/editrig-shadcn-react)

## Dependencies

Peer dependencies, installed by the host application:

- [react](https://github.com/facebook/react) and react-dom 19
- [@rjsf/core](https://github.com/rjsf-team/react-jsonschema-form), `@rjsf/shadcn`, `@rjsf/utils` and `@rjsf/validator-ajv8` 6.10 or later
- [@tanstack/react-query](https://github.com/TanStack/query) 5
- [lucide-react](https://github.com/lucide-icons/lucide)
- [react-router-dom](https://github.com/remix-run/react-router) 7, optional, for the `react-router` entry

Bundled: the [Radix UI](https://github.com/radix-ui/primitives) primitives
behind the shadcn components, [cmdk](https://github.com/pacocoursey/cmdk),
[vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) (loaded in
its own chunk, only for entities that have a JSON field),
`class-variance-authority`, `clsx` and `tailwind-merge`. Styling needs
[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) v4 in the host
project, see [Styling](#styling).

## License

MIT
