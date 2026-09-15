import * as React from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { getUiOptions, type RJSFSchema, type UiSchema } from "@rjsf/utils";

import { Button } from "./ui/button";

import type { EditorHeaderSpec } from "./types";
import type { EditorMessages } from "./messages";

/** Page header for an edited record: title/subtitle plus the read-only
 *  bookkeeping columns (id, created_at, updated_at) that stay
 *  `ui:widget: hidden` in the form body.
 *
 *  Entity-agnostic: everything it shows is named by `ui:header` on the root
 *  uiSchema, and the meta labels are taken from `schema.properties[f].title`
 *  — i.e. already localized by the server, no second catalog. */
export function EditorHeader({
  schema,
  uiSchema,
  data,
  messages,
  locale,
  onBack,
}: {
  schema: RJSFSchema;
  uiSchema: UiSchema;
  data: Record<string, unknown>;
  messages: EditorMessages;
  locale: string;
  onBack?: () => void;
}) {
  const spec = readHeaderSpec(uiSchema);
  const title = spec.titleField ? asText(data[spec.titleField], locale) : "";
  const subtitle = spec.subtitleField ? asText(data[spec.subtitleField], locale) : "";
  const props = (schema.properties ?? {}) as Record<string, { title?: string }>;

  const meta = (spec.metaFields ?? [])
    .map((f) => ({ field: f, label: props[f]?.title ?? f, value: data[f] }))
    .filter((m) => m.value !== undefined && m.value !== null && m.value !== "");

  if (!spec.titleField && !spec.subtitleField && meta.length === 0 && !onBack) return null;

  return (
    <header className="mb-6 flex flex-col gap-3">
      {onBack && (
        <div>
          <Button type="button" variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
            <ArrowLeft /> {messages.back}
          </Button>
        </div>
      )}
      {(spec.titleField || spec.subtitleField) && (
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title || messages.untitled}</h1>
          {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
        </div>
      )}
      {meta.length > 0 && (
        <dl className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          {meta.map((m) => (
            <div key={m.field} className="flex items-center gap-1.5">
              <dt className="font-medium">{m.label}:</dt>
              <dd className="flex items-center gap-1">
                <span className="font-mono">{formatMeta(m.value, locale)}</span>
                {m.field === "id" && <CopyButton value={asText(m.value)} label={messages.copyId} />}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6"
      aria-label={label}
      title={label}
      onClick={() => {
        // clipboard is undefined in jsdom and on non-secure origins — optional
        // chaining keeps the header from throwing there.
        void navigator.clipboard?.writeText(value);
        setDone(true);
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  );
}

function readHeaderSpec(uiSchema: UiSchema): EditorHeaderSpec {
  const raw = getUiOptions(uiSchema).header;
  if (!raw || typeof raw !== "object") return {};
  return raw as EditorHeaderSpec;
}

/** Locale arrives BCP-47 ("ru-RU"), map-field keys are short ("ru"): match on
 *  the first segment, or nothing would ever line up. */
function asText(v: unknown, locale?: string): string {
  if (v == null) return "";
  if (typeof v === "object" && !Array.isArray(v)) {
    // Localized text field (a map like `{en, ru, ...}`): show the interface
    // language, with the same fallback to `en` the server applies in the
    // grid (COALESCE(<locale>, en)). `??` alone would not fall through an
    // EMPTY string (only null/undefined), so an empty-string locale value
    // needs an explicit check ahead of it — pick the first non-empty string
    // among: short-locale key, `en`, then any remaining value.
    const map = v as Record<string, unknown>;
    const short = locale?.split("-")[0] ?? "";
    const candidates = [map[short], map.en, ...Object.values(map)];
    const pick = candidates.find((x) => typeof x === "string" && x !== "");
    return pick == null ? "" : String(pick);
  }
  return String(v);
}

/** RFC3339 timestamps (the only non-scalar shape the server puts in meta
 *  fields) render through Intl; everything else passes through as text. */
function formatMeta(v: unknown, locale: string): string {
  const s = asText(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}
