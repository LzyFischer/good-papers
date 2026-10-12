"use client";
// After sign-up: pick the topics you follow, who you are and the venues you care about.
// Every step can be skipped; "Interests" in the header brings you back here.
import { useEffect, useState } from "react";
import { AREA_GROUPS } from "@/lib/areas";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { VENUES, getPrefs, savePrefs } from "./prefs";

const GROUPS = Object.entries(AREA_GROUPS).filter(([k]) => k !== "other");

export function Welcome({ next, edit }: { next: string; edit: boolean }) {
  const { session, ready } = useSession();
  const [step, setStep] = useState(0);
  const [areas, setAreas] = useState<string[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const meta = session.user.user_metadata ?? {};
    getPrefs(session.user.id).then((p) => {
      setAreas(p?.areas ?? []);
      setVenues(p?.venues ?? []);
      setName(p?.name ?? meta.full_name ?? meta.name ?? "");
      setInstitution(p?.institution ?? "");
    });
  }, [session]);

  if (!ready) return null;
  if (!session) {
    return (
      <div className="welcome">
        <h1>Pick your topics</h1>
        <p className="welcome-sub">Sign in first, then choose what you want to see.</p>
        <button className="signin-primary" onClick={() => signIn()}>Sign in</button>
      </div>
    );
  }

  const toggle = (list: string[], set: (l: string[]) => void, k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  // Following a whole group replaces its single areas, and the other way round.
  const toggleGroup = (g: string) => {
    const fine = Object.keys(AREA_GROUPS[g].areas);
    setAreas((a) => (a.includes(g) ? a.filter((x) => x !== g) : [...a.filter((x) => !fine.includes(x)), g]));
  };
  // Unticking one topic of a fully followed group keeps the rest of it.
  const toggleArea = (g: string, k: string) => setAreas((a) => {
    if (a.includes(g)) return [...a.filter((x) => x !== g), ...Object.keys(AREA_GROUPS[g].areas).filter((x) => x !== k)];
    return a.includes(k) ? a.filter((x) => x !== k) : [...a, k];
  });
  // Topics picked, counting a whole group as all of its topics.
  const selectedCount = GROUPS.reduce(
    (sum, [g, grp]) => sum + (areas.includes(g) ? Object.keys(grp.areas).length : Object.keys(grp.areas).filter((k) => areas.includes(k)).length),
    0,
  );
  // The group's name only opens and closes its list; picking happens on the chips.
  const tapGroup = (g: string) => setOpen(open === g ? null : g);

  async function finish() {
    setBusy(true);
    const err = await savePrefs(session!.user.id, {
      areas,
      venues,
      name: name.trim() || null,
      institution: institution.trim() || null,
    });
    setBusy(false);
    if (err) return setError(`Couldn't save: ${err}`);
    window.location.href = next;
  }

  const steps = ["Topics", "About you", "Venues"];
  return (
    <div className="welcome">
      <p className="welcome-steps">
        {steps.map((s, i) => (
          <span key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i + 1}. {s}</span>
        ))}
      </p>

      {step === 0 && (
        <>
          <h1>{edit ? "Your topics" : "Welcome! What do you read?"}</h1>
          <p className="welcome-sub">Pick a few areas. Your home page gets a <b>For you</b> shelf with the best new papers in them. Open an area, then pick all of it or just the topics you want.</p>
          <input
            className="topic-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics: quantization, RAG, diffusion…"
            aria-label="Search topics"
          />
          <div className="topic-grid">
            {GROUPS.map(([g, grp]) => {
              const q = query.trim().toLowerCase();
              const groupHit = !q || grp.label.toLowerCase().includes(q);
              const fine = Object.entries(grp.areas).filter(([, label]) => groupHit || label.toLowerCase().includes(q));
              if (!fine.length) return null;
              const total = Object.keys(grp.areas).length;
              const n = areas.includes(g) ? total : Object.keys(grp.areas).filter((k) => areas.includes(k)).length;
              const shown = open === g || (!!q && !groupHit);
              return (
                <div key={g} className={`topic${n ? " topic--on" : ""}${shown ? " topic--open" : ""}`}>
                  <button className="topic-main" aria-expanded={shown} onClick={() => tapGroup(g)}>
                    <span>{grp.label}</span>
                    <span className="topic-count">{n ? `${n} of ${total}` : total}</span>
                  </button>
                  {shown && (
                    <div className="topic-fine">
                      {!q && (
                        <button className="chip-toggle chip-all" aria-pressed={areas.includes(g)} onClick={() => toggleGroup(g)}>
                          All of it
                        </button>
                      )}
                      {fine.map(([k, label]) => (
                        <button key={k} className="chip-toggle" aria-pressed={areas.includes(k) || areas.includes(g)} onClick={() => toggleArea(g, k)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1>About you</h1>
          <p className="welcome-sub">Optional. It lets us recognize your own papers: you can still vote on them, at lower weight. Never shown to anyone.</p>
          <label className="welcome-field">Name as it appears on your papers<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" /></label>
          <label className="welcome-field">Institution or company<input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="University of Virginia" /></label>
        </>
      )}

      {step === 2 && (
        <>
          <h1>Venues you follow</h1>
          <p className="welcome-sub">Optional. Papers from these venues get a boost in your <b>For you</b> shelf.</p>
          <div className="venue-chips">
            {VENUES.map((v) => (
              <button key={v} className="chip-toggle" aria-pressed={venues.includes(v)} onClick={() => toggle(venues, setVenues, v)}>{v}</button>
            ))}
          </div>
        </>
      )}

      {step === 0 && edit && <ClearHistory uid={session.user.id} />}
      {error && <p className="signin-error" role="alert">{error}</p>}
      <div className="welcome-actions">
        {step > 0 ? (
          <button className="link-button" onClick={() => setStep(step - 1)}>Back</button>
        ) : (
          <span className="welcome-picked">
            {selectedCount === 0 ? "No topics yet" : `${selectedCount} topic${selectedCount === 1 ? "" : "s"} selected`}
          </span>
        )}
        <span className="welcome-right">
          {step < 2 && <button className="link-button" onClick={() => setStep(step + 1)}>Skip</button>}
          <button className="signin-primary" disabled={busy} onClick={() => (step < 2 ? setStep(step + 1) : finish())}>
            {step < 2 ? "Next" : busy ? "Saving…" : "Done"}
          </button>
        </span>
      </div>
    </div>
  );
}

// For you also learns from what you read; this forgets the reading history (votes stay).
function ClearHistory({ uid }: { uid: string }) {
  const [done, setDone] = useState(false);
  return (
    <p className="welcome-history">
      <b>For you</b> also learns from the papers you vote on and read.{" "}
      {done ? (
        "Reading history cleared."
      ) : (
        <button
          className="link-button"
          onClick={async () => {
            await browserClient().from("reader_views").delete().eq("user_id", uid);
            setDone(true);
          }}
        >
          Clear my reading history
        </button>
      )}
    </p>
  );
}
