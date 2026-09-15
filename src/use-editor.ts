import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";

import { DEFAULT_EDITOR_BASE, type EditorOption, type Envelope } from "./types";

/** The transport the hooks use. Defaults to the global `fetch`; a host that
 *  needs auth headers, a CSRF token or another origin passes its own wrapper
 *  (`EditorPage`'s `fetch` prop). Resolved at call time so a test can still
 *  stub the global. */
export type FetchLike = typeof fetch;

async function fetchJSON<T>(fetchImpl: FetchLike | undefined, url: string, init?: RequestInit): Promise<T> {
  const res = await (fetchImpl ?? fetch)(url, { credentials: "include", ...init });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${res.status}`), {
      status: res.status,
      body,
    });
  return body as T;
}
// Path segments are percent-encoded, query keys stay raw. An id can be a slug
// with "/", "?", "#" or a space (react-router hands `useEditorState` the
// already-decoded route param), and without encoding it would mis-route the
// request onto a different record. `invalidateEntity` and the cache keys use
// the raw values, so encoding lives only at the URL, not in the keys.
const seg = (s: string): string => encodeURIComponent(s);

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data }),
});

// Multipart body for a submit with staged files: a "payload" part carrying the
// same JSON as the plain path, plus one "file:<field>" part per staged file
// (see stagedFiles in form-context.tsx). Content-Type is never set by hand:
// with a FormData body fetch derives it together with the boundary, and a
// hand-written header has no boundary, so the server could not split the parts.
function multipart(method: string, data: unknown, files: Map<string, File[]>): RequestInit {
  const fd = new FormData();
  fd.append("payload", JSON.stringify({ data }));
  // One part per file under the field's name: the server reassembles them into
  // a list in part order.
  for (const [field, list] of files) for (const file of list) fd.append(`file:${field}`, file);
  return { method, body: fd };
}

// No files ⇒ the plain JSON body; at least one ⇒ multipart for the whole submit.
const requestInit = (method: string, data: unknown, files?: Map<string, File[]>): RequestInit =>
  files && files.size > 0 ? multipart(method, data, files) : json(method, data);

export function useEntity(
  name: string,
  id: string | null,
  base = DEFAULT_EDITOR_BASE,
  fetchImpl?: FetchLike,
  enabled = true,
) {
  return useQuery({
    // `base` sits LAST so the existing prefix-based invalidateEntity keys
    // (["editor", name] and ["editor", name, id]) still match; without it two
    // pages on different bases but the same name/id would share one entry.
    queryKey: ["editor", name, id, base],
    queryFn: () =>
      fetchJSON<Envelope>(
        fetchImpl,
        id == null ? `${base}/${seg(name)}/schema` : `${base}/${seg(name)}/entity/${seg(id)}`,
      ),
    staleTime: id == null ? Infinity : 0,
    enabled,
  });
}
/** Options of one relation field: search (`q`) or nothing (first page).
 *
 *  Labels of ALREADY SELECTED values do NOT come from here — the server ships
 *  them inside the Load envelope's uiSchema (`ui:options.labels`), so mounting
 *  a form costs no extra request. This hook fires only when the picker opens.
 *
 *  `enabled` keeps the query from running while the popover is closed: a form
 *  with four relation fields would otherwise hit the API four times on mount
 *  for lists nobody asked to see. */
export function useRelationOptions(
  entity: string,
  field: string,
  search: string,
  enabled: boolean,
  base = DEFAULT_EDITOR_BASE,
  // Owner the media picker scopes the library by (`?parent=<id>`). It must be
  // part of the cache key: both records hit the same `/options/{field}` path,
  // so without it one record's list would be served to another from cache.
  parent?: string,
  fetchImpl?: FetchLike,
) {
  return useQuery({
    queryKey: ["editor-options", base, entity, field, search, parent],
    queryFn: () => {
      const qs = new URLSearchParams({ q: search });
      if (parent) qs.set("parent", parent);
      return fetchJSON<{ options: EditorOption[] }>(
        fetchImpl,
        `${base}/${seg(entity)}/options/${seg(field)}?${qs.toString()}`,
      ).then((body) => body.options ?? []);
    },
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreate(name: string, base = DEFAULT_EDITOR_BASE, fetchImpl?: FetchLike) {
  return useMutation({
    mutationFn: (vars: { data: Record<string, unknown>; files?: Map<string, File[]> }) =>
      fetchJSON<Envelope>(
        fetchImpl,
        `${base}/${seg(name)}/entity`,
        requestInit("POST", vars.data, vars.files),
      ),
  });
}
export function useUpdate(name: string, id: string, base = DEFAULT_EDITOR_BASE, fetchImpl?: FetchLike) {
  return useMutation({
    mutationFn: (vars: { data: Record<string, unknown>; files?: Map<string, File[]> }) =>
      fetchJSON<Envelope>(
        fetchImpl,
        `${base}/${seg(name)}/entity/${seg(id)}`,
        requestInit("PATCH", vars.data, vars.files),
      ),
  });
}
export function useDelete(name: string, id: string, base = DEFAULT_EDITOR_BASE, fetchImpl?: FetchLike) {
  return useMutation({
    mutationFn: () =>
      fetchJSON<void>(fetchImpl, `${base}/${seg(name)}/entity/${seg(id)}`, { method: "DELETE" }),
  });
}
export function invalidateEntity(qc: QueryClient, name: string, id?: string | null) {
  return qc.invalidateQueries({ queryKey: id === undefined ? ["editor", name] : ["editor", name, id] });
}
