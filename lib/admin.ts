// The site owner, who reads feedback (app/admin/feedback). A user id isn't a secret, so the
// browser can know it too and only the owner's browser asks for the inbox; the server
// checks it again on every request.
export const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? "";
export const isAdmin = (uid: string | null | undefined) => Boolean(ADMIN_USER_ID && uid === ADMIN_USER_ID);
