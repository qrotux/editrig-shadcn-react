import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import type { FieldProps } from "@rjsf/utils";

import { EditorFormProvider, type EditorFormContextValue } from "./form-context";
import { defaultEditorMessages } from "./messages";

// vanilla-jsoneditor is replaced with a fake instance so the guard around
// external-replace vs. own-edit can be exercised in jsdom (the real library
// pulls CodeMirror and does not mount here).
const setSpy = vi.fn();
const updatePropsSpy = vi.fn();
let capturedOnChange: ((c: unknown, p: unknown, s: unknown) => void) | undefined;

vi.mock("vanilla-jsoneditor", () => ({
  // Fresh object per call so a rebuilt validator is a new reference (the real
  // createAjvValidator returns a fresh function too).
  createAjvValidator: vi.fn(() => ({})),
  createJSONEditor: vi.fn((opts: { props: { onChange: typeof capturedOnChange } }) => {
    capturedOnChange = opts.props.onChange;
    return { set: setSpy, update: vi.fn(), updateProps: updatePropsSpy, destroy: vi.fn() };
  }),
}));

const JsonEditorImpl = (await import("./json-editor")).default;

const ctx: EditorFormContextValue = {
  messages: defaultEditorMessages,
  setFieldValues: () => {},
  disabled: false,
  dirtyFields: new Set<string>(),
  resetField: () => {},
  locale: "en-GB",
  entity: "users",
  base: "/api/admin/entities",
  stagedFiles: new Map(),
  stageFiles: () => {},
  clearStaged: () => {},
  isNew: false,
  recordId: "u-1",
};

function Harness({ initial }: { initial: Record<string, unknown> }) {
  const [data, setData] = React.useState<Record<string, unknown>>(initial);
  const props = {
    schema: {},
    formData: data,
    // rjsf v6 rebuilds every object level on change, so hand the edit back as a
    // structurally-equal but referentially-new object — exactly what used to
    // trip the identity guard.
    onChange: (next: unknown) => setData(next ? JSON.parse(JSON.stringify(next)) : {}),
    fieldPathId: { $id: "root_prefs", path: ["prefs"] as never },
  } as unknown as FieldProps;
  return (
    <EditorFormProvider value={ctx}>
      <JsonEditorImpl {...props} />
    </EditorFormProvider>
  );
}

describe("JsonEditorImpl — own edit vs external replace", () => {
  beforeEach(() => {
    setSpy.mockClear();
    capturedOnChange = undefined;
  });

  it("does not push the editor's own edit back into it (no cursor reset)", async () => {
    render(<Harness initial={{ a: 1 }} />);
    await waitFor(() => expect(capturedOnChange).toBeDefined());
    const setsAfterMount = setSpy.mock.calls.length;

    // The editor emits an edit; the form feeds an equal-but-new-ref envelope
    // back. The guard must recognise it as the editor's own value and skip set.
    act(() => {
      capturedOnChange!({ json: { a: 2 } }, {}, { contentErrors: undefined });
    });

    expect(setSpy.mock.calls.length).toBe(setsAfterMount);
    cleanup();
  });
});

function ExternalHarness({ data }: { data: Record<string, unknown> }) {
  const props = {
    schema: {},
    formData: data,
    onChange: () => {},
    fieldPathId: { $id: "root_prefs", path: ["prefs"] as never },
  } as unknown as FieldProps;
  return (
    <EditorFormProvider value={ctx}>
      <JsonEditorImpl {...props} />
    </EditorFormProvider>
  );
}

describe("JsonEditorImpl — external replace tracks the shown value", () => {
  beforeEach(() => {
    setSpy.mockClear();
    capturedOnChange = undefined;
  });

  it("re-applies a value the editor typed earlier when the form returns to it externally", async () => {
    const { rerender } = render(<ExternalHarness data={{ v: "A" }} />);
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    // The editor emits an edit to B; own.current becomes B.
    act(() => capturedOnChange!({ json: { v: "B" } }, {}, { contentErrors: undefined }));

    // External replace back to A (a Reset): the editor must be set to A.
    setSpy.mockClear();
    rerender(<ExternalHarness data={{ v: "A" }} />);
    expect(setSpy).toHaveBeenCalledWith({ json: { v: "A" } });

    // External replace to B again: since the editor now shows A, it must be set
    // to B — the stale own.current must not swallow this as "the editor's own".
    setSpy.mockClear();
    rerender(<ExternalHarness data={{ v: "B" }} />);
    expect(setSpy).toHaveBeenCalledWith({ json: { v: "B" } });
    cleanup();
  });
});

function SchemaHarness({ schema }: { schema: object }) {
  const props = {
    schema,
    formData: {},
    onChange: () => {},
    fieldPathId: { $id: "root_prefs", path: ["prefs"] as never },
  } as unknown as FieldProps;
  return (
    <EditorFormProvider value={ctx}>
      <JsonEditorImpl {...props} />
    </EditorFormProvider>
  );
}

describe("JsonEditorImpl — schema swap", () => {
  beforeEach(() => {
    updatePropsSpy.mockClear();
    capturedOnChange = undefined;
  });

  it("refreshes the validator when the field schema changes on the fly", async () => {
    const { rerender } = render(<SchemaHarness schema={{ type: "object", maxProperties: 1 }} />);
    await waitFor(() => expect(capturedOnChange).toBeDefined());

    // A save that swaps the field's schema must reach the mounted editor's
    // validator; otherwise it keeps judging by the old constraints.
    updatePropsSpy.mockClear();
    rerender(<SchemaHarness schema={{ type: "object", maxProperties: 5 }} />);
    expect(updatePropsSpy).toHaveBeenCalledWith(expect.objectContaining({ validator: expect.anything() }));
    cleanup();
  });
});
