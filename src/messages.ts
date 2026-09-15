/** All localizable CHROME strings owned by the Editor library.
 *
 *  Deliberately excludes anything domain-shaped: field titles, enum labels,
 *  section headings and validation copy all arrive pre-localized inside the
 *  server envelope (schema/uiSchema), because the Go side is the SSOT for the
 *  entity's vocabulary. */
export type EditorMessages = {
  loading: string;
  /** Prefix for the alert shown when the initial load of the record fails; the
   *  server's own error text follows it. */
  loadFailed: string;
  save: string;
  saving: string;
  saved: string;
  /** Prefix for the form-level alert when a save fails for a non-field reason
   *  (network error, 500); the underlying error text follows it. A 422 renders
   *  per-field from the server instead. */
  saveFailed: string;
  delete: string;
  deleting: string;
  deleteFailed: string;
  /** Reset the form to the last loaded or saved envelope. */
  reset: string;
  /** Label of the per-field revert control, which doubles as the change marker. */
  revertField: string;
  back: string;
  copyId: string;
  confirmDeleteTitle: string;
  confirmDeleteBody: string;
  confirmDeleteConfirm: string;
  confirmDeleteCancel: string;
  selectAll: string;
  selectNone: string;
  /** Shown above the form in create mode. Create and edit share one schema,
   *  so the hint only flags which fields are required now; it must not promise
   *  that anything "unlocks after save". */
  createHint: string;
  /** Header fallback when the record has no title field value yet. */
  untitled: string;
  /** Relation picker chrome. The VALUES it shows are domain data and come from
   *  the server; these four strings are the frame around them. */
  relationSelect: string;
  relationSearch: string;
  relationEmpty: string;
  relationRemove: string;
  relationMoveLeft: string;
  relationMoveRight: string;
  /** Media field chrome. The picker reuses relationSearch/relationEmpty: it is
   *  the same Command popover as the relation field. */
  mediaUploadHint: string;
  mediaRemove: string;
  mediaChoose: string;
  mediaRejectHeic: string;
  mediaRejectMime: string;
  mediaRejectSize: string;
  /** Rejection by count: the batch does not fit under the field's
   *  `maxItems`. No number in the text; the counter next to the title shows
   *  how many slots remain. */
  mediaRejectCount: string;
  /** Multi-media grid chrome: thumbnail reordering and the "add" tile. */
  mediaMoveLeft: string;
  mediaMoveRight: string;
  mediaAddMore: string;
  /** aria-label and title of the clear control on nullable date/time inputs;
   *  the button itself renders only an icon. */
  clearValue: string;
};

export const defaultEditorMessages: EditorMessages = {
  loading: "Loading…",
  loadFailed: "Failed to load",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  saveFailed: "Save failed",
  delete: "Delete",
  deleting: "Deleting…",
  deleteFailed: "Delete failed",
  reset: "Reset",
  revertField: "Revert this change",
  back: "Back to list",
  copyId: "Copy ID",
  confirmDeleteTitle: "Delete this record?",
  confirmDeleteBody: "This cannot be undone. Records referenced elsewhere may refuse to delete.",
  confirmDeleteConfirm: "Delete",
  confirmDeleteCancel: "Cancel",
  selectAll: "Select all",
  selectNone: "Select none",
  createHint:
    "New record: required fields are marked — fill them in now, everything else can wait until later.",
  untitled: "Untitled",
  relationSelect: "Select a value",
  relationSearch: "Search…",
  relationEmpty: "Nothing found",
  relationRemove: "Remove",
  relationMoveLeft: "Move left",
  relationMoveRight: "Move right",
  mediaUploadHint: "Drop an image here, or click to upload",
  mediaRemove: "Remove",
  mediaChoose: "Choose from uploaded",
  mediaRejectHeic: "HEIC/HEIF images are not supported",
  mediaRejectMime: "Unsupported file type",
  mediaRejectSize: "File is too large",
  mediaRejectCount: "This field is full — remove an image to add another",
  mediaMoveLeft: "Move left",
  mediaMoveRight: "Move right",
  mediaAddMore: "Add images",
  clearValue: "Clear",
};
