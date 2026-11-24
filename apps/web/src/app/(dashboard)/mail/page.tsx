"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { downloadFromApi } from "@/lib/download";
import { useResource } from "@/hooks/useResource";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";
import { Badge } from "@/components/console/Badge";

interface Folder {
  name: string;
  messages: number;
  unseen: number;
}

interface Summary {
  enabled: boolean;
  address: string | null;
  domain: string | null;
  folders: Folder[];
  signature: string;
}

interface Row {
  uid: number;
  subject: string;
  from: { name: string; address: string };
  date: string | null;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

interface ListPage {
  folder: string;
  total: number;
  offset: number;
  limit: number;
  messages: Row[];
}

interface Attachment {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

interface Message extends Row {
  to: string[];
  cc: string[];
  text: string;
  html: string | null;
  messageId: string | null;
  references: string | null;
  attachments: Attachment[];
  folder: string;
}

interface Draft {
  mode: "new" | "reply" | "forward";
  to: string;
  cc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  files: File[];
}

/** A draft as the server keeps it in the mailbox's Drafts folder. */
interface ServerDraft extends Omit<Draft, "files"> {
  uid: number;
  updatedAt: string | null;
}

const AUTOSAVE_MS = 1500;

const PAGE_SIZE = 25;

const field =
  "w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";
const button =
  "px-3 py-2 rounded-lg border border-line text-xs tracking-wide hover:border-neon hover:text-neon transition disabled:opacity-40 disabled:hover:border-line disabled:hover:text-inherit";
const quiet =
  "text-xs text-neutral-500 hover:text-neon transition disabled:opacity-40 disabled:hover:text-neutral-500";

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fullWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Mail bodies are written by strangers, so the HTML is only ever rendered inside
 * a sandboxed frame: scripts, forms and same-page navigation stay blocked, while
 * links open in a new tab. The API sends attachments as downloads, never inline.
 */
function wrapped(html: string): string {
  const style =
    "<style>html,body{margin:0;padding:16px;background:#fff;color:#111;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0;padding-left:12px;border-left:2px solid #ddd;color:#555}</style>";
  const base = `<base target="_blank">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${base}${style}`);
  }
  return `<!doctype html><html><head>${base}${style}</head><body>${html}</body></html>`;
}

