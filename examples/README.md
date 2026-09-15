# Examples

Source snippets, not a runnable application. Each file is a complete page you
can paste into your own app and adjust. They import the package by name, so what
you read is what a consumer writes; `tsconfig.json` here maps those specifiers
to `../src` so `npm run typecheck` fails whenever a change breaks them, and
`vitest.config.ts` aliases them the same way for the example test.

They assume a server that speaks the wire protocol from the root
[README](../README.md), such as [editrig-go](https://github.com/qrotux/editrig-go).

| File                                                               | Shows                                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [basic-react-router.tsx](basic-react-router.tsx)                   | The minimal page: a query client, `useEditorState` from `./react-router`, `EditorPage`, and a second entity served from a non-default `basePath`.                                  |
| [url-state-without-router.tsx](url-state-without-router.tsx)       | Supplying `id` without react-router — from the History API, or from component state in a master/detail pane.                                                                       |
| [custom-renderers.tsx](custom-renderers.tsx)                       | A `ui:widget` override, a `ui:field` override reading context via `useEditorForm` and `useRelationOptions`, wrapping the exported `MediaField`, an authed `fetch`, and `messages`. |
| [testing-a-custom-field.test.tsx](testing-a-custom-field.test.tsx) | Testing a custom renderer through the public surface: mount `EditorPage` with a mocked `fetch`; it supplies the context. Runs as part of `npm test`.                               |

## Checking them

From the repository root:

```sh
npm run typecheck   # includes examples/
npm run lint
npm test            # runs testing-a-custom-field.test.tsx too
```
