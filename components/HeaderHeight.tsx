"use client";
// The home hero fills the screen below the header (globals.css, .hero). The header's height
// depends on fonts and on wrapping on phones, so it is measured, not guessed.
import { useLayoutEffect } from "react";

export function HeaderHeight() {
  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>("header.top");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${header.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return null;
}
