import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

const UPDATED = "October 10, 2026";

export default function Privacy() {
  return (
    <main className="wrap page prose">
      <h1 className="page-title">Privacy</h1>
      <p>
        Good Papers is a small research side project. This page says what we keep about you and why. Last updated{" "}
        {UPDATED}.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Your account.</b> When you sign in with Google or GitHub we receive your name, email address, profile
          picture and, for GitHub, your username. When you sign in with an email code we receive your email address.
        </li>
        <li>
          <b>What you do here.</b> Your votes, private notes, comments and likes, the topics you follow, and which
          papers you open and how long you read them (to personalize your <b>For you</b> shelf). You can clear your
          reading history on the <i>Your interests</i> page.
        </li>
        <li>
          <b>Basic logs.</b> Our hosting provider keeps standard server logs (IP address, browser, pages requested) for a
          short time to run and protect the site.
        </li>
      </ul>
      <p>We don&apos;t use advertising or third-party tracking, and we don&apos;t sell or rent your data.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To sign you in and show you your votes, notes and replies.</li>
        <li>
          To score papers fairly. We match your name and affiliation against public bibliographic data (OpenAlex and,
          for GitHub accounts, your public GitHub profile) to spot conflicts of interest, such as votes on your own
          papers, and to weight votes by reputation. These inferences are never shown to anyone.
        </li>
        <li>
          To run the discussion. Comments are public and show your name. The AI reviewers read comments in order to reply
          to them, so comment text is sent to the language-model services that write and label those replies.
        </li>
        <li>To send you sign-in codes by email. We don&apos;t send newsletters unless you ask for them.</li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Supabase (database and sign-in), Vercel (hosting), Resend (sign-in emails), Google and GitHub (if you sign in with
        them), and the AI providers that power the AI panel and AI comments. Each processes data only to provide its
        service to us.
      </p>

      <h2>Cookies and storage</h2>
      <p>
        We use your browser&apos;s storage to keep you signed in and to remember small things like which replies you&apos;ve
        seen. No advertising or analytics cookies.
      </p>

      <h2>Your choices</h2>
      <p>
        You can delete your comments and votes at any time. To delete your account and everything tied to it, or to ask
        what we hold about you, email <a href="mailto:vjd5zr@outlook.com">vjd5zr@outlook.com</a> or open an issue on{" "}
        <a href="https://github.com/LzyFischer/good-papers/issues">GitHub</a>, and we&apos;ll handle it within 30 days.
      </p>

      <p>
        <Link href="/">Back to papers</Link>
      </p>
    </main>
  );
}
