import { adminClient } from "@/lib/supabase";
import { rankForYou } from "@/lib/forYou";
(async () => {
  const db = adminClient();
  const { data: rows } = await db.from("reader_prefs").select("user_id").order("updated_at", { ascending: false }).limit(1);
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await rankForYou(db, rows![0].user_id, 24);
    console.log(`${i ? "warm" : "cold"}: ${Date.now() - t0} ms, ${r.papers.length} papers`);
  }
})();
