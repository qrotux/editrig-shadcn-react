import type { ErrorSchema } from "@rjsf/utils";

import type { FieldError } from "./types";

// Flat JSON-Pointer field-error list (as returned by the server on a 422) →
// nested rjsf ErrorSchema tree, for `extraErrors`. Form-level errors (empty
// or root pointer) are split out separately since rjsf has no root leaf.
export function toExtraErrors(fieldErrors: FieldError[]): { extraErrors: ErrorSchema; formErrors: string[] } {
  const extraErrors: ErrorSchema = {};
  const formErrors: string[] = [];
  for (const { field, message } of fieldErrors) {
    if (!field || field === "/") {
      formErrors.push(message);
      continue;
    }
    const tokens = field
      .replace(/^\//, "")
      .split("/")
      .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
    let node: Record<string, unknown> = extraErrors as Record<string, unknown>;
    for (const t of tokens.slice(0, -1)) node = (node[t] ??= {}) as Record<string, unknown>;
    const leaf = (node[tokens[tokens.length - 1]] ??= {}) as { __errors?: string[] };
    (leaf.__errors ??= []).push(message);
  }
  return { extraErrors, formErrors };
}
