"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Mailbox { username: string; email: string; home: string; created: string }

/** Admin: create and manage @essentialsedm.com mailboxes (webmail + IMAP + inbound mail). */
export default function Mailboxes() {
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Mailbox[]>("/mailboxes").then(setBoxes).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMsg(null);
    try {
      const r = await api.post<Mailbox>("/mailboxes", form);
      setMsg(`Mailbox ${r.email} created — login at /webmail with "${r.username}" and the password you set.`);
      setForm({ username: "", password: "" });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const resetPw = async (username: string) => {
    const password = prompt(`New password for ${username}@essentialsedm.com (min 10 chars):`);
    if (!password) return;
    setError(null);
    try {
      await api.post(`/mailboxes/${username}/password`, { password });
      setMsg(`Password updated for ${username}@essentialsedm.com`);
    } catch (err: any) { setError(err.message); }
  };

  const remove = async (username: string) => {
    if (!confirm(`Delete mailbox ${username}@essentialsedm.com and ALL its mail? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.del(`/mailboxes/${username}`);
      setMsg(`Mailbox ${username}@essentialsedm.com deleted`);
      load();
    } catch (err: any) { setError(err.message); }
  };

  const input = "w-full bg-bg border border-line rounded-lg px-3 py-2";

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">EMAIL MAILBOXES</h1>
        <p className="text-neutral-500 text-sm">
          Real mailboxes @essentialsedm.com — receive mail (SMTP), log in at{" "}
          <a href="/webmail/" target="_blank" className="text-neon underline">/webmail</a>, and work in
          mail clients via IMAP. Admin login links for local mailboxes arrive in webmail.
        </p>
        {msg && <p className="text-neon text-sm">{msg}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <form onSubmit={create} className="grid md:grid-cols-3 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <div>
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Mailbox name</span>
            <div className="flex items-center mt-1">
              <input required className={`${input} rounded-r-none flex-1`} placeholder="info" value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
              <span className="border border-line border-l-0 rounded-r-lg px-3 py-2 text-neutral-500 text-sm">@essentialsedm.com</span>
            </div>
          </div>
          <div>
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Password (min 10)</span>
            <div className="flex mt-1">
              <input required type={showPw ? "text" : "password"} minLength={10} className={`${input} rounded-r-none flex-1`}
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="border border-line border-l-0 rounded-r-lg px-3 text-neutral-400 text-xs">{showPw ? "HIDE" : "SHOW"}</button>
            </div>
          </div>
          <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">CREATE MAILBOX</button>
        </form>

        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Mailbox</th>
                <th className="text-left px-4 py-3">Home</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((m) => (
                <tr key={m.username} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{m.email}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{m.home}</td>
                  <td className="px-4 py-3 space-x-3">
                    <button onClick={() => resetPw(m.username)} className="text-neon underline text-xs">Reset password</button>
                    <a href="/webmail/" target="_blank" className="text-neutral-300 underline text-xs">Webmail</a>
                    <button onClick={() => remove(m.username)} className="text-red-400 underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
              {!boxes.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-neutral-500">No mailboxes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
