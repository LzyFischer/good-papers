"use client";
// After sign-up: pick the topics you follow, who you are and the venues you care about.
// Every step can be skipped; "Interests" in the header brings you back here.
import { useEffect, useState } from "react";
import { AREA_GROUPS } from "@/lib/areas";
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
  const toggleArea = (g: string, k: string) => setAreas((a) => {
    const without = a.filter((x) => x !== g);
    return without.includes(k) ? without.filter((x) => x !== k) : [...without, k];
  });
  const picked = (g: string) => areas.includes(g) || Object.keys(AREA_GROUPS[g].areas).some((k) => areas.includes(k));

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
          <p className="welcome-sub">Pick a few areas. Your home page gets a <b>For you</b> shelf with the best new papers in them. Tap an area again to narrow it down.</p>
          <div className="topic-grid">
            {GROUPS.map(([g, grp]) => (
              <div key={g} className={`topic ${picked(g) ? "topic--on" : ""}`}>
                <button className="topic-main" aria-pressed={areas.includes(g)} onClick={() => { toggleGroup(g); setOpen(g); }}>
                  {grp.label}
                </button>
                {open === g && (
                  <div className="topic-fine">
                    {Object.entries(grp.areas).map(([k, label]) => (
                      <button key={k} className="chip-toggle" aria-pressed={areas.includes(k) || areas.includes(g)} onClick={() => toggleArea(g, k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
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

      {error && <p className="signin-error" role="alert">{error}</p>}
      <div className="welcome-actions">
        {step > 0 ? <button className="link-button" onClick={() => setStep(step - 1)}>Back</button> : <span />}
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
