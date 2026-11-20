"use client";

import { useEffect, useRef, useState } from "react";
import { api, API_URL } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";

interface DeliveryCounts {
  total: number; queued: number; sent: number; failed: number; skipped: number;
}
interface Campaign {
  id: string; name: string; flow: string; status: string; subject: string; sentCount: number; createdAt: string;
  contentHtml?: string | null;
  segment?: { name: string } | null;
  delivery: DeliveryCounts;
  _count: { emailJobs: number };
}
interface CampaignPreview {
  id: string; name: string; subject: string; from: string; html: string;
  status: string; segmentName: string | null;
}
interface Attribution {
  guestListJoins: number;
  delivery: DeliveryCounts;
  campaign: { name: string; sentCount: number };
}
interface QueueStatus {
  available: boolean;
  paused?: boolean;
  counts?: { wait?: number; active?: number; delayed?: number; failed?: number; completed?: number; paused?: number };
  quota?: { limit: number; usedToday: number; waitMs: number } | null;
  checkedAt?: string;
}
interface ImportResult {
  segmentId: string;
  name: string;
  imported: number;
  invalid: number;
}
interface Segment {
  id: string;
  name: string;
  contactCount: number | null;
  campaignCount: number;
  createdAt: string;
}
interface ListContact {
  email: string;
  name: string | null;
  consent: string;
}
interface SegmentContacts {
  id: string;
  name: string;
  total: number;
  page: number;
  pageSize: number;
  contacts: ListContact[];
}
interface BulkRemoveResult {
  ok: boolean;
  removed: number;
  contactCount: number;
}
interface BulkUnsubscribeResult {
  ok: boolean;
  unsubscribed: number;
  status: string;
}

const FLOWS = ["welcome_series", "weekly_drop", "reminder_24h", "reminder_1h", "winback", "one_off"];

