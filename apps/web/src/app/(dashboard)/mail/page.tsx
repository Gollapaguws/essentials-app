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
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  /** Set only by the all-folders search. */
  folder?: string;
}

interface Thread {
  key: string;
  folder: string;
  count: number;
  unseen: number;
  latest: Row;
  uids: number[];
}

interface ListPage {
  folder: string;
  total: number;
  offset: number;
  limit: number;
  threaded: boolean;
  threads: Thread[];
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

/** A conversation reader answers with several messages; one message with one. */
type Reader = Message | { folder: string; messages: Message[] };

interface Draft {
  mode: "new" | "reply" | "forward";
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  files: File[];
  /** Attachments already stored with the server-side draft. */
  saved: Attachment[];
}

/** A draft as the server keeps it in the mailbox's Drafts folder. */
interface ServerDraft {
  uid: number;
  mode: "new" | "reply" | "forward";
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  attachments: Attachment[];
  updatedAt: string | null;
}

interface Rule {
  id: string;
  field: "from" | "to" | "subject";
  contains: string;
  folder: string;
}

const AUTOSAVE_MS = 1500;

const UNDO_MS = 6000;

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

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read that attachment."));
    reader.readAsDataURL(blob);
  });
}

/** Read an attachment already stored in the draft, so it can be sent with it. */
async function storedAttachment(uid: number, file: Attachment): Promise<string> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/mail/messages/${uid}/attachments/${file.index}?folder=Drafts`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Could not reopen ${file.filename}.`);
  return toBase64(await res.blob());
}

function stampOf(files: File[]): string {
  return files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
}

