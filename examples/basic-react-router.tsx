// The minimal editor page: a query client, `useEditorState` from the
// `./react-router` entry to map the route param to the editor's id, and
// `EditorPage`. This is what a consumer writes; the specifiers resolve to the
// live sources under `../src` (see tsconfig.json here).
//
// It assumes a server that speaks the wire protocol from the root README, such
// as editrig-go.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { EditorPage } from "@qrotux/editrig-shadcn-react";
import { useEditorState } from "@qrotux/editrig-shadcn-react/react-router";

// One client for the whole app; mount it above every page, not per page.
const queryClient = new QueryClient();

export function UserEditorPage() {
  // The route is /admin/users/:id, where :id is "new" for the create form.
  const { id: routeId } = useParams();
  const { id } = useEditorState(routeId);
  const navigate = useNavigate();

  return (
    <QueryClientProvider client={queryClient}>
      <EditorPage
        name="users"
        id={id}
        // Save stays on the record; put the server-issued id into the URL so a
        // reload of the create form lands on the saved record.
        onSaved={(savedId) => navigate(`/admin/users/${savedId}`, { replace: true })}
        onDeleted={() => navigate("/admin/users")}
        onCancel={() => navigate("/admin/users")}
      />
    </QueryClientProvider>
  );
}

// A second entity served from a non-default endpoint prefix. `basePath` also
// accepts an absolute URL, e.g. "https://api.example.com/admin/entities".
export function ArticleEditorPage() {
  const { id: routeId } = useParams();
  const { id } = useEditorState(routeId);
  const navigate = useNavigate();

  return (
    <QueryClientProvider client={queryClient}>
      <EditorPage
        name="articles"
        id={id}
        basePath="/api/cms/entities"
        onSaved={(savedId) => navigate(`/cms/articles/${savedId}`, { replace: true })}
        onCancel={() => navigate("/cms/articles")}
      />
    </QueryClientProvider>
  );
}
