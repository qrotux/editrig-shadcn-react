import * as React from "react";

import { defaultEditorMessages, type EditorMessages } from "./messages";
import type { FetchLike } from "./use-editor";
import { DEFAULT_EDITOR_BASE } from "./types";

/** Ambient state the library's rjsf templates need but rjsf itself does not
 *  thread down.
 *
 *  ObjectFieldTemplateProps carries `formData` but NO whole-object onChange
 *  (only `onAddProperty`), so a section-level control such as "select all"
 *  cannot write back through rjsf. EditorPage owns `formData` state anyway,
 *  so it publishes a patch callback here instead — no fork of rjsf, no
 *  per-entity wiring. */
export type EditorFormContextValue = {
  messages: EditorMessages;
  /** Shallow-merge a patch into the form data (re-renders the controlled Form). */
  setFieldValues: (patch: Record<string, unknown>) => void;
  disabled: boolean;
  /** Names of TOP-LEVEL fields whose value diverges from the last loaded or
   *  saved envelope. Computed by EditorPage, the only holder of both the current
   *  data and the baseline; the object template draws the change marker from
   *  this set. */
  dirtyFields: ReadonlySet<string>;
  /** Reverts ONE field to the baseline — the change marker's action. Separate
   *  from `setFieldValues` because only EditorPage knows the baseline, and its
   *  "the key was absent from the baseline" semantics (deleted, not nulled). */
  resetField: (field: string) => void;
  /** BCP-47 tag for Intl formatting inside widgets (read-only timestamps).
   *  NOT the key of keyed fields: this one drives Intl, that one drives which
   *  translation is being edited. One name for both would format dates by the
   *  content language. */
  locale: string;
  /** Form-wide key of keyed fields (see keyed-field.tsx): the last key the
   *  admin switched to. Fields the admin has not pinned by hand follow it, so
   *  switching one field to "ru" shows every other translation in "ru" too.
   *  Undefined ⇒ each field opens on its own declared default. */
  contentKey?: string;
  setContentKey?: (key: string) => void;
  /** Entity name and API base of the form being rendered. Fields that talk to
   *  the server on their own (the relation picker asks
   *  `{base}/{entity}/options/{field}`) cannot derive either from rjsf props —
   *  those only ever describe the field, never the page around it. */
  entity: string;
  base: string;
  /** The transport override EditorPage was given; a field that calls the API
   *  on its own passes it to `useRelationOptions`. Undefined ⇒ global fetch. */
  fetch?: FetchLike;
  /** Files chosen for media fields but NOT yet uploaded: the field's value is a
   *  media-row id, and putting a File there would feed it to rjsf's structural
   *  validation, which expects a string. Keyed by field name; the value is a
   *  queue of files (a multi-media field has several). EditorPage clears the map
   *  itself after a successful submit. */
  stagedFiles: Map<string, File[]>;
  /** Set or clear a field's staged files. `files === null` drops every staged
   *  file of the field (e.g. a pre-submit clear, or picking from the library);
   *  an array REPLACES the field's queue wholesale — the caller does the
   *  splicing, because only it knows whether this is an append or a replace. */
  stageFiles: (field: string, files: File[] | null) => void;
  clearStaged: () => void;
  /** true on the CREATE form (no curId yet). A media field uses this to hide
   *  "choose from uploaded": the picker filters the library by owner
   *  (`?parent=<id>`), and before the first save the owner row does not exist
   *  yet. It comes from EditorPage rather than being inferred from an empty
   *  field value — the same field is also empty on an edit form. */
  isNew: boolean;
  /** Id of the record being edited — a media field needs it as the `parent` for
   *  `/options/{field}` so the picker shows this owner's files, not the whole
   *  collection. null on the create form (see isNew). */
  recordId: string | null;
  /** The form's current ROOT data. Needed by a field whose option source is
   *  scoped by a sibling (a relation with ui:options.parentField): rjsf gives a
   *  field only its own value, while the parent lives in the sibling. */
  rootData?: Record<string, unknown>;
};

const EditorFormContext = React.createContext<EditorFormContextValue>({
  messages: defaultEditorMessages,
  setFieldValues: () => {},
  disabled: false,
  dirtyFields: new Set<string>(),
  resetField: () => {},
  locale: "en-GB",
  entity: "",
  base: DEFAULT_EDITOR_BASE,
  stagedFiles: new Map(),
  stageFiles: () => {},
  clearStaged: () => {},
  isNew: false,
  recordId: null,
});

export function EditorFormProvider({
  value,
  children,
}: {
  value: EditorFormContextValue;
  children: React.ReactNode;
}) {
  return <EditorFormContext.Provider value={value}>{children}</EditorFormContext.Provider>;
}

export function useEditorForm(): EditorFormContextValue {
  return React.useContext(EditorFormContext);
}