export default function Mail() {
  const [folder, setFolder] = useState("INBOX");
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  // The uids of the open conversation, oldest first; one uid for a plain message.
  const [selection, setSelection] = useState<number[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [undoOffer, setUndoOffer] = useState<string | null>(null);
  // Which mailbox's saved draft has already been offered, so a dismissal sticks.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [newRule, setNewRule] = useState<Rule>({ id: "", field: "from", contains: "", folder: "Archive" });
  // The Drafts-folder uid behind the open composer, and whether a save is running.
  const draftUid = useRef<number | null>(null);
  const saveInFlight = useRef<Promise<unknown> | null>(null);
  const closing = useRef(false);
  const draftOpen = useRef(false);
  // A move waiting out its undo window; the row is already gone from the list.
  const pendingUndo = useRef<{ uids: number[]; folder: string; to: string; label: string; timer: number } | null>(
    null,
  );
  // Base64 is only computed once per file, so autosave does not re-read big ones.
  const encoded = useRef(new Map<File, string>());
  const savedFiles = useRef("");

  const summarySource = useResource<Summary>("/mail");
  const summary = summarySource.data;
  const address = summary?.address ?? null;
  const signature = summary?.signature ?? "";
  /** Signature text placed above whatever the composer already holds. */
  const signatureBlock = signature.trim() ? `\n\n${signature.trim()}\n` : "";

  const listPath = address
    ? `/mail/messages?folder=${encodeURIComponent(folder)}&offset=${offset}&limit=${PAGE_SIZE}${
        query ? `&q=${encodeURIComponent(query)}` : ""
      }${everywhere && query ? "&everywhere=1" : ""}`
    : null;
  const listSource = useResource<ListPage>(listPath);
  const list = listSource.data;

  const readerPath =
    address && selection
      ? selection.length > 1
        ? `/mail/thread?folder=${encodeURIComponent(folder)}&uids=${selection.join(",")}`
        : `/mail/messages/${selection[0]}?folder=${encodeURIComponent(folder)}`
      : null;
  const readerSource = useResource<Reader>(readerPath);
  const entries: Message[] = readerSource.data
    ? "messages" in readerSource.data
      ? readerSource.data.messages
      : [readerSource.data]
    : [];
  // Actions apply to the newest message; the reader shows the whole conversation.
  const message = entries.length ? entries[entries.length - 1] : null;

  const total = list?.total ?? 0;
  const folders = summary?.folders ?? [];
  const loadError = summarySource.error ?? listSource.error;
  // Where a rule may file: never INBOX or Drafts, and the standard folders are
  // there even before the mailbox has used them.
  const folderNames = Array.from(
    new Set([
      ...folders.map((item) => item.name).filter((name) => name !== "INBOX" && name !== "Drafts"),
      "Archive",
      "Junk",
      "Trash",
    ]),
  );

  const patchRows = (uids: number[], patch: Partial<Row>) => {
    listSource.setData((prev) =>
      prev
        ? {
            ...prev,
            threads: prev.threads.map((thread) =>
              uids.includes(thread.latest.uid) ? { ...thread, unseen: 0, latest: { ...thread.latest, ...patch } } : thread,
            ),
            messages: prev.messages.map((row) => (uids.includes(row.uid) ? { ...row, ...patch } : row)),
          }
        : prev,
    );
  };

  // Opening a message marks it read on the server; the row should say so at once.
  useEffect(() => {
    if (!message) return;
    patchRows(
      entries.map((entry) => entry.uid),
      { seen: true },
    );
    // Deliberately keyed on the open conversation: rewriting the list must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.uid, entries.length]);

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
      savedFiles.current = stampOf([]);
      setDraft({
        mode: saved.mode,
        to: saved.to,
        cc: saved.cc,
        bcc: saved.bcc,
        subject: saved.subject,
        body: saved.body,
        inReplyTo: saved.inReplyTo,
        references: saved.references,
        files: [],
        saved: saved.attachments,
      });
      setNotice(
        saved.attachments.length
          ? "Draft restored from Drafts, attachments and all. It saves again as you type."
          : "Draft restored from Drafts. It saves again as you type.",
      );
    })();
  }, [address, restoredFor]);

  // Autosave into the Drafts folder, replacing the previous copy of this draft.
  useEffect(() => {
    if (!address || !draft || closing.current) return;
    const blank = !draft.to.trim() && !draft.cc.trim() && !draft.bcc.trim() && !draft.subject.trim() && !draft.body.trim();
    if (blank) return;
    const timer = window.setTimeout(() => {
      saveInFlight.current = (async () => {
        // Files already in the stored draft are kept by the server; only changed
        // files are re-sent, so autosave does not upload the same 10 MB again.
        const changed = stampOf(draft.files) !== savedFiles.current;
        const attachments = changed
          ? await Promise.all(
              draft.files.map(async (file) => ({
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                contentBase64: encoded.current.get(file) ?? (await toBase64(file)),
              })),
            )
          : undefined;
        if (changed) savedFiles.current = stampOf(draft.files);
        return api.post<{ uid: number }>("/mail/drafts", {
          mode: draft.mode,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          inReplyTo: draft.inReplyTo || undefined,
          references: draft.references || undefined,
          attachments,
          uid: draftUid.current,
        });
      })()
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

  // Leaving the page must not strand a move: it goes now, without the wait.
  useEffect(() => {
    return () => {
      const pending = pendingUndo.current;
      if (!pending) return;
      window.clearTimeout(pending.timer);
      for (const uid of pending.uids) {
        void api.post(`/mail/messages/${uid}/move`, { folder: pending.folder, to: pending.to }).catch(() => null);
      }
    };
  }, []);

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

  /** Archive and Delete wait a few seconds, so a misclick is undoable. */
  const commitPending = async () => {
    const pending = pendingUndo.current;
    if (!pending) return;
    pendingUndo.current = null;
    window.clearTimeout(pending.timer);
    setUndoOffer(null);
    let failed = false;
    for (const uid of pending.uids) {
      await api.post(`/mail/messages/${uid}/move`, { folder: pending.folder, to: pending.to }).catch(() => {
        failed = true;
      });
    }
    listSource.reload();
    refreshFolders();
    if (failed) setFailure(`Could not move ${pending.label.toLowerCase()}; the message is still where it was.`);
  };

  const undoPending = async () => {
    const pending = pendingUndo.current;
    if (!pending) return;
    pendingUndo.current = null;
    window.clearTimeout(pending.timer);
    setUndoOffer(null);
    setNotice("Nothing was moved.");
    listSource.reload();
  };

  const scheduleMove = (uids: number[], to: string, label: string) => {
    void commitPending();
    listSource.setData((prev) =>
      prev
        ? {
            ...prev,
            total: Math.max(0, prev.total - 1),
            threads: prev.threads.filter((thread) => !uids.includes(thread.latest.uid)),
            messages: prev.messages.filter((row) => !uids.includes(row.uid)),
          }
        : prev,
    );
    setSelection(null);
    setNotice(`${label}.`);
    setUndoOffer(`${label} — Undo`);
    const timer = window.setTimeout(() => void commitPending(), UNDO_MS);
    pendingUndo.current = { uids, folder, to, label, timer };
  };

  const openFolder = (name: string) => {
    void commitPending();
    setFolder(name);
    setOffset(0);
    setSelection(null);
    // A saved draft survives folder changes; only Send or Discard clears it.
    setNotice(null);
    setFailure(null);
  };

  const openThread = (uids: number[], target = folder) => {
    if (target === "Drafts") {
      void openDraft(uids[uids.length - 1]);
      return;
    }
    setSelection(uids);
    setNotice(null);
    setFailure(null);
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

  const selectionUids = selection ?? [];

  const toggleFlag = (row: Row) =>
    run(async () => {
      await api.post(`/mail/messages/${row.uid}/flags`, { folder: row.folder ?? folder, flagged: !row.flagged });
      patchRows([row.uid], { flagged: !row.flagged });
      if (selectionUids.includes(row.uid)) readerSource.reload();
    }, "Could not change the star.");

  const markUnread = async (uids: number[]) => {
    await run(async () => {
      for (const uid of uids) {
        await api.post(`/mail/messages/${uid}/flags`, { folder, seen: false });
      }
      patchRows(uids, { seen: false });
      refreshFolders();
      setSelection(null);
    }, "Could not mark the message unread.");
  };

  const archive = (uids: number[]) => scheduleMove(uids, "Archive", "Archived");

  const remove = async (uids: number[]) => {
    if (folder !== "Trash") {
      scheduleMove(uids, "Trash", "Moved to Trash");
      return;
    }
    if (!window.confirm("Delete this message for good? This cannot be undone.")) return;
    await run(async () => {
      for (const uid of uids) await api.del(`/mail/messages/${uid}?folder=${encodeURIComponent(folder)}`);
      setNotice("Message deleted.");
      setSelection(null);
      listSource.reload();
      refreshFolders();
    }, "Could not delete the message.");
  };

  /** Teach the spam filter and file the message, in one round trip. */
  const spam = (action: "spam" | "ham") =>
    run(async () => {
      let learned = false;
      for (const uid of selectionUids) {
        const result = await api.post<{ learned?: boolean }>(`/mail/messages/${uid}/spam`, { folder, action });
        learned = learned || Boolean(result?.learned);
      }
      setNotice(
        action === "spam"
          ? learned
            ? "Moved to Junk and reported as spam."
            : "Moved to Junk."
          : "Moved to INBOX and marked as not spam.",
      );
      setSelection(null);
      listSource.reload();
      refreshFolders();
    }, "Could not file that message.");

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

  const openRules = async () => {
    setRulesOpen((open) => !open);
    setNotice(null);
    if (rules) return;
    const result = await api.get<{ rules: Rule[] }>("/mail/rules").catch(() => null);
    setRules(result?.rules ?? []);
  };

  const saveRules = (next: Rule[]) =>
    run(async () => {
      const result = await api.patch<{ rules: Rule[] }>("/mail/rules", { rules: next });
      setRules(result.rules);
      setNotice(result.rules.length ? "Rules saved. Matching mail is filed within a minute." : "Rules removed.");
    }, "Could not save the rules.");

  const addRule = () => {
    if (!newRule.contains.trim()) return;
    const rule: Rule = { ...newRule, id: `${Date.now()}`, contains: newRule.contains.trim() };
    void saveRules([...(rules ?? []), rule]);
    setNewRule({ id: "", field: "from", contains: "", folder: newRule.folder });
  };

  const startReply = (all: boolean) => {
    if (!message) return;
    const mine = (address ?? "").toLowerCase();
    const to = new Set<string>([message.from.address.toLowerCase()]);
    if (all) {
      for (const entry of [...message.to, ...message.cc]) {
        if (entry && entry.toLowerCase() !== mine) to.add(entry.toLowerCase());
      }
    }
    // Reply-all puts everyone but the sender on Cc, the way mail clients do.
    const primary = message.from.address.toLowerCase();
    const cc = all
      ? [...to].filter((entry) => entry !== primary && entry !== mine)
      : [];
    closing.current = false;
    draftUid.current = null;
    savedFiles.current = stampOf([]);
    setDraft({
      mode: "reply",
      to: all ? [...to].join(", ") : message.from.address,
      cc: cc.join(", "),
      bcc: "",
      subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
      body: `${signatureBlock}${quote(message)}`,
      inReplyTo: message.messageId ?? "",
      references: [message.references, message.messageId].filter(Boolean).join(" "),
      files: [],
      saved: [],
    });
  };

  const startForward = () => {
    if (!message) return;
    closing.current = false;
    draftUid.current = null;
    savedFiles.current = stampOf([]);
    setDraft({
      mode: "forward",
      to: "",
      cc: "",
      bcc: "",
      subject: /^fwd:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
      body: `${signatureBlock || "\n\n"}---------- Forwarded message ----------\nFrom: ${message.from.name} <${message.from.address}>\nDate: ${fullWhen(message.date)}\nSubject: ${message.subject}\n\n${message.text}`,
      inReplyTo: "",
      references: "",
      files: [],
      saved: [],
    });
  };

  const send = async (current: Draft) => {
    setBusy(true);
    setFailure(null);
    try {
      const fresh = await Promise.all(
        current.files.map(async (file) => ({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: encoded.current.get(file) ?? (await toBase64(file)),
        })),
      );
      // Attachments that came back with the draft are fetched from it, not re-picked.
      const stored = draftUid.current
        ? await Promise.all(current.saved.map((file) => storedAttachment(draftUid.current as number, file)))
        : [];
      const result = await api.post<{ ok: boolean; saved: boolean }>("/mail/send", {
        to: current.to,
        cc: current.cc,
        bcc: current.bcc,
        subject: current.subject,
        text: current.body,
        inReplyTo: current.inReplyTo || undefined,
        references: current.references || undefined,
        attachments: [
          ...fresh,
          ...current.saved.map((file, index) => ({
            filename: file.filename,
            contentType: file.contentType,
            contentBase64: stored[index],
          })),
        ],
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

  const openDraft = async (uid: number) => {
    await run(async () => {
      const result = await api.get<{ draft: ServerDraft | null }>(`/mail/drafts?uid=${uid}`, {
        cache: "no-store",
      });
      const saved = result.draft;
      if (!saved) throw new Error("That draft is no longer in Drafts.");
      closing.current = false;
      draftUid.current = saved.uid;
      savedFiles.current = stampOf([]);
      setSelection(null);
      setDraft({
        mode: saved.mode,
        to: saved.to,
        cc: saved.cc,
        bcc: saved.bcc,
        subject: saved.subject,
        body: saved.body,
        inReplyTo: saved.inReplyTo,
        references: saved.references,
        files: [],
        saved: saved.attachments,
      });
      setNotice("Draft opened. It saves again as you type.");
    }, "Could not open that draft.");
  };

  const hasMailbox = Boolean(address);
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const activeUid = selection ? selection[selection.length - 1] : null;

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
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={button} onClick={() => void openRules()}>
                Rules
              </button>
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
                  savedFiles.current = stampOf([]);
                  setDraft({
                    mode: "new",
                    to: "",
                    cc: "",
                    bcc: "",
                    subject: "",
                    body: signatureBlock,
                    inReplyTo: "",
                    references: "",
                    files: [],
                    saved: [],
                  });
                  setSignatureOpen(false);
                  setRulesOpen(false);
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

      {rulesOpen && hasMailbox && (
        <Panel
          title="Filing rules"
          description="Checked every minute against your INBOX, so mail lands in the right folder without you moving it."
        >
          <div className="space-y-3">
            {rules === null ? (
              <p className="text-xs text-neutral-500">Loading…</p>
            ) : rules.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No rules yet. A rule files mail that matches it into a folder for you.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-neutral-300">
                      {rule.field === "from" ? "From" : rule.field === "to" ? "To" : "Subject"} contains{" "}
                      <span className="text-neutral-100">“{rule.contains}”</span> → {rule.folder}
                    </span>
                    <button
                      type="button"
                      className={quiet}
                      disabled={busy}
                      onClick={() => void saveRules(rules.filter((item) => item.id !== rule.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-neutral-500">Matches</span>
                <select
                  className={field}
                  value={newRule.field}
                  onChange={(event) =>
                    setNewRule({ ...newRule, field: event.target.value as Rule["field"] })
                  }
                  aria-label="Rule field"
                >
                  <option value="from">From</option>
                  <option value="to">To</option>
                  <option value="subject">Subject</option>
                </select>
              </label>
              <label className="min-w-[160px] flex-1 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-neutral-500">Contains</span>
                <input
                  className={field}
                  value={newRule.contains}
                  onChange={(event) => setNewRule({ ...newRule, contains: event.target.value })}
                  placeholder="bookings@example.com"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-neutral-500">File into</span>
                <select
                  className={field}
                  value={newRule.folder}
                  onChange={(event) => setNewRule({ ...newRule, folder: event.target.value })}
                  aria-label="Rule folder"
                >
                  {folderNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={button} disabled={busy || !newRule.contains.trim()} onClick={addRule}>
                Add rule
              </button>
            </div>
          </div>
        </Panel>
      )}

      {(loadError || failure || notice) && (
        <div className="space-y-2">
          {loadError && <p className="text-xs text-red-300">{loadError}</p>}
          {failure && <p className="text-xs text-red-300">{failure}</p>}
          {notice && (
            <p className="text-xs text-neutral-400">
              {notice}
              {undoOffer && (
                <button type="button" className="ml-2 text-neon hover:underline" onClick={() => void undoPending()}>
                  {undoOffer}
                </button>
              )}
            </p>
          )}
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
              className="space-y-2 border-b border-line p-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(pendingQuery.trim());
                setOffset(0);
                setSelection(null);
              }}
            >
              <input
                className={field}
                value={pendingQuery}
                onChange={(event) => setPendingQuery(event.target.value)}
                placeholder="Search — from:, subject:, since:, is:unread"
                aria-label="Search mail"
              />
              <div className="flex items-center justify-between text-[10px] text-neutral-500">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-neon"
                    checked={everywhere}
                    onChange={(event) => setEverywhere(event.target.checked)}
                  />
                  All folders
                </label>
                <span className="truncate">has:attachment · before:2026-01-31</span>
              </div>
            </form>

            {listSource.loading && !list ? (
              <p className="p-4 text-xs text-neutral-500">Loading…</p>
            ) : !list || (list.threaded ? list.threads.length === 0 : list.messages.length === 0) ? (
              <p className="p-4 text-xs text-neutral-500">
                {query
                  ? `Nothing matches “${query}”${everywhere ? " in any folder" : ` in ${folder}`}.`
                  : `${folder} is empty.`}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {(list.threaded
                  ? list.threads.map((thread) => ({
                      key: thread.key,
                      row: thread.latest,
                      count: thread.count,
                      unseen: thread.unseen,
                      uids: thread.uids,
                      folder: thread.folder,
                    }))
                  : list.messages.map((row) => ({
                      key: `${row.folder ?? folder}:${row.uid}`,
                      row,
                      count: 1,
                      unseen: row.seen ? 0 : 1,
                      uids: [row.uid],
                      folder: row.folder ?? folder,
                    }))
                ).map(({ key, row, count, unseen, uids, folder: source }) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => openThread(uids, source)}
                      className={`w-full px-3 py-2.5 text-left transition ${
                        uids.includes(activeUid ?? -1) ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
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
                                unseen === 0 ? "text-neutral-400" : "font-medium text-neutral-100"
                              }`}
                            >
                              {row.from.name}
                              {count > 1 && <span className="text-neutral-500"> (+{count - 1})</span>}
                            </span>
                            <span className="shrink-0 text-[10px] text-neutral-500">{when(row.date)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {unseen > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon" />}
                            <span className={`truncate text-[13px] ${unseen === 0 ? "text-neutral-400" : "text-neutral-200"}`}>
                              {row.subject}
                            </span>
                            {row.flagged && <span className="text-[10px] text-amber-300">★</span>}
                            {count > 1 && (
                              <span className="shrink-0 text-[10px] text-neutral-500">{count}</span>
                            )}
                          </div>
                          {!list.threaded && row.folder && row.folder !== folder && (
                            <p className="mt-0.5 text-[10px] text-neutral-500">{row.folder}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-neutral-500">
              <span>
                {total ? `${offset + 1}–${pageEnd} of ${total}${list?.threaded ? " conversation" + (total === 1 ? "" : "s") : ""}` : "No messages"}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={quiet}
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - PAGE_SIZE));
                    setSelection(null);
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
                    setSelection(null);
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
                  <div className="grid gap-3 sm:grid-cols-2">
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
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Bcc</span>
                      <input
                        className={field}
                        value={draft.bcc}
                        onChange={(event) => setDraft({ ...draft, bcc: event.target.value })}
                        placeholder="hidden from other recipients"
                      />
                    </label>
                  </div>
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
                  <div className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-500">Attachments</span>
                    <input
                      type="file"
                      multiple
                      className="block w-full text-xs text-neutral-400 file:mr-3 file:rounded-md file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-neutral-300"
                      onChange={(event) => {
                        encoded.current.clear();
                        setDraft({ ...draft, files: Array.from(event.target.files ?? []) });
                      }}
                    />
                    {(draft.files.length > 0 || draft.saved.length > 0) && (
                      <ul className="space-y-0.5 text-[11px] text-neutral-500">
                        {draft.saved.map((file) => (
                          <li key={`saved-${file.index}`}>
                            {file.filename} · {bytes(file.size)} · kept in the draft
                          </li>
                        ))}
                        {draft.files.map((file) => (
                          <li key={`new-${file.name}-${file.size}`}>
                            {file.name} · {bytes(file.size)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
            ) : !readerPath ? (
              <Panel>
                <p className="p-1 text-sm text-neutral-500">
                  Pick a message to read it. Replies are sent from {address} and kept in Sent.
                </p>
              </Panel>
            ) : readerSource.loading && !message ? (
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
                    <button type="button" className={button} onClick={() => startReply(false)}>
                      Reply
                    </button>
                    <button type="button" className={button} onClick={() => startReply(true)}>
                      Reply all
                    </button>
                    <button type="button" className={button} onClick={startForward}>
                      Forward
                    </button>
                    <button type="button" className={button} disabled={busy} onClick={() => void toggleFlag(message)}>
                      {message.flagged ? "Unstar" : "Star"}
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => void markUnread(selectionUids.length ? selectionUids : [message.uid])}
                    >
                      Mark unread
                    </button>
                    {folder !== "Archive" && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => archive(selectionUids.length ? selectionUids : [message.uid])}
                      >
                        Archive
                      </button>
                    )}
                    {folder === "Junk" ? (
                      <button type="button" className={button} disabled={busy} onClick={() => void spam("ham")}>
                        Not junk
                      </button>
                    ) : (
                      <button type="button" className={button} disabled={busy} onClick={() => void spam("spam")}>
                        Junk
                      </button>
                    )}
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => void remove(selectionUids.length ? selectionUids : [message.uid])}
                    >
                      Delete
                    </button>
                  </div>
                }
              >
                <div className="space-y-6">
                  {entries.map((entry, index) => (
                    <div
                      key={entry.uid}
                      className={index > 0 ? "space-y-3 border-t border-line pt-4" : "space-y-3"}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 text-sm">
                        <div className="min-w-0">
                          <p className="truncate text-neutral-200">
                            <span className="font-medium">{entry.from.name}</span>
                            <span className="text-neutral-500"> &lt;{entry.from.address}&gt;</span>
                          </p>
                          <p className="truncate text-[11px] text-neutral-500">
                            to {entry.to.join(", ") || address}
                            {entry.cc.length > 0 && ` · cc ${entry.cc.join(", ")}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.answered && <Badge tone="info">REPLIED</Badge>}
                          <span className="text-[11px] text-neutral-500">{fullWhen(entry.date)}</span>
                        </div>
                      </div>

                      {entry.html ? (
                        <iframe
                          title={`Message from ${entry.from.name}`}
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                          srcDoc={wrapped(entry.html)}
                          className="h-[60vh] min-h-[320px] w-full rounded-lg border border-line bg-white"
                        />
                      ) : (
                        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-white/[0.02] p-4 text-[13px] leading-6 text-neutral-200">
                          {entry.text || "(no text in this message)"}
                        </pre>
                      )}

                      {entry.attachments.length > 0 && (
                        <div className="space-y-1 border-t border-line pt-3">
                          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                            {entry.attachments.length} attachment{entry.attachments.length === 1 ? "" : "s"}
                          </p>
                          <ul className="space-y-1">
                            {entry.attachments.map((file) => (
                              <li key={file.index}>
                                <button
                                  type="button"
                                  className={quiet}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      () =>
                                        downloadFromApi(
                                          `/mail/messages/${entry.uid}/attachments/${file.index}?folder=${encodeURIComponent(
                                            entry.folder || folder,
                                          )}`,
                                          file.filename,
                                        ),
                                      "Could not download that attachment.",
                                    )
                                  }
                                >
                                  {file.filename} · {bytes(file.size)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </ConsolePage>
  );
}
