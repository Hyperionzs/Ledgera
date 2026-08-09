import { QueryProvider } from '@/providers/query-provider';
import { APP } from '@ledgera/shared';

export function App() {
  return (
    <QueryProvider>
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
        <div className="mx-auto max-w-2xl px-6 text-center">
          {/* Logo / Brand */}
          <div className="mb-8 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
              >
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <line x1="2" x2="22" y1="10" y2="10" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-4 text-4xl font-bold tracking-tight">{APP.NAME}</h1>

          {/* Description */}
          <p className="mb-8 text-lg text-muted-foreground">{APP.DESCRIPTION}</p>

          {/* Status Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Foundation Ready — v{APP.VERSION}
          </div>

          {/* Info Cards */}
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <InfoCard title="Frontend" description="React 19 + Vite + Tailwind v4" />
            <InfoCard title="Backend" description="NestJS + Prisma + PostgreSQL" />
            <InfoCard title="Tooling" description="Docker + CI/CD + ESLint" />
          </div>

          <p className="mt-12 text-sm text-muted-foreground">
            Awaiting first feature sprint. Run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">pnpm dev</code> to
            start developing.
          </p>
        </div>
      </div>
    </QueryProvider>
  );
}

function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md">
      <h3 className="mb-1 text-sm font-semibold text-card-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
