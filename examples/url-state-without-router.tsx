// Driving EditorPage without react-router. `id` is a plain prop: any router,
// or none, can supply it. `useEditorState` from the `./react-router` entry only
// wraps the "new" -> null convention; a project on another router does that
// mapping itself, as below, and never imports react-router-dom.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorPage } from "@qrotux/editrig-shadcn-react";

const queryClient = new QueryClient();

// The "new" -> null convention, without any router dependency.
function toEditorId(segment: string | undefined): string | null {
  return segment && segment !== "new" ? segment : null;
}

// Deriving id from the History API (path /admin/users/:id).
export function HistoryDrivenEditor() {
  const segment = window.location.pathname.split("/").pop();
  const id = toEditorId(segment);

  return (
    <QueryClientProvider client={queryClient}>
      <EditorPage
        name="users"
        id={id}
        onSaved={(savedId) => window.history.replaceState(null, "", `/admin/users/${savedId}`)}
        onDeleted={() => window.history.pushState(null, "", "/admin/users")}
      />
    </QueryClientProvider>
  );
}

// Or hold the id in component state — a master/detail pane, say, where clicking
// a row selects the record and "New" opens the create form.
export function InMemoryEditor() {
  const [id, setId] = useState<string | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => setId(null)}>
        New user
      </button>
      <EditorPage
        name="users"
        id={id}
        // The new record's id becomes the selection, so the form leaves create
        // mode and shows Delete.
        onSaved={(savedId) => setId(savedId)}
        onDeleted={() => setId(null)}
      />
    </QueryClientProvider>
  );
}
