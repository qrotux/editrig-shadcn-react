import type { RJSFSchema, UiSchema } from "@rjsf/utils";

// Protocol types shared with the server's entity-editor endpoints (see the
// README's "Wire protocol" section). Field paths in `FieldError.field` are
// JSON Pointers (RFC 6901), rooted at the form's data (e.g. "/email", "/a/b");
// "" (or "/") denotes a form-level error.
export type FieldError = { field: string; message: string };
export type EditorErrors = { fieldErrors: FieldError[]; formErrors: string[] };
export type Envelope = {
  name: string;
  id: string | null;
  schema: RJSFSchema;
  uiSchema: UiSchema;
  data: Record<string, unknown>;
};

export const DEFAULT_EDITOR_BASE = "/api/admin/entities";

/** One value of a relation field, as served by
 *  `GET {base}/{entity}/options/{field}`. The label arrives already localized,
 *  so this library never needs to know where a collection keeps its names. */
export type EditorOption = { value: string; label: string };

// --- Declarative uiSchema extensions -------------------------------------
// Both live on the ROOT uiSchema under `ui:groups` / `ui:header`. rjsf's
// getUiOptions() lifts EVERY `ui:*` key into uiOptions with the prefix
// stripped, so these arrive at our templates untouched. Titles/descriptions
// come down ALREADY LOCALIZED — the server owns domain copy, this library
// owns only chrome (see EditorMessages).

/** One form section. Fields listed here render together under `title`;
 *  fields named in no group fall through to an implicit trailing section, so
 *  a newly added server-side column can never silently disappear. */
export type EditorGroup = {
  /** Stable section key (React key / test hook). */
  id: string;
  title?: string;
  description?: string;
  /** Field layout inside the section. Default 1. */
  columns?: 1 | 2;
  /** Render a "select all / none" control for the section's boolean fields. */
  toggleAll?: boolean;
  fields: string[];
};

/** Page-header spec: which data fields to promote out of the form body.
 *  Meant for identity + read-only bookkeeping columns (id/created/updated)
 *  that are `ui:widget: hidden` in the form itself. */
export type EditorHeaderSpec = {
  titleField?: string;
  subtitleField?: string;
  metaFields?: string[];
};

export const UI_GROUPS_KEY = "ui:groups";
export const UI_HEADER_KEY = "ui:header";

/** Field names the server owns exclusively (counters, lifecycle timestamps,
 *  columns without an editor).
 *
 *  Derived, not declared: a field is read-only iff its own uiSchema entry
 *  carries `{"ui:readonly": true}`. A second, root-level list would be one
 *  fact declared twice, which is exactly what drifts; the server derives the
 *  same way, so both halves read one source.
 *
 *  Root `ui:*` keys are extensions (ui:order/ui:groups/ui:header), not fields:
 *  a property name cannot start with "ui:", so the discriminator is exact.
 *
 *  Note there is deliberately no root `ui:readonly`: rjsf lifts every root
 *  `ui:*` key into the root object's own uiOptions, and a truthy value there
 *  would disable the whole form.
 *
 *  The Go engine strips these keys from every create/update payload, so this
 *  client-side strip is hygiene, not the security boundary. */
export function readReadonlyFields(uiSchema: UiSchema | undefined): string[] {
  const doc = uiSchema as Record<string, unknown> | undefined;
  if (!doc) return [];
  return Object.entries(doc)
    .filter(([key, entry]) => {
      if (key.startsWith("ui:")) return false;
      return (
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)["ui:readonly"] === true
      );
    })
    .map(([key]) => key)
    .sort();
}
