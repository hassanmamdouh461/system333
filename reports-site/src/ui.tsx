import type { ReactNode } from 'react';

/** Icon set, inline so the portal ships no icon dependency. */
const ICONS: Record<string, ReactNode> = {
  money: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  receivable: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  orders: (
    <>
      <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4z" />
      <path d="M4 6h16M9 10a3 3 0 0 0 6 0" />
    </>
  ),
  menu: (
    <>
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
      <path d="M6 1v3M10 1v3M14 1v3" />
    </>
  ),
  cogs: <path d="M22 17 13.5 8.5 8.5 13.5 2 7M16 17h6v-6" />,
  profit: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18M3 7h18M6 7l-3 6h6zM18 7l-3 6h6z" />
    </>
  ),
  trend: <path d="m22 7-8.5 8.5-5-5L2 17M16 7h6v6" />,
  stock: (
    <>
      <path d="m21 16-9 5-9-5V8l9-5 9 5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    </>
  ),
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.4 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z" />
    </>
  ),
  display: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  refresh: <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />,
  download: <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16" />,
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

export function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] ?? ICONS.money}
    </svg>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  badge?: string;
  unit?: string;
  icon: string;
  tone: 'emerald' | 'amber' | 'sky' | 'violet' | 'rose';
  /** Renders the figure in the loss colour without changing its meaning. */
  negative?: boolean;
}

export function StatCard({ label, value, badge, unit, icon, tone, negative }: StatCardProps) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <header>
        {badge && <span className="stat-badge">{badge}</span>}
        <span className="stat-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
      </header>
      <p className="stat-label">{label}</p>
      <p className={`stat-value${negative ? ' is-negative' : ''}`}>
        {value}
        {unit && <small>{unit}</small>}
      </p>
    </article>
  );
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {hint && <span className="panel-hint">{hint}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