function quote(message: Message): string {
  const lines = (message.text || "").split("\n").map((line) => `> ${line}`);
  return `\n\nOn ${fullWhen(message.date)}, ${message.from.name} <${message.from.address}> wrote:\n${lines.join("\n")}`;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function Mail() {
  const [folder, setFolder] = useState("INBOX");
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Which mailbox's saved draft has already been offered, so a dismissal sticks.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState("");
  // The Drafts-folder uid behind the open composer, and whether a save is running.
  const draftUid = useRef<number | null>(null);
  const saveInFlight = useRef<Promise<unknown> | null>(null);
  const closing = useRef(false);
  const draftOpen = useRef(false);

  const summarySource = useResource<Summary>("/mail");
  const summary = summarySource.data;
  const address = summary?.address ?? null;
  const signature = summary?.signature ?? "";
  /** Signature text placed above whatever the composer already holds. */
  const signatureBlock = signature.trim() ? `\n\n${signature.trim()}\n` : "";

  const listPath = address
    ? `/mail/messages?folder=${encodeURIComponent(folder)}&offset=${offset}&limit=${PAGE_SIZE}${
        query ? `&q=${encodeURIComponent(query)}` : ""
      }`
    : null;
  const listSource = useResource<ListPage>(listPath);
  const list = listSource.data;

  const messagePath =
    address && selected !== null
      ? `/mail/messages/${selected}?folder=${encodeURIComponent(folder)}`
      : null;
  const messageSource = useResource<Message>(messagePath);
  const message = messageSource.data;

  const total = list?.total ?? 0;
  const folders = summary?.folders ?? [];
  const loadError = summarySource.error ?? listSource.error;

  // Opening a message marks it read on the server; the row should say so at once.
  useEffect(() => {
    if (!message || !listSource.data) return;
    if (listSource.data.messages.some((row) => row.uid === message.uid && !row.seen)) {
      listSource.setData((prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((row) => (row.uid === message.uid ? { ...row, seen: true } : row)) }
          : prev,
      );
    }
    // Deliberately keyed on the message only: rewriting the list must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.uid, message?.seen]);

  const refreshFolders = () => summarySource.reload();

  useEffect(() => {
    draftOpen.current = draft !== null;
  }, [draft]);

  // Reopen whatever was last being written — from Drafts, so it follows the
  // account onto any device rather than living in one browser.
  useEffect(() => {
    if (!address || restoredFor === address) return;
    setRestoredFor(address);
    void (async () => {
      const result = await api
        .get<{ draft: ServerDraft | null }>("/mail/drafts", { cache: "no-store" })
        .catch(() => null);
      const saved = result?.draft;
      // A Reply or Write clicked while this was in flight wins.
      if (!saved || draftOpen.current) return;
      closing.current = false;
      draftUid.current = saved.uid;
      setDraft({
        mode: saved.mode,
        to: saved.to,
        cc: saved.cc,
        subject: saved.subject,
        body: saved.body,
        inReplyTo: saved.inReplyTo,
        references: saved.references,
        files: [],
      });
      setNotice("Draft restored from Drafts. Attachments are not kept in a draft, so add them again before sending.");
    })();
  }, [address, restoredFor]);

  // Autosave into the Drafts folder, replacing the previous copy of this draft.
  useEffect(() => {
    if (!address || !draft || closing.current) return;
    const blank = !draft.to.trim() && !draft.cc.trim() && !draft.subject.trim() && !draft.body.trim();
    if (blank) return;
    const timer = window.setTimeout(() => {
      saveInFlight.current = api
        .post<{ uid: number }>("/mail/drafts", {
          mode: draft.mode,
          to: draft.to,
          cc: draft.cc,
          subject: draft.subject,
          body: draft.body,
          inReplyTo: draft.inReplyTo || undefined,
          references: draft.references || undefined,
          uid: draftUid.current,
        })
        .then((saved) => {
          if (closing.current) return;
          const first = draftUid.current === null;
          draftUid.current = saved.uid;
          // The folder rail only learns about Drafts once it exists.
          if (first) summarySource.reload();
        })
        .catch(() => null);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // The save reads the draft, so it must follow every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, draft]);

  const dropSavedDraft = async () => {
    const uid = draftUid.current;
    draftUid.current = null;
    if (uid) await api.del(`/mail/drafts/${uid}`).catch(() => null);
  };

  /** Settle any running save, then remove the server copy before closing. */
  const closeComposer = async () => {
    closing.current = true;
    await saveInFlight.current?.catch(() => null);
    await dropSavedDraft();
    closing.current = false;
    setDraft(null);
  };

  const openFolder = (name: string) => {
    setFolder(name);
    setOffset(0);
    setSelected(null);
    // A saved draft survives folder changes; only Send or Discard clears it.
    setNotice(null);
    setFailure(null);
  };

  const patchRow = (uid: number, patch: Partial<Row>) => {
    listSource.setData((prev) =>
      prev ? { ...prev, messages: prev.messages.map((row) => (row.uid === uid ? { ...row, ...patch } : row)) } : prev,
    );
  };

  const run = async (action: () => Promise<unknown>, failureText: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (err) {
      setFailure(errorMessage(err) ?? failureText);
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = (row: Row) =>
    run(async () => {
      await api.post(`/mail/messages/${row.uid}/flags`, { folder, flagged: !row.flagged });
      patchRow(row.uid, { flagged: !row.flagged });
      if (message?.uid === row.uid) messageSource.reload();
    }, "Could not change the star.");

  const markUnread = async (row: Row) => {
    await run(async () => {
      await api.post(`/mail/messages/${row.uid}/flags`, { folder, seen: false });
      patchRow(row.uid, { seen: false });
      refreshFolders();
      setSelected(null);
    }, "Could not mark the message unread.");
  };

  const moveTo = (row: Row, to: string) =>
    run(async () => {
      await api.post(`/mail/messages/${row.uid}/move`, { folder, to });
      setNotice(`Moved to ${to}.`);
      if (selected === row.uid) setSelected(null);
      listSource.reload();
      refreshFolders();
    }, `Could not move the message to ${to}.`);

  const remove = async (row: Row) => {
    const permanent = folder === "Trash";
    if (permanent && !window.confirm("Delete this message for good? This cannot be undone.")) return;
    await run(async () => {
      await api.del(`/mail/messages/${row.uid}?folder=${encodeURIComponent(folder)}`);
      setNotice(permanent ? "Message deleted." : "Moved to Trash.");
      if (selected === row.uid) setSelected(null);
      listSource.reload();
      refreshFolders();
    }, "Could not delete the message.");
  };

  const download = (file: Attachment) =>
    run(
      () =>
        downloadFromApi(
          `/mail/messages/${message?.uid}/attachments/${file.index}?folder=${encodeURIComponent(folder)}`,
          file.filename,
        ),
      "Could not download that attachment.",
    );

  const saveSignature = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.patch<{ signature: string }>("/mail/signature", {
        signature: signatureDraft,
      });
      summarySource.setData((prev) => (prev ? { ...prev, signature: result.signature } : prev));
      setSignatureOpen(false);
      setNotice(result.signature ? "Signature saved. It is added to mail you start from here." : "Signature removed.");
    } catch (err) {
      setFailure(errorMessage(err) ?? "Could not save the signature.");
    } finally {
      setBusy(false);
    }
  };

  const startReply = () => {
    if (!message) return;
    closing.current = false;
    draftUid.current = null;
    setDraft({
      mode: "reply",
      to: message.from.address,
      cc: "",
      subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
      body: `${signatureBlock}${quote(message)}`,
      inReplyTo: message.messageId ?? "",
      references: [message.references, message.messageId].filter(Boolean).join(" "),
      files: [],
    });
  };

  const startForward = () => {
    if (!message) return;
    closing.current = false;
    draftUid.current = null;
    setDraft({
      mode: "forward",
      to: "",
      cc: "",
      subject: /^fwd:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
      body: `${signatureBlock || "\n\n"}---------- Forwarded message ----------\nFrom: ${message.from.name} <${message.from.address}>\nDate: ${fullWhen(message.date)}\nSubject: ${message.subject}\n\n${message.text}`,
      inReplyTo: "",
      references: "",
      files: [],
    });
  };

  const send = async (current: Draft) => {
    setBusy(true);
    setFailure(null);
    try {
      const attachments = await Promise.all(
        current.files.map(async (file) => ({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: await toBase64(file),
        })),
      );
      const result = await api.post<{ ok: boolean; saved: boolean }>("/mail/send", {
        to: current.to,
        cc: current.cc,
        subject: current.subject,
        text: current.body,
        inReplyTo: current.inReplyTo || undefined,
        references: current.references || undefined,
        attachments,
      });
      await closeComposer();
      setNotice(
        result.saved
          ? "Sent, and a copy is in Sent."
          : "Sent. The copy in Sent could not be saved — the message itself went out.",
      );
      listSource.reload();
      refreshFolders();
    } catch (err) {
      setFailure(errorMessage(err) ?? "The message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const openDraft = (uid: number) =>
    run(async () => {
      const result = await api.get<{ draft: ServerDraft | null }>(`/mail/drafts?uid=${uid}`, {
        cache: "no-store",
      });
      const saved = result.draft;
      if (!saved) throw new Error("That draft is no longer in Drafts.");
      closing.current = false;
      draftUid.current = saved.uid;
      setSelected(null);
      setDraft({
        mode: saved.mode,
        to: saved.to,
        cc: saved.cc,
        subject: saved.subject,
        body: saved.body,
        inReplyTo: saved.inReplyTo,
        references: saved.references,
        files: [],
      });
      setNotice("Draft opened. It saves again as you type.");
    }, "Could not open that draft.");

  const hasMailbox = Boolean(address);
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <ConsolePage size="full">
      <PageHeader
        eyebrow="MAILBOX"
        title="Mail"
        description={
          hasMailbox
            ? `${address} — read, reply and send straight from your SONUS mailbox.`
            : "Your own SONUS mailbox, for account and booking mail."
        }
        actions={
          hasMailbox ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={button}
                onClick={() => {
                  setSignatureDraft(signature);
                  setSignatureOpen((open) => !open);
                  setNotice(null);
                }}
              >
                Signature
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  closing.current = false;
                  draftUid.current = null;
                  setDraft({
                    mode: "new",
                    to: "",
                    cc: "",
                    subject: "",
                    body: signatureBlock,
                    inReplyTo: "",
                    references: "",
                    files: [],
                  });
                  setSignatureOpen(false);
                }}
              >
                Write
              </button>
            </div>
          ) : null
        }
      />

      {signatureOpen && hasMailbox && (
        <Panel
          title="Email signature"
          description="Plain text, added to the top of new mail, replies and forwards you start here."
        >
          <div className="space-y-3">
            <textarea
              className={`${field} min-h-[140px] font-mono text-[13px] leading-6`}
              value={signatureDraft}
              onChange={(event) => setSignatureDraft(event.target.value)}
              placeholder={"Your name\nSONUS Bookings · bookings@essentialsedm.com"}
              aria-label="Email signature"
            />
            <div className="flex items-center gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => void saveSignature()}>
                {busy ? "Saving…" : "Save signature"}
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setSignatureOpen(false);
                  setSignatureDraft("");
                }}
              >
                Cancel
              </button>
              <span className="ml-auto text-[11px] text-neutral-500">
                {signatureDraft.length}/2000
              </span>
            </div>
          </div>
        </Panel>
      )}

      {(loadError || failure || notice) && (
        <div className="space-y-2">
          {loadError && <p className="text-xs text-red-300">{loadError}</p>}
          {failure && <p className="text-xs text-red-300">{failure}</p>}
          {notice && <p className="text-xs text-neutral-400">{notice}</p>}
        </div>
      )}

      {!hasMailbox ? (
        <Panel title="No mailbox yet" description="A mailbox is separate from your sign-in address.">
          <p className="text-sm text-neutral-400">
            An account on this platform can have an @{summary?.domain ?? "essentialsedm.com"} mailbox, but this one
            does not yet. Ask an admin to create it for you — once it exists, this screen becomes your inbox, and the
            mailbox password works in any mail client over IMAP.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,330px)_minmax(0,1fr)]">
          {/* Folders */}
          <Panel flush className="self-start">
            <nav className="p-2">
              {folders.map((item) => {
                const active = item.name === folder;
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => openFolder(item.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                      active ? "bg-white/[0.06] text-neon" : "text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-200"
                    }`}
                  >
                    <span className="truncate">{item.name}</span>
                    {item.unseen > 0 ? (
                      <span className="ml-2 rounded-full bg-neon/15 px-2 text-[10px] font-medium text-neon">
                        {item.unseen}
                      </span>
                    ) : item.messages > 0 ? (
                      <span className="ml-2 text-[10px] text-neutral-500">{item.messages}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </Panel>

          {/* List */}
          <Panel flush className="self-start">
            <form
              className="border-b border-line p-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(pendingQuery.trim());
                setOffset(0);
                setSelected(null);
              }}
            >
              <input
                className={field}
                value={pendingQuery}
                onChange={(event) => setPendingQuery(event.target.value)}
                placeholder="Search this folder"
                aria-label="Search mail"
              />
            </form>

            {listSource.loading && !list ? (
              <p className="p-4 text-xs text-neutral-500">Loading…</p>
            ) : !list || list.messages.length === 0 ? (
              <p className="p-4 text-xs text-neutral-500">
                {query ? `Nothing matches “${query}” in ${folder}.` : `${folder} is empty.`}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {list.messages.map((row) => (
                  <li key={row.uid}>
                    <button
                      type="button"
                      onClick={() => (folder === "Drafts" ? void openDraft(row.uid) : setSelected(row.uid))}
                      className={`w-full px-3 py-2.5 text-left transition ${
                        row.uid === selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex gap-2">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[9px] text-neutral-400">
                          {initials(row.from.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={`truncate text-[13px] ${
                                row.seen ? "text-neutral-400" : "font-medium text-neutral-100"
                              }`}
                            >
                              {row.from.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-neutral-500">{when(row.date)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {!row.seen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon" />}
                            <span
                              className={`truncate text-[13px] ${row.seen ? "text-neutral-400" : "text-neutral-200"}`}
                            >
                              {row.subject}
                            </span>
                            {row.flagged && <span className="text-[10px] text-amber-300">★</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-neutral-500">
              <span>
                {total ? `${offset + 1}–${pageEnd} of ${total}` : "No messages"}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={quiet}
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - PAGE_SIZE));
                    setSelected(null);
                  }}
                >
                  Newer
                </button>
                <button
                  type="button"
                  className={quiet}
                  disabled={pageEnd >= total}
                  onClick={() => {
                    setOffset(offset + PAGE_SIZE);
                    setSelected(null);
                  }}
                >
                  Older
                </button>
              </span>
            </div>
          </Panel>

          {/* Reader / composer */}
          <div className="min-w-0">
            {draft ? (
              <Panel title={draft.mode === "reply" ? "Reply" : draft.mode === "forward" ? "Forward" : "New message"}>
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">To</span>
                    <input
                      className={field}
                      value={draft.to}
                      onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Cc</span>
                    <input
                      className={field}
                      value={draft.cc}
                      onChange={(event) => setDraft({ ...draft, cc: event.target.value })}
                      placeholder="optional"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Subject</span>
                    <input
                      className={field}
                      value={draft.subject}
                      onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                      placeholder="Subject"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Message</span>
                    <textarea
                      className={`${field} min-h-[240px] font-mono text-[13px] leading-6`}
                      value={draft.body}
                      onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Attachments</span>
                    <input
                      type="file"
                      multiple
                      className="block w-full text-xs text-neutral-400 file:mr-3 file:rounded-md file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-neutral-300"
                      onChange={(event) => setDraft({ ...draft, files: Array.from(event.target.files ?? []) })}
                    />
                    {draft.files.length > 0 && (
                      <span className="text-[11px] text-neutral-500">
                        {draft.files.map((file) => file.name).join(", ")}
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => void send(draft)}
                    >
                      {busy ? "Sending…" : "Send"}
                    </button>
                    <button
                      type="button"
                      className={quiet}
                      onClick={() => {
                        void closeComposer();
                        setRestoredFor(address);
                        setNotice(null);
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </Panel>
            ) : !messagePath ? (
              <Panel>
                <p className="p-1 text-sm text-neutral-500">
                  Pick a message to read it. Replies are sent from {address} and kept in Sent.
                </p>
              </Panel>
            ) : messageSource.loading && !message ? (
              <Panel>
                <p className="text-sm text-neutral-500">Opening…</p>
              </Panel>
            ) : !message ? (
              <Panel>
                <p className="text-sm text-neutral-500">That message is no longer in {folder}.</p>
              </Panel>
            ) : (
              <Panel
                title={message.subject}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={button} onClick={startReply}>
                      Reply
                    </button>
                    <button type="button" className={button} onClick={startForward}>
                      Forward
                    </button>
                    <button type="button" className={button} disabled={busy} onClick={() => void toggleFlag(message)}>
                      {message.flagged ? "Unstar" : "Star"}
                    </button>
                    <button type="button" className={button} disabled={busy} onClick={() => void markUnread(message)}>
                      Mark unread
                    </button>
                    {folder !== "Archive" && (
                      <button type="button" className={button} disabled={busy} onClick={() => void moveTo(message, "Archive")}>
                        Archive
                      </button>
                    )}
                    <button type="button" className={button} disabled={busy} onClick={() => void remove(message)}>
                      Delete
                    </button>
                  </div>
                }
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-neutral-200">
                        <span className="font-medium">{message.from.name}</span>
                        <span className="text-neutral-500"> &lt;{message.from.address}&gt;</span>
                      </p>
                      <p className="truncate text-[11px] text-neutral-500">
                        to {message.to.join(", ") || address}
                        {message.cc.length > 0 && ` · cc ${message.cc.join(", ")}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {message.answered && <Badge tone="info">REPLIED</Badge>}
                      <span className="text-[11px] text-neutral-500">{fullWhen(message.date)}</span>
                    </div>
                  </div>

                  {message.html ? (
                    <iframe
                      title={`Message from ${message.from.name}`}
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      srcDoc={wrapped(message.html)}
                      className="h-[60vh] min-h-[320px] w-full rounded-lg border border-line bg-white"
                    />
                  ) : (
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-white/[0.02] p-4 text-[13px] leading-6 text-neutral-200">
                      {message.text || "(no text in this message)"}
                    </pre>
                  )}

                  {message.attachments.length > 0 && (
                    <div className="space-y-1 border-t border-line pt-3">
                      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                        {message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}
                      </p>
                      <ul className="space-y-1">
                        {message.attachments.map((file) => (
                          <li key={file.index}>
                            <button
                              type="button"
                              className={quiet}
                              disabled={busy}
                              onClick={() => void download(file)}
                            >
                              {file.filename} · {bytes(file.size)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </ConsolePage>
  );
}
