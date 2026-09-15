import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { useEditorState } from "./use-editor-url-state";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>;
}

describe("useEditorState", () => {
  it('normalizes the "new" route segment to null (create mode)', () => {
    const { result } = renderHook(() => useEditorState("new"), { wrapper });
    expect(result.current).toEqual({ id: null });
  });

  it("normalizes undefined to null", () => {
    const { result } = renderHook(() => useEditorState(undefined), { wrapper });
    expect(result.current).toEqual({ id: null });
  });

  it("passes through a real id (edit mode)", () => {
    const { result } = renderHook(() => useEditorState("abc"), { wrapper });
    expect(result.current).toEqual({ id: "abc" });
  });
});

// The hook derives everything from its argument, so a page that reads the
// param itself must be able to call it outside any Router context.
describe("useEditorState — without a Router", () => {
  it("works when no router is mounted above it", () => {
    const { result } = renderHook(() => useEditorState("abc"));
    expect(result.current).toEqual({ id: "abc" });
  });
});
