// A reader just voted: let the cached home shelves pick it up on the next view.
// At most once every 20 seconds per server instance, so it can't be used to defeat the cache.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

let last = 0;

export async function POST() {
  if (Date.now() - last > 20_000) {
    last = Date.now();
    revalidateTag("home");
  }
  return NextResponse.json({ ok: true });
}
