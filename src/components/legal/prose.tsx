/**
 * Typography for the legal pages. Kept as components rather than a prose stylesheet so
 * the two documents cannot drift apart, and so a reader can scan them by heading.
 */

export function LegalHeading({
  title,
  updated,
  intro,
}: {
  title: string;
  updated: string;
  intro: string;
}) {
  return (
    <header className="border-b border-border pb-7">
      <h1 className="text-[30px] leading-9 font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-3 text-[15px] leading-6 text-muted-foreground">{intro}</p>
      <p className="mt-4 text-[12px] text-muted-foreground">Last updated {updated}</p>
    </header>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5">
      {items.map((item, index) => (
        <li key={index} className="list-disc marker:text-border">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Used for the things a reader should not be able to miss — the Limited Use pledge. */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-4 py-3 text-[14px] leading-6 text-foreground">
      {children}
    </div>
  );
}

export function DefinitionRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] font-medium text-foreground">{term}</dt>
      <dd className="text-[14px] leading-6 text-muted-foreground">{children}</dd>
    </div>
  );
}
