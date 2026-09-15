import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { EditorHeader } from "./editor-header";
import { defaultEditorMessages } from "./messages";
import { UI_HEADER_KEY, type EditorHeaderSpec } from "./types";

afterEach(cleanup);

const schema: RJSFSchema = {
  type: "object",
  properties: {
    name: { title: "Name" },
  },
};

function uiSchemaWith(header: EditorHeaderSpec): UiSchema {
  return { [UI_HEADER_KEY]: header };
}

// Server-shaped localized text field, e.g. countries.name: `{en, ru, ...}`.
const localizedName = { en: "France", ru: "Франция" };

describe("EditorHeader — localized title field", () => {
  it("renders the interface-locale value for a known key (ru-RU → ru)", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: localizedName }}
        messages={defaultEditorMessages}
        locale="ru-RU"
      />,
    );
    expect(screen.getByRole("heading", { name: "Франция" })).toBeInTheDocument();
  });

  it("falls back to en for an unknown locale", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: localizedName }}
        messages={defaultEditorMessages}
        locale="kk-KZ"
      />,
    );
    expect(screen.getByRole("heading", { name: "France" })).toBeInTheDocument();
  });

  it("passes a plain string value through unchanged", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: "Plain Title" }}
        messages={defaultEditorMessages}
        locale="ru-RU"
      />,
    );
    expect(screen.getByRole("heading", { name: "Plain Title" })).toBeInTheDocument();
  });

  it("renders the untitled fallback for a null value", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: null }}
        messages={defaultEditorMessages}
        locale="ru-RU"
      />,
    );
    expect(screen.getByRole("heading", { name: defaultEditorMessages.untitled })).toBeInTheDocument();
  });

  it("falls back to en when the requested locale's value is an empty string", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: { en: "France", ru: "" } }}
        messages={defaultEditorMessages}
        locale="ru-RU"
      />,
    );
    expect(screen.getByRole("heading", { name: "France" })).toBeInTheDocument();
  });

  it("does not crash and does not render [object Object] for an array value", () => {
    render(
      <EditorHeader
        schema={schema}
        uiSchema={uiSchemaWith({ titleField: "name" })}
        data={{ name: ["France", "Francia"] }}
        messages={defaultEditorMessages}
        locale="ru-RU"
      />,
    );
    const heading = screen.getByRole("heading");
    expect(heading.textContent).not.toContain("[object Object]");
  });
});
