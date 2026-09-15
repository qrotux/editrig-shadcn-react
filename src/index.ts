// The root entry. The page, cache invalidation, the message dictionary and the
// protocol types are public; the templates, header, footer, confirm dialog and
// errors module are not, so consumers customise only through EditorPage props
// and the declarative uiSchema keys (ui:groups/ui:header).
//
// The second half is material for a project-side renderer (EditorPage's
// fields/widgets props): the form context, the option query, the transport
// type and the media field itself. Without them registry overrides would be
// decorative, since a replacement media component would have to copy
// media-field.tsx to stage a file or build a preview.
export { EditorPage, type EditorPageProps } from "./editor-page";
export { useEditorForm, type EditorFormContextValue } from "./form-context";
export { useRelationOptions, type FetchLike } from "./use-editor";
export { MediaField } from "./media-field";
export { type EditorOption } from "./types";
export { invalidateEntity } from "./use-editor";
export { defaultEditorMessages, type EditorMessages } from "./messages";

export {
  type FieldError,
  type EditorErrors,
  type Envelope,
  type EditorGroup,
  type EditorHeaderSpec,
  DEFAULT_EDITOR_BASE,
} from "./types";
