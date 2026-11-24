import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">Console</p>
      <h1 className="text-2xl font-black tracking-wide">NOTHING HERE</h1>
      <p className="text-sm text-neutral-400">
        That page does not exist, or your role cannot open it. The navigation on the left has
        everything your account can reach.
      </p>
      <Link
        href="/"
        className="w-fit text-xs uppercase tracking-widest text-neon hover:underline"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
