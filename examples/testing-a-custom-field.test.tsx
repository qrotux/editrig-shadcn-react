// Testing a custom renderer through the public surface: mount `EditorPage` with
// a mocked `fetch` and your renderer in the `fields` prop. EditorPage supplies
// the form context, so a renderer that calls `useEditorForm()` works without
// any test-only provider. Runs as part of `npm test`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { EditorPage, useEditorForm } from "@qrotux/editrig-shadcn-react";

// The renderer under test. Keyed by `ui:field: "relation"`, it reads ambient
// state (here the entity name) the same way a real custom field would.
function TaggedRelationField({ schema }: FieldProps) {
  const { entity } = useEditorForm();
  return (
    <div data-testid="custom-relation">
      {String(schema.title)} for {entity}
    </div>
  );
}

const envelope = {
  name: "widgets",
  id: "1",
  schema: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", title: "Title" },
      author: { type: "string", title: "Author" },
    },
  },
  uiSchema: {
    author: { "ui:field": "relation", "ui:options": { collection: "users" } },
  },
  data: { title: "Hello", author: "" },
};

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const body = url.endsWith("/entity/1") ? envelope : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a custom relation field", () => {
  it("renders through EditorPage and receives the form context", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <EditorPage name="widgets" id="1" fields={{ relation: TaggedRelationField }} />
      </QueryClientProvider>,
    );
    const node = await screen.findByTestId("custom-relation");
    // Plain DOM assertion, so the example needs no jest-dom matcher types.
    expect(node.textContent).toContain("Author for widgets");
  });
});
