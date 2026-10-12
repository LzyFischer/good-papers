"use client";
// Papers a visitor who isn't signed in has opened, and for how long, kept only in this
// browser. It drives their For you shelf (/api/for-you/guest) and moves into their
// account's reading history when they sign in (components/ForYou.tsx).
export type Opened = { id: string; s: number; t: number }; // paper, seconds read, last opened

const KEY = "gp_history";
const MAX = 60;

export function readHistory(): Opened[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? (list as Opened[]).filter((h) => typeof h?.id === "string") : [];
  } catch {
    return [];
  }
}

export function addToHistory(id: string, seconds: number) {
  try {
    const list = readHistory();
    const old = list.find((h) => h.id === id);
    const entry = { id, s: Math.min(7200, (old?.s ?? 0) + seconds), t: Date.now() };
    const next = [entry, ...list.filter((h) => h.id !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
