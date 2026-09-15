import * as React from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/** Destructive-action confirmation, owned by the Editor library so no entity
 *  page has to re-implement it.
 *
 *  Built on the project's existing shadcn Dialog rather than shadcn's
 *  AlertDialog: `@radix-ui/react-alert-dialog` is not installed and adding an
 *  npm dependency is out of scope here. The accessibility gap is closed by
 *  hand — `role="alertdialog"` plus an explicit description association. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription>{body}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small helper so callers get `open` state without a local useState each. */
export function useConfirm(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  return React.useState(false);
}
