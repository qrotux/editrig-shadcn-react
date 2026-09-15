import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "./ui/button";

import { ConfirmDialog } from "./confirm-dialog";
import type { EditorMessages } from "./messages";

/** Sticky form footer: Save (submit) + Reset on the left, Delete on the
 *  right, all shadcn Buttons, all pending-aware.
 *
 *  Навигации здесь нет намеренно: ни Save, ни Reset форму не покидают —
 *  уходят с неё только через «Back to list» в шапке.
 *
 *  Rendered as `<Form>`'s children, which is exactly how rjsf lets you replace
 *  its default (unlabelled, unstyled) "Submit" button —
 *  `@rjsf/core` Form.js: `children || <SubmitButton/>`. Deleting confirms
 *  through the library's ConfirmDialog; the caller only supplies `onDelete`. */
export function EditorActions({
  messages,
  saving,
  deleting,
  dirty,
  canDelete,
  onDelete,
  onReset,
  savedAt,
}: {
  messages: EditorMessages;
  saving: boolean;
  deleting: boolean;
  /** Есть ли расхождение с последним конвертом сервера. Гасит и Save, и Reset:
   *  сохранять нечего, откатывать тоже. */
  dirty: boolean;
  canDelete: boolean;
  onDelete?: () => void;
  onReset?: () => void;
  /** Timestamp of the last successful save; drives the transient "Saved" note. */
  savedAt: number | null;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const busy = saving || deleting;

  return (
    <div className="bg-background sticky bottom-0 z-10 mt-8 flex items-center justify-between gap-3 border-t py-3">
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !dirty}>
          {saving && <Loader2 className="animate-spin" />}
          {saving ? messages.saving : messages.save}
        </Button>
        {onReset && (
          <Button type="button" variant="outline" disabled={busy || !dirty} onClick={onReset}>
            {messages.reset}
          </Button>
        )}
        <SavedNote savedAt={savedAt} label={messages.saved} />
      </div>
      {canDelete && onDelete && (
        <>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {deleting ? messages.deleting : messages.delete}
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={messages.confirmDeleteTitle}
            body={messages.confirmDeleteBody}
            confirmLabel={messages.confirmDeleteConfirm}
            cancelLabel={messages.confirmDeleteCancel}
            busy={deleting}
            onConfirm={() => {
              setConfirmOpen(false);
              onDelete();
            }}
          />
        </>
      )}
    </div>
  );
}

/** Transient success feedback — no toast library (and no new dependency);
 *  auto-clears so it can't be mistaken for the state of a later edit. */
function SavedNote({ savedAt, label }: { savedAt: number | null; label: string }) {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    // savedAt → null означает «это уже другая запись» (страница обнуляет его при
    // смене name/id, в т.ч. когда onSaved подставляет выданный id в URL): note
    // надо СПРЯТАТЬ, а не оставить висеть, помечая позднюю правку сохранённой.
    if (savedAt == null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);
  return (
    <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
      {visible ? label : ""}
    </span>
  );
}
