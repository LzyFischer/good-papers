// The signed-in reader behind an API request (Authorization: Bearer <Supabase access token>).
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase";

export async function authedUser(req: Request): Promise<{ db: SupabaseClient; uid: string } | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { db, uid: data.user.id };
}
