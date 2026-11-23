"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface RegisteredUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  verifiedBadge: boolean;
  mfaDisabled: boolean;
  linked: boolean;
  telegram: boolean;
  createdAt: string;
  stageName: string | null;
  venue: { id: string; name: string; capacity: number } | null;
  mailbox: { address: string; status: string } | null;
}

interface Mailbox {
  id: string;
  address: string;
  localpart: string;
  aliases: string[];
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  usedBytes: number | null;
}

interface MailboxState {
  enabled: boolean;
  domain: string;
  mailbox: Mailbox | null;
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
  door: "Door staff",
  promoter: "Promoter",
  guest: "Guest",
  admin: "Admin",
};

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"guest" | "artist" | "promoter" | "venue_manager" | "door" | "admin">("guest");
  const [creating, setCreating] = useState(false);
  const [provisioned, setProvisioned] = useState<{ email: string; password: string } | null>(null);
  const [resetResult, setResetResult] = useState<{
    email: string;
    password: string;
    factorsRemoved: number;
  } | null>(null);
  const [mailboxFor, setMailboxFor] = useState<RegisteredUser | null>(null);
  const [mailboxState, setMailboxState] = useState<MailboxState | null>(null);
  const [mailboxLocalpart, setMailboxLocalpart] = useState("");
  const [mailboxCredentials, setMailboxCredentials] = useState<{
    address: string;
    password: string;
  } | null>(null);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [catchAll, setCatchAll] = useState<string | null>(null);
  const [catchAllDraft, setCatchAllDraft] = useState("");

  const load = useCallback(async (search: string) => {
    setError(null);
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      setUsers(await api.get<RegisteredUser[]>(`/users${query}`));
    } catch (e) {
      setError(errorMessage(e) ?? "Could not load users.");
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
    } catch (e) {
      setError(errorMessage(e) ?? "Could not save.");
    } finally {
      setBusyId(null);
    }
  };

  /** Provision a login with a temporary password; the owner resets it on first sign-in. */
  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    setProvisioned(null);
    try {
      const result = await api.post<{ user: RegisteredUser; temporaryPassword: string }>("/users", {
        email: newEmail.trim(),
        role: newRole,
      });
      setUsers((prev) => [result.user, ...prev]);
      setProvisioned({ email: result.user.email, password: result.temporaryPassword });
      setNewEmail("");
    } catch (err) {
      setError(errorMessage(err) ?? "Could not create the account.");
    } finally {
      setCreating(false);
    }
  };

  /**
   * Unlock someone who lost their authenticator or password: the API removes
   * their second factor, sets a temporary password and signs out every device.
   */
  const resetSignIn = async (user: RegisteredUser) => {
    const confirmed = window.confirm(
      `Reset sign-in for ${user.email}? This removes their authenticator, sets a temporary ` +
        "password and signs out every device.",
    );
    if (!confirmed) return;
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    setResetResult(null);
    try {
      const result = await api.post<{
        user: RegisteredUser;
        temporaryPassword: string;
        factorsRemoved: number;
      }>(`/users/${user.id}/auth-reset`, {});
      replace(result.user);
      setResetResult({
        email: result.user.email,
        password: result.temporaryPassword,
        factorsRemoved: result.factorsRemoved,
      });
    } catch (err) {
      setError(errorMessage(err) ?? "Could not reset sign-in.");
    } finally {
      setBusyId(null);
    }
  };

  /** Exempt an account from mandatory two-step, or put it back under the policy. */
  const toggleMfa = async (user: RegisteredUser) => {
    const disabling = !user.mfaDisabled;
    if (
      disabling &&
      !window.confirm(
        `Turn off two-step verification for ${user.email}? They will sign in with just a password.`,
      )
    ) {
      return;
    }
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    setResetResult(null);
    try {
      const updated = await api.patch<RegisteredUser>(`/users/${user.id}/mfa`, { disabled: disabling });
      replace(updated);
      setNotice(`${updated.email} — two-step verification ${disabling ? "is off" : "is required again"}.`);
    } catch (err) {
      setError(errorMessage(err) ?? "Could not change two-step verification.");
    } finally {
      setBusyId(null);
    }
  };

  /** Mailbox administration for one account, kept in its own small panel. */
  const openMailbox = async (user: RegisteredUser) => {
    setMailboxFor(user);
    setMailboxState(null);
    setMailboxCredentials(null);
    setMailboxError(null);
    setMailboxLocalpart(user.email.split("@")[0]);
    setBusyId(user.id);
    try {
      const [state, catchAllState] = await Promise.all([
        api.get<MailboxState>(`/users/${user.id}/mailbox`),
        api.get<{ address: string | null }>("/mailbox/catch-all"),
      ]);
      setMailboxState(state);
      setAliasDraft(state.mailbox?.aliases.join(", ") ?? "");
      setCatchAll(catchAllState.address);
      setCatchAllDraft(catchAllState.address ?? "");
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not load the mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const closeMailbox = () => {
    setMailboxFor(null);
    setMailboxState(null);
    setMailboxCredentials(null);
    setMailboxError(null);
  };

  const createMailbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mailboxFor) return;
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    setMailboxCredentials(null);
    try {
      const result = await api.post<{ mailbox: Mailbox; password: string }>(
        `/users/${mailboxFor.id}/mailbox`,
        { localpart: mailboxLocalpart.trim() },
      );
      setMailboxState((prev) => ({
        enabled: prev?.enabled ?? true,
        domain: prev?.domain ?? "",
        mailbox: result.mailbox,
      }));
      setMailboxCredentials({ address: result.mailbox.address, password: result.password });
      setAliasDraft("");
      void load(q);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not create the mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const adoptMailbox = async () => {
    if (!mailboxFor) return;
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    setMailboxCredentials(null);
    try {
      const result = await api.post<{ mailbox: Mailbox }>(
        `/users/${mailboxFor.id}/mailbox/adopt`,
        { localpart: mailboxLocalpart.trim() },
      );
      setMailboxState((prev) => ({
        enabled: prev?.enabled ?? true,
        domain: prev?.domain ?? "",
        mailbox: result.mailbox,
      }));
      setAliasDraft(result.mailbox.aliases.join(", "));
      setNotice(
        `${result.mailbox.address} is now managed here; its existing mail and password were left untouched.`,
      );
      void load(q);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not link the existing mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const saveAliases = async () => {
    if (!mailboxFor || !mailboxState?.mailbox) return;
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    try {
      const result = await api.patch<{ mailbox: Mailbox }>(
        `/users/${mailboxFor.id}/mailbox/aliases`,
        {
          aliases: aliasDraft
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean),
        },
      );
      setMailboxState((prev) => (prev ? { ...prev, mailbox: result.mailbox } : prev));
      setAliasDraft(result.mailbox.aliases.join(", "));
      setNotice(`${result.mailbox.address} — aliases updated.`);
      void load(q);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not save the aliases.");
    } finally {
      setBusyId(null);
    }
  };

  const saveCatchAll = async (address: string | null) => {
    setBusyId(mailboxFor?.id ?? "catch-all");
    setMailboxError(null);
    try {
      const result = await api.patch<{ address: string | null }>("/mailbox/catch-all", {
        address,
      });
      setCatchAll(result.address);
      setCatchAllDraft(result.address ?? "");
      setNotice(
        result.address
          ? `Catch-all now delivers unknown mail to ${result.address}.`
          : "Domain catch-all is off.",
      );
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not change the catch-all.");
    } finally {
      setBusyId(null);
    }
  };

  const resetMailboxPassword = async () => {
    if (!mailboxFor || !mailboxState?.mailbox) return;
    if (
      !window.confirm(
        `Reset the mailbox password for ${mailboxState.mailbox.address}? The old password stops working immediately.`,
      )
    ) {
      return;
    }
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    setMailboxCredentials(null);
    try {
      const result = await api.post<{ password: string }>(
        `/users/${mailboxFor.id}/mailbox/password`,
        {},
      );
      setMailboxCredentials({
        address: mailboxState.mailbox.address,
        password: result.password,
      });
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not reset the mailbox password.");
    } finally {
      setBusyId(null);
    }
  };

  const emailMailboxSettings = async () => {
    if (!mailboxFor || !mailboxState?.mailbox) return;
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    try {
      const result = await api.post<{ to: string }>(
        `/users/${mailboxFor.id}/mailbox/settings-email`,
        {},
      );
      setNotice(`Mailbox settings emailed to ${result.to}.`);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not send the settings email.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleMailbox = async () => {
    if (!mailboxFor || !mailboxState?.mailbox) return;
    const disabling = mailboxState.mailbox.status === "active";
    if (
      disabling &&
      !window.confirm(
        `Disable ${mailboxState.mailbox.address}? Mailbox sign-in stops; stored mail is kept.`,
      )
    ) {
      return;
    }
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    try {
      const result = await api.patch<{ mailbox: Mailbox }>(`/users/${mailboxFor.id}/mailbox`, {
        status: disabling ? "disabled" : "active",
      });
      setMailboxState((prev) => (prev ? { ...prev, mailbox: result.mailbox } : prev));
      setNotice(`${result.mailbox.address} — mailbox ${disabling ? "disabled" : "active"}.`);
      void load(q);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not change the mailbox status.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteMailbox = async () => {
    if (!mailboxFor || !mailboxState?.mailbox) return;
    const address = mailboxState.mailbox.address;
    if (!window.confirm(`Delete ${address} and every message stored in it? This cannot be undone.`)) {
      return;
    }
    setBusyId(mailboxFor.id);
    setMailboxError(null);
    try {
      await api.del(`/users/${mailboxFor.id}/mailbox`);
      closeMailbox();
      setNotice(`${address} — mailbox deleted.`);
      void load(q);
    } catch (err) {
      setMailboxError(errorMessage(err) ?? "Could not delete the mailbox.");
    } finally {
      setBusyId(null);
    }
  };

  const choose = (user: RegisteredUser, role: FormKind | "promoter" | "door" | "guest") => {
    setError(null);
    setNotice(null);
    if (role === "guest" || role === "promoter" || role === "door") {
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

        <section className="border border-line rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-neon uppercase tracking-wider">Create an account</h2>
            <p className="text-neutral-500 text-xs mt-1">
              Sets up the login with a temporary password. The person must choose their own before
              the dashboard opens.
            </p>
          </div>
          <form onSubmit={createAccount} className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              required
              className={field}
              placeholder="dj@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <select
              className={field}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as typeof newRole)}
            >
              {(["guest", "promoter", "artist", "venue_manager", "door", "admin"] as const).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            <button
              disabled={creating || !newEmail.includes("@")}
              className="bg-neon text-bg font-black rounded-lg px-3 py-2 text-xs tracking-widest disabled:opacity-50"
            >
              {creating ? "CREATING…" : "CREATE ACCOUNT"}
            </button>
          </form>
          {provisioned && (
            <div className="border border-neon/40 rounded-lg p-3">
              <p className="text-neon text-sm">Account ready for {provisioned.email}.</p>
              <p className="text-neutral-400 text-xs mt-1">
                Temporary password — shown once, passed on by you, changed by them at first sign-in:
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <code className="bg-bg border border-line rounded px-2 py-1 text-sm">{provisioned.password}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(provisioned.password)}
                  className="text-[11px] tracking-widest text-neutral-400 hover:text-neon"
                >
                  COPY
                </button>
              </div>
            </div>
          )}
        </section>

        {mailboxFor && (
          <section className="border border-line rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-neon uppercase tracking-wider">Mailbox</h2>
                <p className="text-neutral-500 text-xs mt-1">
                  {mailboxFor.email} · the mailbox is an address on the mail server, separate from
                  the sign-in email.
                </p>
              </div>
              <button
                type="button"
                onClick={closeMailbox}
                className="text-neutral-500 text-xs tracking-widest hover:text-neutral-300"
              >
                CLOSE
              </button>
            </div>

            {mailboxError && <p className="text-red-400 text-sm">{mailboxError}</p>}
            {!mailboxState && !mailboxError && (
              <p className="text-neutral-500 text-xs">Loading…</p>
            )}

            {mailboxState && !mailboxState.enabled && (
              <p className="text-yellow-300 text-sm">
                Mailbox provisioning is not enabled on this server (MAILBOX_PROVISIONING).
              </p>
            )}

            {mailboxState?.enabled && !mailboxState.mailbox && (
              <form onSubmit={createMailbox} className="flex flex-wrap items-center gap-2">
                <input
                  className={field}
                  placeholder="name"
                  value={mailboxLocalpart}
                  onChange={(e) => setMailboxLocalpart(e.target.value)}
                  required
                />
                <span className="text-neutral-500 text-sm">@{mailboxState.domain}</span>
                <button
                  disabled={busyId === mailboxFor.id || !mailboxLocalpart.trim()}
                  className="bg-neon text-bg font-black rounded-lg px-3 py-2 text-xs tracking-widest disabled:opacity-50"
                >
                  {busyId === mailboxFor.id ? "CREATING…" : "CREATE MAILBOX"}
                </button>
                <button
                  type="button"
                  disabled={busyId === mailboxFor.id || !mailboxLocalpart.trim()}
                  onClick={adoptMailbox}
                  className="rounded-lg px-3 py-2 text-xs font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                >
                  LINK EXISTING
                </button>
              </form>
            )}

            {mailboxState?.mailbox && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="bg-bg border border-line rounded px-2 py-1 text-sm">
                    {mailboxState.mailbox.address}
                  </code>
                  <span
                    className={
                      mailboxState.mailbox.status === "active"
                        ? "text-neon text-xs uppercase tracking-widest"
                        : "text-yellow-400 text-xs uppercase tracking-widest"
                    }
                  >
                    {mailboxState.mailbox.status}
                  </span>
                  <span className="text-neutral-500 text-xs">
                    {formatBytes(mailboxState.mailbox.usedBytes)} stored
                  </span>
                </div>
                <div className="border-t border-line pt-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-widest text-neutral-500">Aliases</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${field} flex-1 min-w-[220px]`}
                      placeholder="bookings, press (comma separated)"
                      value={aliasDraft}
                      onChange={(e) => setAliasDraft(e.target.value)}
                    />
                    <button
                      disabled={busyId === mailboxFor.id}
                      onClick={saveAliases}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                    >
                      SAVE ALIASES
                    </button>
                  </div>
                  <p className="text-neutral-600 text-[11px]">
                    Extra @{mailboxState.domain} addresses that deliver to this mailbox.
                    {" "}
                    A sign-in address on this domain reaches the mailbox automatically.
                  </p>
                </div>

                <div className="border-t border-line pt-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-widest text-neutral-500">
                    Domain catch-all
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${field} flex-1 min-w-[220px]`}
                      placeholder={`crew@${mailboxState.domain}`}
                      value={catchAllDraft}
                      onChange={(e) => setCatchAllDraft(e.target.value)}
                    />
                    <button
                      disabled={busyId === mailboxFor.id || !catchAllDraft.trim()}
                      onClick={() => void saveCatchAll(catchAllDraft.trim())}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                    >
                      SAVE
                    </button>
                    {catchAll && (
                      <button
                        disabled={busyId === mailboxFor.id}
                        onClick={() => void saveCatchAll(null)}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-red-500/60 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      >
                        OFF
                      </button>
                    )}
                  </div>
                  <p className="text-neutral-600 text-[11px]">
                    {catchAll
                      ? `Unknown @${mailboxState.domain} addresses currently go to ${catchAll}.`
                      : "Off — unknown addresses are rejected, as before."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={busyId === mailboxFor.id}
                    onClick={resetMailboxPassword}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-40"
                  >
                    RESET PASSWORD
                  </button>
                  <button
                    disabled={busyId === mailboxFor.id}
                    onClick={emailMailboxSettings}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                  >
                    EMAIL SETTINGS
                  </button>
                  <button
                    disabled={busyId === mailboxFor.id}
                    onClick={toggleMailbox}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-line text-neutral-300 hover:border-neon hover:text-neon disabled:opacity-40"
                  >
                    {mailboxState.mailbox.status === "active" ? "DISABLE" : "ENABLE"}
                  </button>
                  <button
                    disabled={busyId === mailboxFor.id}
                    onClick={deleteMailbox}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest border border-red-500/60 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    DELETE
                  </button>
                </div>
              </>
            )}

            {mailboxCredentials && (
              <div className="border border-neon/40 rounded-lg p-3">
                <p className="text-neon text-sm">
                  Mailbox ready for {mailboxCredentials.address}.
                </p>
                <p className="text-neutral-400 text-xs mt-1">
                  Password — shown once, stored nowhere. Pass it on out of band; reset it here if
                  it is lost.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <code className="bg-bg border border-line rounded px-2 py-1 text-sm">
                    {mailboxCredentials.password}
                  </code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(mailboxCredentials.password)}
                    className="text-[11px] tracking-widest text-neutral-400 hover:text-neon"
                  >
                    COPY
                  </button>
                </div>
                <p className="text-neutral-500 text-xs mt-2">
                  Mail client: IMAP mail.essentialsedm.com, port 993, SSL.
                </p>
              </div>
            )}
          </section>
        )}

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {resetResult && (
          <div className="border border-yellow-500/40 rounded-xl p-4">
            <p className="text-yellow-300 text-sm">Sign-in reset for {resetResult.email}.</p>
            <p className="text-neutral-400 text-xs mt-1">
              {resetResult.factorsRemoved} authenticator
              {resetResult.factorsRemoved === 1 ? "" : "s"} removed and every device signed out.
              Temporary password — shown once, changed by them at first sign-in:
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <code className="bg-bg border border-line rounded px-2 py-1 text-sm">
                {resetResult.password}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(resetResult.password)}
                className="text-[11px] tracking-widest text-neutral-400 hover:text-neon"
              >
                COPY
              </button>
            </div>
            <p className="text-neutral-500 text-xs mt-2">
              They sign in with this password, choose a new one, then set up a new authenticator.
            </p>
          </div>
        )}

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
                      {u.mailbox && (
                        <p className="text-neutral-500 text-[11px] mt-0.5">
                          mailbox {u.mailbox.address}
                          {u.mailbox.status === "disabled" && (
                            <span className="text-yellow-400"> · disabled</span>
                          )}
                        </p>
                      )}
                      <p className="text-neutral-600 text-[11px] mt-0.5">
                        {u.linked ? "signed in" : "not signed in yet"} · joined{" "}
                        {new Date(u.createdAt).toLocaleDateString()} ·{" "}
                        <span className={u.telegram ? "text-neon/80" : "text-neutral-600"}>
                          {u.telegram ? "telegram linked" : "no telegram"}
                        </span>
                        {u.mfaDisabled && <span className="text-yellow-400"> · 2FA off</span>}
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
                        {(["artist", "venue_manager", "door", "promoter", "guest"] as const).map((option) => (
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
                        <button
                          disabled={busyId === u.id || u.role === "admin"}
                          onClick={() => toggleMfa(u)}
                          title={
                            u.role === "admin"
                              ? "Admin accounts must keep two-step verification"
                              : u.mfaDisabled
                              ? "Require two-step verification again at next sign-in"
                              : "Sign in with a password only; removes any authenticator"
                          }
                          className={
                            u.mfaDisabled
                              ? "rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest border border-neon/60 text-neon hover:bg-neon/10 disabled:opacity-40"
                              : "rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
                          }
                        >
                          {u.mfaDisabled ? "TURN ON 2FA" : "TURN OFF 2FA"}
                        </button>
                        <button
                          disabled={busyId === u.id || !u.linked}
                          title={
                            u.linked
                              ? "Remove their authenticator and issue a temporary password"
                              : "They have not signed in yet, so there is nothing to reset"
                          }
                          onClick={() => resetSignIn(u)}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-40"
                        >
                          RESET SIGN-IN
                        </button>
                        <button
                          disabled={busyId === u.id}
                          onClick={() => void openMailbox(u)}
                          title="Provision or manage this person's mail server mailbox"
                          className="rounded-lg px-2.5 py-1 text-[11px] font-bold tracking-widest border border-line text-neutral-400 hover:border-neon hover:text-neon disabled:opacity-40"
                        >
                          {u.mailbox ? "MAILBOX" : "ADD MAILBOX"}
                        </button>
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
