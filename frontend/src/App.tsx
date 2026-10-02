import { useEffect, useState } from "react";

type Me = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  employers?: Array<{ id: string; name: string }>;
  modules?: Record<string, boolean>;
};

const roleLabels: Record<string, string> = {
  SUPERADMIN: "Super Admin",
  ADMIN: "Admin",
  EMPLOYER_MANAGER: "Employer Manager",
  PORTFOLIO_MANAGER: "Portfolio Manager",
  VIEWER: "Viewer",
};

async function loadSession(): Promise<Me | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <main className="shell"><section className="panel">Loading your workspace…</section></main>;
  }

  if (!me) {
    return (
      <main className="shell">
        <section className="panel">
          <div className="eyebrow">EFS Optimise</div>
          <h1>React frontend foundation</h1>
          <p>Authentication is still handled by the existing Fastify session layer.</p>
          <a className="button" href="/login">Sign in</a>
        </section>
      </main>
    );
  }

  const role = roleLabels[me.role ?? ""] ?? me.role ?? "User";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">EFS Optimise</div>
          <h1>Workspace</h1>
        </div>
        <div className="identity">
          <strong>{me.name || me.email || "User"}</strong>
          <span>{role}</span>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">React migration</span>
          <h2>Your new application shell is live.</h2>
          <p>
            This is the first React surface. Existing Node, Fastify, Prisma,
            authentication and data services remain unchanged while portal
            sections are migrated one at a time.
          </p>
        </div>
        <div className="status">Backend connected</div>
      </section>

      <section className="grid">
        <article className="card">
          <span>Role</span>
          <strong>{role}</strong>
          <small>Role-aware rendering is ready for the five governed roles.</small>
        </article>
        <article className="card">
          <span>Employer scope</span>
          <strong>{me.employers?.length ?? 0}</strong>
          <small>Employer assignments continue to come from the existing API.</small>
        </article>
        <article className="card">
          <span>Next migration</span>
          <strong>Dashboard</strong>
          <small>The existing dashboard will be ported after the shell passes CI.</small>
        </article>
      </section>
    </main>
  );
}

export default App;
