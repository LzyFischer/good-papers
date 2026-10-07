"use client";
// Reveals gated scores (components/Gate.tsx) on papers you've voted on, on every page
// and after every vote or navigation.
import { useEffect } from "react";
import { useSession } from "./AuthButton";
import { getMyVotes } from "./myVotes";

export function GateRevealer() {
  const { session } = useSession();
  useEffect(() => {
    if (!session) return;
    let frame = 0;
    const apply = async () => {
      const votes = await getMyVotes(session.user.id);
      document.querySelectorAll<HTMLElement>("[data-gate]").forEach((el) => {
        el.classList.toggle("revealed", votes.has(el.dataset.gate ?? ""));
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void apply());
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("gp-voted", schedule); // a vote just landed: reveal without waiting
    return () => {
      observer.disconnect();
      window.removeEventListener("gp-voted", schedule);
      cancelAnimationFrame(frame);
    };
  }, [session]);
  return null;
}
