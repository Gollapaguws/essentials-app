"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";

interface RegisteredUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  verifiedBadge: boolean;
  linked: boolean;
  createdAt: string;
  stageName: string | null;
  venue: { id: string; name: string; capacity: number } | null;
}

type FormKind = "artist" | "venue_manager";
type FormMode = "assign" | "edit";

interface RoleForm {
  userId: string;
  kind: FormKind;
  mode: FormMode;
  stageName: string;
  venueName: string;
  venueCapacity: string;
  venueAddress: string;
}

const ROLE_LABEL: Record<string, string> = {
  artist: "DJ",
  venue_manager: "Venue",
  promoter: "Promoter",
  guest: "Guest",
  admin: "Admin",
};

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/** Admin: every registered account, its role, and the DJ/venue profile behind it. */
export default function Users() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";

  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setError(null);
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      setUsers(await api.get<RegisteredUser[]>(`/users${query}`));
    } catch (e: any) {
      setError(e?.message ?? "Could not load users.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load("");
  }, [isAdmin, load]);

  const replace = (updated: RegisteredUser) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));

  const describe = (u: RegisteredUser) =>
    u.stageName
      ? `DJ · ${u.stageName}`
      : u.venue
        ? `${u.venue.name} · ${u.venue.capacity} cap`
        : ROLE_LABEL[u.role] ?? u.role;

  const request = async (user: RegisteredUser, path: string, body: unknown, message: string) => {
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.patch<RegisteredUser>(path, body);
      replace(updated);
      setForm(null);
      setNotice(`${updated.email} — ${message} (${describe(updated)}).`);
    } catch (e: any) {
      setError(e?.message ?? "Could not save.");
    } finally {
      setBusyId(null);
    }
  };

  const choose = (user: RegisteredUser, role: FormKind | "promoter" | "guest") => {
    setError(null);
    setNotice(null);
    if (role === "guest" || role === "promoter") {
      void request(user, `/users/${user.id}/role`, { role }, "role updated");
      return;
    }
    // Always open the form so an existing stage name / venue can be corrected.
    setForm({
      userId: user.id,
      kind: role,
      mode: user.role === role ? "edit" : "assign",
      stageName: user.stageName ?? "",
      venueName: user.venue?.name ?? "",
      venueCapacity: user.venue ? String(user.venue.capacity) : "",
      venueAddress: "",
    });
  };

  const submitForm = (user: RegisteredUser) => {
    if (!form) return;
    if (form.kind === "artist") {
      const stageName = form.stageName.trim();
      if (!stageName) {
        setError("A stage name is required for a DJ.");
        return;
      }
      if (form.mode === "edit") {
        void request(user, `/users/${user.id}/profile`, { stageName }, "stage name updated");
      } else {
        void request(user, `/users/${user.id}/role`, { role: "artist", stageName }, "is now a DJ");
      }
      return;
    }

    const venueName = form.venueName.trim();
    const capacity = Number(form.venueCapacity);
    if (!venueName) {
      setError("A venue name is required.");
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 1) {
      setError("Venue capacity must be a whole number of at least 1.");
      return;
    }
    const body: Record<string, unknown> = {
      venueName,
      venueCapacity: Math.round(capacity),
      ...(form.venueAddress.trim() ? { venueAddress: form.venueAddress.trim() } : {}),
    };
    if (form.mode === "edit") {
      void request(user, `/users/${user.id}/profile`, body, "venue updated");
    } else {
      void request(user, `/users/${user.id}/role`, { role: "venue_manager", ...body }, "is now a venue");
    }
  };

  if (me && !isAdmin) {
    return (
      <>
        <TopNav />
        <main className="max-w-4xl mx-auto px-6 py-10">
          <p className="text-neutral-400 text-sm">Only admins can manage accounts.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-wide">REGISTERED USERS</h1>
            <p className="text-neutral-500 text-xs mt-1">
              {users.length} account{users.length === 1 ? "" : "s"} · make someone a DJ, venue or
              promoter
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void load(q);
            }}
          >
            <input
              className={field}
              placeholder="Search email or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="border border-line rounded-lg px-3 py-2 text-xs font-bold tracking-widest text-neutral-300 hover:text-neon">
              SEARCH
            </button>
          </form>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-neutral-500 border-b border-line">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Make them</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editing = form?.userId === u.id;
                const hasProfile = Boolean(u.stageName || u.venue);
                return (
                  <tr key={u.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{u.name ?? u.email.split("@")[0]}</p>
                      <p className="text-neutral-500 text-xs">{u.email}</p>
                      <p className="text-neutral-600 text-[11px] mt-0.5">
                        {u.linked ? "signed in" : "not signed in yet"} · joined{" "}
                        {new Date(u.createdAt).toLocaleDateString()}
                      </p>
                      {u.stageName && <p className="text-neon/80 text-[11px] mt-1">DJ · {u.stageName}</p>}
                      {u.venue && (
                        <p className="text-neon/80 text-[11px] mt-1">
                          Venue · {u.venue.name} ({u.venue.capacity})
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          u.role === "admin"
                            ? "text-red-300"
                            : u.role === "guest"
                              ? "text-neutral-400"
                              : "text-neon"
                        }
                      >
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(["artist", "venue_manager", "promoter", "guest"] as const).map((option) => (
                          <button
                            key={option}
                            disabled={busyId === u.id}
                            onClick={() => choose(u, option)}
                            className={
                              u.role === option
                                ? "rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest bg-neon text-bg"
                                : "rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                            }
                          >
                            {ROLE_LABEL[option].toUpperCase()}
                          </button>
                        ))}
                        {hasProfile && (
                          <button
                            disabled={busyId === u.id}
                            onClick={() =>
                              setForm({
                                userId: u.id,
                                kind: u.stageName ? "artist" : "venue_manager",
                                mode: "edit",
                                stageName: u.stageName ?? "",
                                venueName: u.venue?.name ?? "",
                                venueCapacity: u.venue ? String(u.venue.capacity) : "",
                                venueAddress: "",
                              })
                            }
                            className="rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest text-neutral-500 hover:text-neutral-200"
                          >
                            EDIT
                          </button>
                        )}
                      </div>

                      {editing && form && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border border-line rounded-lg p-3 bg-surface/60">
                          {form.kind === "artist" ? (
                            <input
                              autoFocus
                              className={field}
                              placeholder="Stage name"
                              value={form.stageName}
                              onChange={(e) => setForm({ ...form, stageName: e.target.value })}
                            />
                          ) : (
                            <>
                              <input
                                autoFocus
                                className={field}
                                placeholder="Venue name"
                                value={form.venueName}
                                onChange={(e) => setForm({ ...form, venueName: e.target.value })}
                              />
                              <input
                                className={`${field} w-28`}
                                type="number"
                                min={1}
                                placeholder="Capacity"
                                value={form.venueCapacity}
                                onChange={(e) => setForm({ ...form, venueCapacity: e.target.value })}
                              />
                              <input
                                className={field}
                                placeholder="Address (optional)"
                                value={form.venueAddress}
                                onChange={(e) => setForm({ ...form, venueAddress: e.target.value })}
                              />
                            </>
                          )}
                          <button
                            disabled={busyId === u.id}
                            onClick={() => submitForm(u)}
                            className="bg-neon text-bg font-black rounded-lg px-3 py-1.5 text-xs tracking-widest disabled:opacity-50"
                          >
                            SAVE
                          </button>
                          {form.kind === "artist" && u.stageName && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() =>
                                request(u, `/users/${u.id}/profile`, { clearStageName: true }, "stage name cleared")
                              }
                              className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-red-500/60 text-red-400 hover:bg-red-500/10"
                            >
                              CLEAR STAGE NAME
                            </button>
                          )}
                          {form.kind === "venue_manager" && u.venue && (
                            <button
                              disabled={busyId === u.id}
                              onClick={() =>
                                request(u, `/users/${u.id}/profile`, { clearVenue: true }, "venue unassigned")
                              }
                              className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-red-500/60 text-red-400 hover:bg-red-500/10"
                            >
                              UNASSIGN VENUE
                            </button>
                          )}
                          <button
                            onClick={() => setForm(null)}
                            className="text-neutral-500 text-xs tracking-widest hover:text-neutral-300"
                          >
                            CANCEL
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!users.length && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-neutral-500">
                    No accounts yet. Anyone who signs in gets listed here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
