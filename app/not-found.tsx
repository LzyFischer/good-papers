import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap page">
      <h1 className="page-title">That paper isn&apos;t here</h1>
      <p className="empty">
        The link may be mistyped, or the paper isn&apos;t in OpenAlex yet. <Link href="/">Search for it instead</Link>.
      </p>
    </main>
  );
}