/** Email engine v1: flows, segments, sends, one-click unsubscribe, campaign attribution. */
export default function EmailEngine() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [attr, setAttr] = useState<Attribution | null>(null);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<string | null>(null);
  const [listAttested, setListAttested] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<SegmentContacts | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactPage, setContactPage] = useState(1);
  const [contactQuery, setContactQuery] = useState("");
  const [activeContactQuery, setActiveContactQuery] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [excludedEmails, setExcludedEmails] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ name: "", flow: "weekly_drop", subject: "", segmentId: "", html: "" });
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewSegment, setPreviewSegment] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState<string | null>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const mailingLists = segments.filter((segment) => segment.contactCount !== null);
  const selectionCount = allMatchingSelected
    ? Math.max(0, (contacts?.total ?? 0) - excludedEmails.size)
    : selectedEmails.size;

  const clearSelection = () => {
    setSelectedEmails(new Set());
    setAllMatchingSelected(false);
    setExcludedEmails(new Set());
  };

  const load = () => {
    api.get<Campaign[]>("/email/campaigns").then(setCampaigns).catch((e) => setError(errorMessage(e)));
    api.get<Segment[]>("/email/segments", { cache: "no-store" }).then(setSegments).catch(() => {});
  };
  const loadQueue = () => {
    api.get<QueueStatus>("/email/queue", { cache: "no-store" }).then(setQueue).catch((e) => setQueueError(errorMessage(e)));
  };
  useEffect(() => { load(); loadQueue(); }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/email/campaigns", {
        ...form,
        html: form.html.trim() || undefined,
        segmentId: form.segmentId || undefined,
      });
      setForm({ name: "", flow: "weekly_drop", subject: "", segmentId: "", html: "" });
      load();
    } catch (err) { setError(errorMessage(err)); }
  };

  // Newsletters arrive by email as drafts; nothing goes out until a manager
  // opens the preview and releases the same campaign.
  const drafts = campaigns.filter((c) => c.flow === "newsletter" && c.status === "draft");

  const openPreview = async (id: string, segmentId?: string | null) => {
    setError(null);
    setPreviewBusy(true);
    setPreviewSegment(segmentId ?? "");
    try {
      setPreview(await api.get<CampaignPreview>(`/email/campaigns/${id}/preview`, { cache: "no-store" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreviewBusy(false);
    }
  };

  const releasePreview = async () => {
    if (!preview) return;
    const targetName = previewSegment
      ? segments.find((s) => s.id === previewSegment)?.name ?? "the selected list"
      : "all consenting guests";
    if (!window.confirm(`Send “${preview.subject}” to ${targetName}?`)) return;
    setReleaseBusy(true);
    setError(null);
    try {
      const result = await api.post<{ queued: number }>(`/email/campaigns/${preview.id}/send`, {
        segmentId: previewSegment || undefined,
      });
      setReleaseStatus(`Queued ${result.queued.toLocaleString()} email${result.queued === 1 ? "" : "s"} for “${preview.subject}”.`);
      setPreview(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReleaseBusy(false);
    }
  };

  const uploadList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!listAttested) {
      setListStatus("Confirm that every contact opted in before importing.");
      return;
    }
    setListStatus("Importing mailing list…");
    setManageError(null);
    try {
      const result = await api.upload<ImportResult>("/email/segments/upload", file, "file", { attested: "true" });
      setForm((current) => ({ ...current, segmentId: result.segmentId }));
      const updated = await api.get<Segment[]>("/email/segments", { cache: "no-store" });
      setSegments(updated);
      setListStatus(
        `Imported ${result.imported.toLocaleString()} email${result.imported === 1 ? "" : "s"} into “${result.name}”` +
        `${result.invalid ? ` · ${result.invalid.toLocaleString()} row${result.invalid === 1 ? "" : "s"} skipped` : ""}.`,
      );
    } catch (err) {
      setListStatus(`Import failed: ${errorMessage(err)}`);
    }
  };

  const loadContacts = async (segmentId: string, page: number, query: string, resetSelection = true) => {
    if (resetSelection) clearSelection();
    const normalizedQuery = query.trim();
    setActiveContactQuery(normalizedQuery);
    setContactsLoading(true);
    setContactsError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (normalizedQuery) params.set("q", normalizedQuery);
      setContacts(await api.get<SegmentContacts>(`/email/segments/${segmentId}/contacts?${params}`, { cache: "no-store" }));
    } catch (err) {
      setContacts(null);
      setContactsError(errorMessage(err));
    } finally {
      setContactsLoading(false);
    }
  };

  const toggleContacts = (segmentId: string) => {
    if (openListId === segmentId) {
      setOpenListId(null);
      setContacts(null);
      clearSelection();
      return;
    }
    setOpenListId(segmentId);
    setContactPage(1);
    setContactQuery("");
    setContacts(null);
    setContactsError(null);
    void loadContacts(segmentId, 1, "");
  };

  const searchContacts = (e: React.FormEvent) => {
    e.preventDefault();
    if (!openListId) return;
    setContactPage(1);
    void loadContacts(openListId, 1, contactQuery);
  };

  const goToContactsPage = (page: number) => {
    if (!openListId) return;
    setContactPage(page);
    void loadContacts(openListId, page, activeContactQuery, false);
  };

  const isContactSelected = (email: string) =>
    allMatchingSelected ? !excludedEmails.has(email) : selectedEmails.has(email);

  const toggleContact = (email: string) => {
    if (allMatchingSelected) {
      setExcludedEmails((current) => {
        const next = new Set(current);
        if (next.has(email)) next.delete(email);
        else next.add(email);
        return next;
      });
      return;
    }
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleAllOnPage = (emails: string[]) => {
    if (allMatchingSelected) {
      setExcludedEmails((current) => {
        const next = new Set(current);
        const allSelected = emails.length > 0 && emails.every((email) => !next.has(email));
        for (const email of emails) {
          if (allSelected) next.add(email);
          else next.delete(email);
        }
        return next;
      });
      return;
    }
    setSelectedEmails((current) => {
      const next = new Set(current);
      const allSelected = emails.length > 0 && emails.every((email) => next.has(email));
      for (const email of emails) {
        if (allSelected) next.delete(email);
        else next.add(email);
      }
      return next;
    });
  };

  const selectAllMatching = () => {
    if (!contacts?.total) return;
    setSelectedEmails(new Set());
    setExcludedEmails(new Set());
    setAllMatchingSelected(true);
  };

  const selectionPayload = () => allMatchingSelected
    ? {
        allMatching: true,
        ...(activeContactQuery ? { q: activeContactQuery } : {}),
        excluded: [...excludedEmails],
      }
    : { emails: [...selectedEmails] };

  const removeSelected = async () => {
    if (!openListId || !selectionCount) return;
    if (!window.confirm(`Remove ${selectionCount.toLocaleString()} contact${selectionCount === 1 ? "" : "s"} from this list? Their consent and guest records are kept.`)) return;
    try {
      const result = await api.post<BulkRemoveResult>(
        `/email/segments/${openListId}/contacts/bulk-remove`,
        selectionPayload(),
      );
      setSegments((current) => current.map((segment) => segment.id === openListId
        ? { ...segment, contactCount: result.contactCount }
        : segment));
      const selectedOnPage = allMatchingSelected
        ? (contacts?.contacts ?? []).filter((contact) => isContactSelected(contact.email)).length
        : (contacts?.contacts ?? []).filter((contact) => selectedEmails.has(contact.email)).length;
      const remainingOnPage = (contacts?.contacts.length ?? 0) - selectedOnPage;
      const nextPage = remainingOnPage === 0 && contactPage > 1 ? contactPage - 1 : contactPage;
      setContactPage(nextPage);
      await loadContacts(openListId, nextPage, activeContactQuery);
    } catch (err) {
      setContactsError(errorMessage(err));
    }
  };

  const unsubscribeSelected = async () => {
    if (!openListId || !selectionCount) return;
    if (!window.confirm(`Unsubscribe ${selectionCount.toLocaleString()} selected contact${selectionCount === 1 ? "" : "s"}? They will stop receiving all campaign emails and stay on this list.`)) return;
    try {
      await api.post<BulkUnsubscribeResult>(
        `/email/segments/${openListId}/contacts/bulk-unsubscribe`,
        selectionPayload(),
      );
      await loadContacts(openListId, contactPage, activeContactQuery);
    } catch (err) {
      setContactsError(errorMessage(err));
    }
  };

  const exportSelected = async () => {
    if (!openListId || !selectionCount) return;
    try {
      const { blob, filename } = await api.download(
        `/email/segments/${openListId}/export`,
        selectionPayload(),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename ?? "selected-contacts.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setContactsError(errorMessage(err));
    }
  };

  const unsubscribeContact = async (email: string) => {
    if (!window.confirm(`Unsubscribe ${email}? They will stop receiving all campaign emails.`)) return;
    try {
      await api.post("/email/consent/unsubscribe", { email });
      setContacts((current) => current ? {
        ...current,
        contacts: current.contacts.map((contact) => contact.email === email ? { ...contact, consent: "revoked" } : contact),
      } : current);
    } catch (err) {
      setContactsError(errorMessage(err));
    }
  };

  const removeContact = async (email: string) => {
    if (!openListId) return;
    if (!window.confirm(`Remove ${email} from this list? Their consent and guest record are kept.`)) return;
    try {
      await api.del(`/email/segments/${openListId}/contacts?email=${encodeURIComponent(email)}`);
      setSegments((current) => current.map((segment) => segment.id === openListId
        ? { ...segment, contactCount: Math.max(0, (segment.contactCount ?? 1) - 1) }
        : segment));
      const nextPage = contacts?.contacts.length === 1 && contactPage > 1 ? contactPage - 1 : contactPage;
      setContactPage(nextPage);
      await loadContacts(openListId, nextPage, activeContactQuery);
    } catch (err) {
      setContactsError(errorMessage(err));
    }
  };

  const deleteList = async (segment: Segment) => {
    if (!window.confirm(`Delete “${segment.name}”? The contacts and campaign history are kept.`)) return;
    setManageError(null);
    try {
      await api.del(`/email/segments/${segment.id}`);
      setSegments((current) => current.filter((row) => row.id !== segment.id));
      if (openListId === segment.id) {
        setOpenListId(null);
        setContacts(null);
        clearSelection();
      }
      setForm((current) => current.segmentId === segment.id ? { ...current, segmentId: "" } : current);
    } catch (err) {
      setManageError(errorMessage(err));
    }
  };

  const insertImage = (url: string) => {
    const tag = `\n<img src="${url}" alt="" style="max-width:100%;height:auto" />\n`;
    const el = htmlRef.current;
    const start = el?.selectionStart ?? form.html.length;
    const end = el?.selectionEnd ?? form.html.length;
    setForm((current) => ({ ...current, html: current.html.slice(0, start) + tag + current.html.slice(end) }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setImageStatus("Uploading image…");
    try {
      const { url } = await api.upload<{ url: string }>("/email/upload", file);
      insertImage(url);
      setImageStatus("Image inserted.");
    } catch (err) {
      setImageStatus(`Upload failed: ${errorMessage(err)}`);
    }
  };

  const setQueuePaused = async (paused: boolean) => {
    setQueueBusy(true);
    setQueueError(null);
    try {
      setQueue(await api.post<QueueStatus>(`/email/queue/${paused ? "pause" : "resume"}`));
    } catch (err) {
      setQueueError(errorMessage(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const showAttribution = async (id: string) => {
    try { setAttr(await api.get<Attribution>(`/email/campaigns/${id}/attribution`)); } catch {}
  };

  return (
    <ConsolePage size="xl">
      <PageHeader
        eyebrow="Audience / Email"
        title="EMAIL ENGINE"
        description="Campaigns, saved mailing lists and the consent records behind every send."
      />
      <p className="-mt-3 text-xs leading-5 text-neutral-600">
        Provider: Resend (swappable — self-hosted listmonk + Postal comes in Phase 2).
        SPF/DKIM/DMARC setup: see <code className="text-neon">docs/email-deliverability.md</code>.
        All bulk sends include one-click unsubscribe + consent records.
      </p>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="console-panel console-panel-body space-y-3">
          <div>
            <h2 className="font-bold text-neon tracking-widest text-sm">MAILING LIST</h2>
            <p className="text-neutral-500 text-xs mt-1">
              Upload a CSV, TSV or TXT file with an email column and an optional name column.
              Only upload addresses that gave you permission to email them. Imported contacts are
              saved as a segment you can target below.
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-xs leading-5 text-neutral-400">
            <input
              type="checkbox"
              checked={listAttested}
              onChange={(e) => setListAttested(e.target.checked)}
              className="mt-0.5 accent-[#00ff66]"
            />
            <span>
              I confirm that every contact in this file opted in to receive marketing email and that
              I can show how they opted in. I have read the{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" className="text-neon underline">
                Privacy Notice
              </a>
              .
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label
              onClick={(e) => {
                if (!listAttested) {
                  e.preventDefault();
                  setListStatus("Confirm that every contact opted in before importing.");
                }
              }}
              className={`inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-xs font-black tracking-widest ${
                listAttested
                  ? "border-neon/60 text-neon hover:bg-neon/10"
                  : "cursor-not-allowed border-line text-neutral-600"
              }`}
            >
              UPLOAD LIST
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                className="hidden"
                onChange={uploadList}
              />
            </label>
            {listStatus && <span className="text-xs text-neutral-400">{listStatus}</span>}
          </div>

          <div className="border-t border-line pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-black tracking-widest text-neutral-400">SAVED LISTS</h3>
              <span className="text-xs text-neutral-500">
                {mailingLists.length} list{mailingLists.length === 1 ? "" : "s"}
              </span>
            </div>
            {manageError && <p className="text-red-400 text-xs">{manageError}</p>}

            {mailingLists.map((list) => {
              const isOpen = openListId === list.id;
              return (
                <div key={list.id} className="rounded-lg border border-line">
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <button type="button" onClick={() => toggleContacts(list.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-bold">{list.name}</span>
                      <span className="block text-xs text-neutral-500">
                        {(list.contactCount ?? 0).toLocaleString()} email{(list.contactCount ?? 0) === 1 ? "" : "s"}
                        {" · "}{list.campaignCount} campaign{list.campaignCount === 1 ? "" : "s"}
                        {" · "}{new Date(list.createdAt).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleContacts(list.id)}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon"
                    >
                      {isOpen ? "HIDE CONTACTS" : "VIEW CONTACTS"}
                    </button>
                    <a
                      href={`${API_URL}/email/segments/${list.id}/export`}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon"
                    >
                      EXPORT CSV
                    </a>
                    <button
                      type="button"
                      onClick={() => deleteList(list)}
                      className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-black tracking-widest text-red-400 hover:bg-red-500/10"
                    >
                      DELETE
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-line p-3 space-y-3">
                      <form onSubmit={searchContacts} className="flex flex-wrap gap-2">
                        <input
                          className="min-w-[200px] flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                          placeholder="Search this list by email…"
                          value={contactQuery}
                          onChange={(e) => setContactQuery(e.target.value)}
                        />
                        <button className="rounded-lg border border-neon/60 px-4 py-2 text-xs font-black tracking-widest text-neon hover:bg-neon/10">
                          SEARCH
                        </button>
                      </form>

                      {contactsLoading && <p className="text-xs text-neutral-500">Loading contacts…</p>}
                      {contactsError && <p className="text-xs text-red-400">{contactsError}</p>}
                      {!contactsLoading && contacts && (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-neutral-400">
                              {selectionCount
                                ? `${selectionCount.toLocaleString()} selected${allMatchingSelected ? " across all matching contacts" : ""}`
                                : "Select contacts to unsubscribe, remove, or export"}
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {allMatchingSelected ? (
                                <button
                                  type="button"
                                  onClick={clearSelection}
                                  className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon"
                                >
                                  CLEAR SELECTION
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!contacts.total}
                                  onClick={selectAllMatching}
                                  className="rounded-lg border border-neon/60 px-3 py-2 text-xs font-black tracking-widest text-neon hover:bg-neon/10 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  SELECT ALL MATCHING ({contacts.total.toLocaleString()})
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={selectionCount === 0}
                                onClick={unsubscribeSelected}
                                className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-black tracking-widest text-amber-400 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                UNSUBSCRIBE SELECTED{selectionCount ? ` (${selectionCount.toLocaleString()})` : ""}
                              </button>
                              <button
                                type="button"
                                disabled={selectionCount === 0}
                                onClick={exportSelected}
                                className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                EXPORT SELECTED
                              </button>
                              <button
                                type="button"
                                disabled={selectionCount === 0}
                                onClick={removeSelected}
                                className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-black tracking-widest text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                REMOVE SELECTED{selectionCount ? ` (${selectionCount.toLocaleString()})` : ""}
                              </button>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[680px] text-sm">
                              <thead className="text-xs uppercase text-neutral-400">
                                <tr>
                                  <th className="px-3 py-2 text-left">
                                    <input
                                      type="checkbox"
                                      aria-label="Select or deselect all contacts on this page"
                                      checked={contacts.contacts.length > 0 && contacts.contacts.every((contact) => isContactSelected(contact.email))}
                                      onChange={() => toggleAllOnPage(contacts.contacts.map((contact) => contact.email))}
                                    />
                                  </th>
                                  <th className="px-3 py-2 text-left">Email</th>
                                  <th className="px-3 py-2 text-left">Name</th>
                                  <th className="px-3 py-2 text-left">Consent</th>
                                  <th className="px-3 py-2 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {contacts.contacts.map((contact) => (
                                  <tr key={contact.email} className="border-t border-line">
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${contact.email}`}
                                        checked={isContactSelected(contact.email)}
                                        onChange={() => toggleContact(contact.email)}
                                      />
                                    </td>
                                    <td className="px-3 py-2 font-mono text-xs">{contact.email}</td>
                                    <td className="px-3 py-2 text-neutral-400">{contact.name ?? "—"}</td>
                                    <td className={`px-3 py-2 text-xs ${contact.consent === "granted" ? "text-neon" : contact.consent === "revoked" ? "text-red-400" : "text-neutral-500"}`}>
                                      {contact.consent}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="flex justify-end gap-3">
                                        <button
                                          type="button"
                                          disabled={contact.consent === "revoked"}
                                          onClick={() => unsubscribeContact(contact.email)}
                                          className="text-xs text-amber-400 underline disabled:cursor-not-allowed disabled:text-neutral-600 disabled:no-underline"
                                        >
                                          {contact.consent === "revoked" ? "Unsubscribed" : "Unsubscribe"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeContact(contact.email)}
                                          className="text-xs text-red-400 underline"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {!contacts.contacts.length && (
                                  <tr><td colSpan={5} className="px-3 py-5 text-center text-neutral-500">No emails found.</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
                            <span>
                              {contacts.total
                                ? `${(contacts.page - 1) * contacts.pageSize + 1}–${Math.min(contacts.page * contacts.pageSize, contacts.total)} of ${contacts.total.toLocaleString()} emails`
                                : "0 emails"}
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={contacts.page <= 1}
                                onClick={() => goToContactsPage(contacts.page - 1)}
                                className="rounded border border-line px-3 py-1.5 disabled:opacity-40"
                              >
                                PREVIOUS
                              </button>
                              <button
                                type="button"
                                disabled={contacts.page * contacts.pageSize >= contacts.total}
                                onClick={() => goToContactsPage(contacts.page + 1)}
                                className="rounded border border-line px-3 py-1.5 disabled:opacity-40"
                              >
                                NEXT
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!mailingLists.length && (
              <p className="text-xs text-neutral-500">No saved lists yet. Upload one above to get started.</p>
            )}
          </div>
        </div>

        <section className="border border-neon/30 bg-surface rounded-xl p-4 space-y-3">
          <div>
            <h2 className="font-bold text-neon tracking-widest text-sm">NEWSLETTER INBOX</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Email an HTML file to <strong>newsletter@essentialsedm.com</strong> from {" "}
              <strong>curator@essentialsedm.com</strong>. The attachment becomes the bulk email — nothing is sent until you preview it below.
              Bulk mail leaves as <strong>newsletter@essentialsedm.com</strong>.
            </p>
          </div>
          {releaseStatus && <p className="text-xs text-neon">{releaseStatus}</p>}
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
                <div>
                  <p className="text-sm font-bold">{draft.subject}</p>
                  <p className="text-xs text-neutral-500">
                    Received {new Date(draft.createdAt).toLocaleString()} · draft, not sent
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openPreview(draft.id)}
                  className="rounded-lg border border-neon/60 px-4 py-2 text-xs font-black tracking-widest text-neon hover:bg-neon hover:text-bg"
                >
                  PREVIEW
                </button>
              </div>
            ))}
            {!drafts.length && (
              <p className="text-xs text-neutral-500">
                {previewBusy ? "Loading preview…" : "No newsletters waiting. Send an HTML attachment from the curator address."}
              </p>
            )}
          </div>
        </section>

        <form onSubmit={send} className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <div className="grid md:grid-cols-5 gap-3 items-end">
            <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="bg-bg border border-line rounded-lg px-3 py-2" value={form.flow} onChange={(e) => setForm({ ...form, flow: e.target.value })}>
              {FLOWS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <select className="bg-bg border border-line rounded-lg px-3 py-2" value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}>
              <option value="">All consenting guests</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.contactCount !== null ? ` · ${s.contactCount.toLocaleString()} emails` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="campaign-html" className="text-xs font-bold tracking-widest text-neutral-400">
                EMAIL HTML <span className="font-normal normal-case tracking-normal text-neutral-500">(optional)</span>
              </label>
              {imageStatus && <span className="text-xs text-neutral-500">{imageStatus}</span>}
            </div>
            <textarea
              id="campaign-html"
              ref={htmlRef}
              rows={12}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs"
              placeholder={"<h1>ESSENTIALS THIS WEEK</h1>\n<p>...</p>"}
              value={form.html}
              onChange={(e) => setForm({ ...form, html: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon">
                UPLOAD EMAIL IMAGE
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="hidden"
                  onChange={uploadImage}
                />
              </label>
              <span className="text-xs text-neutral-500">
                Uploads an image for the pasted HTML above and inserts its &lt;img&gt; tag at the cursor. Empty HTML uses the selected flow&apos;s template.
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="bg-neon text-bg font-black rounded-lg px-6 py-2 tracking-widest">QUEUE SEND</button>
          </div>
        </form>

        {attr && (
          <div className="border border-neon/40 bg-surface rounded-xl p-4">
            <h2 className="font-bold text-neon">Attribution · {attr.campaign.name}</h2>
            <p className="mt-2 text-sm">
              Guest-list joins: <strong>{attr.guestListJoins}</strong> · Delivered: {attr.delivery.sent.toLocaleString()} of {attr.delivery.total.toLocaleString()}
              {attr.delivery.failed > 0 && <span className="text-red-400"> · Failed: {attr.delivery.failed.toLocaleString()}</span>}
              {attr.delivery.queued > 0 && <span className="text-neutral-400"> · Queued: {attr.delivery.queued.toLocaleString()}</span>}
              {attr.delivery.skipped > 0 && <span className="text-neutral-400"> · Skipped: {attr.delivery.skipped.toLocaleString()}</span>}
            </p>
          </div>
        )}

        {queue?.available && (
          <div className="border border-line bg-surface rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-neon tracking-widest text-sm">EMAIL QUEUE</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={loadQueue}
                  className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon"
                >
                  REFRESH
                </button>
                <button
                  type="button"
                  onClick={() => setQueuePaused(!queue.paused)}
                  disabled={queueBusy}
                  className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon disabled:opacity-50"
                >
                  {queueBusy ? "WORKING…" : queue.paused ? "RESUME" : "PAUSE"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm">
              Status: <strong className={queue.paused ? "text-amber-400" : "text-neon"}>{queue.paused ? "paused" : "running"}</strong>
              {queue.quota && (
                <span className="text-neutral-400">
                  {" "}· Today: {queue.quota.usedToday.toLocaleString()} / {queue.quota.limit.toLocaleString()}
                  {queue.quota.waitMs > 0 && <span className="text-amber-400"> · next window in {Math.ceil(queue.quota.waitMs / 3_600_000)}h</span>}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Waiting {queue.counts?.wait?.toLocaleString() ?? 0} · Active {queue.counts?.active?.toLocaleString() ?? 0} · Delayed {queue.counts?.delayed?.toLocaleString() ?? 0} · Failed {queue.counts?.failed?.toLocaleString() ?? 0}
            </p>
            {queueError && <p className="mt-2 text-xs text-red-400">{queueError}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-neon tracking-widest text-sm">CAMPAIGNS</h2>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-line px-3 py-2 text-xs font-black tracking-widest text-neutral-300 hover:border-neon/60 hover:text-neon"
          >
            REFRESH STATS
          </button>
        </div>
        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Campaign</th>
                <th className="text-left px-4 py-3">Flow</th>
                <th className="text-left px-4 py-3">Segment</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Delivery</th>
                <th className="text-left px-4 py-3">Sent</th>
                <th className="text-left px-4 py-3">Attribution</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{c.name}</td>
                  <td className="px-4 py-3 text-neutral-400">{c.flow}</td>
                  <td className="px-4 py-3 text-neutral-400">{c.segment?.name ?? "All"}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.delivery.sent.toLocaleString()} / {c.delivery.total.toLocaleString()}
                    {c.delivery.failed > 0 && <span className="text-red-400"> · {c.delivery.failed.toLocaleString()} failed</span>}
                    {c.delivery.queued > 0 && <span className="text-neutral-500"> · {c.delivery.queued.toLocaleString()} queued</span>}
                    {c.delivery.skipped > 0 && <span className="text-neutral-500"> · {c.delivery.skipped.toLocaleString()} skipped</span>}
                  </td>
                  <td className="px-4 py-3">{c.sentCount}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => showAttribution(c.id)} className="text-neon underline">View</button>
                  </td>
                </tr>
              ))}
              {!campaigns.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-neutral-500">No campaigns yet.</td></tr>}
            </tbody>
          </table>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
          <div className="my-8 w-full max-w-3xl space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-neon tracking-widest text-sm">PREVIEW · NOT SENT</h2>
                <p className="mt-1 text-sm font-bold">{preview.subject}</p>
                <p className="text-xs text-neutral-500">From {preview.from} · {preview.segmentName ?? "all consenting guests"}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold tracking-widest text-neutral-400 hover:text-neon"
              >
                CLOSE
              </button>
            </div>
            <iframe
              title={`Preview of ${preview.subject}`}
              srcDoc={preview.html}
              sandbox=""
              className="h-[420px] w-full rounded-lg border border-line bg-white"
            />
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="text-xs text-neutral-500">
                Send to
                <select
                  className="mt-1 block rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                  value={previewSegment}
                  onChange={(e) => setPreviewSegment(e.target.value)}
                >
                  <option value="">All consenting guests</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.contactCount !== null ? ` · ${s.contactCount.toLocaleString()} emails` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={releasePreview}
                disabled={releaseBusy}
                className="rounded-lg bg-neon px-6 py-2 font-black tracking-widest text-bg disabled:opacity-50"
              >
                {releaseBusy ? "QUEUEING…" : "SEND THIS NEWSLETTER"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConsolePage>
  );
}
