export function DatabaseSetup({ detail }: { detail?: string }) {
  return (
    <main className="section">
      <div className="panel max-w-3xl p-5">
        <span className="badge bg-jam text-ink">Database setup needed</span>
        <h1 className="mt-4 text-3xl font-black">Connect PostgreSQL to finish local setup</h1>
        <p className="mt-3 text-sm leading-6 text-ink/75">
          The app is running, but Prisma cannot connect to the database configured in `.env`. Update
          `DATABASE_URL`, then run the migration and seed commands below.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-ink p-4 text-xs text-crumb">
{`npx prisma migrate dev
npm run prisma:seed`}
        </pre>
        {detail ? (
          <p className="mt-4 rounded-md bg-crumb p-3 text-xs font-semibold text-jam">
            {detail}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export function databaseErrorMessage(error: unknown) {
  if (error instanceof Error) {
    // Show the full message (first 800 chars) — first line alone is often empty for Prisma errors
    const msg = error.message.trim();
    return msg ? msg.slice(0, 800) : `${error.name}: (empty message)`;
  }
  return "Prisma could not connect to the configured database.";
}
