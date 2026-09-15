import { describe, it, expect } from "vitest";

import { toExtraErrors } from "./errors";

describe("toExtraErrors", () => {
  it("maps a flat field pointer to a top-level __errors leaf", () => {
    const { extraErrors, formErrors } = toExtraErrors([{ field: "/email", message: "x" }]);
    expect(extraErrors).toEqual({ email: { __errors: ["x"] } });
    expect(formErrors).toEqual([]);
  });

  it("maps a nested pointer to a nested __errors leaf", () => {
    const { extraErrors } = toExtraErrors([{ field: "/a/b", message: "y" }]);
    expect(extraErrors).toEqual({ a: { b: { __errors: ["y"] } } });
  });

  it("splits form-level errors (empty field) into formErrors, not extraErrors", () => {
    const { extraErrors, formErrors } = toExtraErrors([{ field: "", message: "z" }]);
    expect(extraErrors).toEqual({});
    expect(formErrors).toEqual(["z"]);
  });

  it("combines the AC example: flat + nested + form-level in one call", () => {
    const { extraErrors, formErrors } = toExtraErrors([
      { field: "/email", message: "x" },
      { field: "/a/b", message: "y" },
      { field: "", message: "z" },
    ]);
    expect(extraErrors).toEqual({ email: { __errors: ["x"] }, a: { b: { __errors: ["y"] } } });
    expect(formErrors).toEqual(["z"]);
  });

  it("treats the root pointer '/' as a form-level error too", () => {
    const { extraErrors, formErrors } = toExtraErrors([{ field: "/", message: "root" }]);
    expect(extraErrors).toEqual({});
    expect(formErrors).toEqual(["root"]);
  });

  it("maps an array-index pointer to a numeric-keyed nested leaf", () => {
    const { extraErrors } = toExtraErrors([{ field: "/items/0/name", message: "required" }]);
    expect(extraErrors).toEqual({ items: { 0: { name: { __errors: ["required"] } } } });
  });

  it("merges multiple errors on the same leaf into one __errors array", () => {
    const { extraErrors } = toExtraErrors([
      { field: "/email", message: "too short" },
      { field: "/email", message: "invalid format" },
    ]);
    expect(extraErrors).toEqual({ email: { __errors: ["too short", "invalid format"] } });
  });

  it("unescapes JSON-Pointer ~1 (/) and ~0 (~) tokens", () => {
    const { extraErrors } = toExtraErrors([{ field: "/a~1b", message: "x" }]);
    expect(extraErrors).toEqual({ "a/b": { __errors: ["x"] } });
  });
});
