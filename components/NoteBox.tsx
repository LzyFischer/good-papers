"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { useSession } from "./AuthButton";

export function NoteBox({ paperId }: { paperId: string }) {
  const { session } = useSession();
  const [voted, setVoted] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    browserClient()
      .from("ratings")
      .select("note")
      .eq("user_id", session.user.id)
      .eq("paper_id", paperId)
      .maybeSingle()
      .then(({ data }) => {
        setVoted(Boolean(data));
        setNote(data?.note ?? "");
      });
  }, [session, paperId]);

  if (!session || voted === null) return null;
  if (!voted) return <p className="hint">Vote fresh or rotten to add a private note to your reading log.</p>;

  async function save() {
    const { error } = await browserClient()
      .from("ratings")
      .update({ note: note.trim() || null })
      .eq("user_id", session!.user.id)
      .eq("paper_id", paperId);
    setStatus(error ? `Your note wasn't saved: ${error.message}` : "Note saved.");
  }

  return (
    <div className="notebox">
      <label>
        Private note, only you can see it
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <button className="button-quiet" onClick={save}>
        Save note
      </button>
      {status && (
        <span className="hint" role="status">
          {" "}
          {status}
        </span>
      )}
    </div>
  );
}
