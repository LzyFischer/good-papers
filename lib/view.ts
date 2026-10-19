// All papers layout: big cards ("list") or a grid of small cards ("grid"), kept in a cookie.
// Shared by the server (app/page.tsx) and the toggle (components/ViewToggle.tsx).
export const VIEW_COOKIE = "gp_view";
export type View = "list" | "grid";
