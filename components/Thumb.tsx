"use client";
// A hotlinked arXiv figure that steps aside when it fails to load (some figure URLs break or
// get rate-limited), showing `fallback` instead of the browser's empty broken-image box.
import { useEffect, useRef, useState } from "react";

export function Thumb({ src, className, fallback = null }: { src: string; className?: string; fallback?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // It may have failed before React attached onError.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (failed) return <>{fallback}</>;
  // Plain img keeps hotlinked figures out of Next's image proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
