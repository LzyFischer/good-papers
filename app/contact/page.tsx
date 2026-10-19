import type { Metadata } from "next";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = { title: "Contact", description: "Report a bug, question a score or suggest an idea." };

export default function ContactPage() {
  return (
    <main className="how">
      <section className="how-hero">
        <div className="wrap">
          <span className="how-kicker">Contact</span>
          <h1>Tell us what you think</h1>
          <p>A bug, a score that looks wrong, an idea for the site: every message is read by the person who builds Good Papers.</p>
        </div>
      </section>
      <div className="wrap how-layout">
        <div className="how-body">
          <section className="how-sec">
            <ContactForm />
          </section>
          <section className="how-sec how-foot">
            <p>
              Prefer GitHub? <a href="https://github.com/LzyFischer/good-papers/issues/new">Open an issue</a>. Issues there are public.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
