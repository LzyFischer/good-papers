// Home-screen icon (iOS "Add to Home Screen"): the brand ring on the site's dark ground.
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const RING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="none" stroke="#2b2f36" stroke-width="6"/><circle cx="24" cy="24" r="17" fill="none" stroke="#d2f54a" stroke-width="6" stroke-linecap="round" stroke-dasharray="91 200" transform="rotate(-90 24 24)"/><path d="M17.3 24.4l4.7 4.7 8.8-9.7" fill="none" stroke="#f6f5f2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111316" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(RING).toString("base64")}`} width={140} height={140} alt="" />
      </div>
    ),
    size,
  );
}
