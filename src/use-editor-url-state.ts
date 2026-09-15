import * as React from "react";

/** Maps a route parameter to `EditorPage`'s `id`: the literal segment `new`
 *  and a missing parameter both mean the create form. Needs no Router context
 *  of its own; it lives in the `./react-router` entry because that entry is the
 *  one place a future query-param mode may import `react-router-dom`. */
export function useEditorState(routeId: string | undefined): { id: string | null } {
  return React.useMemo(() => ({ id: routeId && routeId !== "new" ? routeId : null }), [routeId]);
}
