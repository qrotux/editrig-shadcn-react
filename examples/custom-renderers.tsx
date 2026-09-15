// Replacing renderers without forking the library. `fields` and `widgets` are
// merged OVER the built-ins, keyed by whatever the server declares in
// `ui:field` / `ui:widget`, so you swap one renderer and the rest stay intact.
// A replacement gets the same ambient state the built-ins use through
// `useEditorForm()` and `useRelationOptions()`, and can wrap the exported
// `MediaField` rather than reimplement file staging.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FieldProps, WidgetProps } from "@rjsf/utils";
import {
  EditorPage,
  MediaField,
  useEditorForm,
  useRelationOptions,
  type FetchLike,
  type EditorMessages,
} from "@qrotux/editrig-shadcn-react";

const queryClient = new QueryClient();

// A widget keyed by `ui:widget: "color"`. Widgets render leaf scalars; this one
// pairs a native colour input with the hex text. rjsf passes value/onChange.
function ColorWidget({ id, value, disabled, readonly, onChange }: WidgetProps) {
  const current = typeof value === "string" ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="color"
        value={current}
        disabled={disabled || readonly}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-muted-foreground font-mono text-sm">{current}</span>
    </div>
  );
}

// A field keyed by `ui:field: "relation"`, replacing the built-in picker with a
// plain <select>. It reads the ambient entity/base/transport from context and
// runs the same option query the built-in uses; `enabled` keeps it idle until
// the field is actually interacted with.
function SelectRelationField({ schema, formData, onChange, fieldPathId }: FieldProps) {
  const { entity, base, fetch: fetchImpl, recordId } = useEditorForm();
  const [touched, setTouched] = useState(false);
  const fieldName = fieldPathId.$id.replace(/^root_/, "");
  const query = useRelationOptions(entity, fieldName, "", touched, base, recordId ?? undefined, fetchImpl);
  const value = typeof formData === "string" ? formData : "";

  return (
    <label className="flex flex-col gap-1">
      {schema.title && <span className="text-sm font-medium">{schema.title}</span>}
      <select
        className="border-input rounded-md border px-3 py-2"
        value={value}
        onFocus={() => setTouched(true)}
        onChange={(e) => onChange(e.target.value, fieldPathId.path)}
      >
        <option value="">—</option>
        {(query.data ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Wrapping the built-in MediaField rather than copying it: staging a file,
// building a preview and enforcing the client-side rejections is most of the
// component, so a project usually only adds chrome around it.
function LabelledMediaField(props: FieldProps) {
  const { messages } = useEditorForm();
  return (
    <div className="flex flex-col gap-1">
      <MediaField {...props} />
      <span className="text-muted-foreground text-xs">{messages.mediaUploadHint}</span>
    </div>
  );
}

// Add an auth header (or a CSRF token, or another origin) by wrapping fetch
// once. Every request the page and its fields make goes through it. Pass `init`
// through untouched apart from what you add, or a multipart submit breaks.
function makeAuthedFetch(token: string): FetchLike {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

// Only the chrome the library owns is overridden here; domain copy (titles,
// enum labels, section headings) arrives already localized in the envelope.
const russianMessages: Partial<EditorMessages> = {
  save: "Сохранить",
  reset: "Сбросить",
  back: "К списку",
};

export function CustomizedEditorPage({ token }: { token: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <EditorPage
        name="products"
        id="42"
        fetch={makeAuthedFetch(token)}
        messages={russianMessages}
        widgets={{ color: ColorWidget }}
        fields={{ relation: SelectRelationField, media: LabelledMediaField }}
        // Project-side schema tweaks: e.g. hide an internal field the server
        // still sends. Runs on the envelope before rendering.
        transformSchema={(schema, uiSchema) => ({
          schema,
          uiSchema: { ...uiSchema, internal_notes: { "ui:widget": "hidden" } },
        })}
      />
    </QueryClientProvider>
  );
}
