import type { AuthRole } from "@essentials/auth";

/**
 * The Help section, written per role.
 *
 * Only the roles that actually have a dashboard get a manual — a guest has no
 * screens to document, so pointing them at an admin is the whole answer.
 * Everything here is meant to stay true to the app; the same facts live in
 * `docs/chatbot-manual.md`, which is what the support agent answers from.
 */
export type HelpRole = Extract<AuthRole, "artist" | "promoter" | "venue_manager" | "door" | "admin">;

export interface HelpTopic {
  title: string;
  intro?: string;
  /** A walkthrough, shown as a numbered list before the notes. */
  steps?: string[];
  points: string[];
}

export interface HelpManual {
  role: HelpRole;
  title: string;
  summary: string;
  /** One line naming the pages this role owns. */
  screens: string;
  topics: HelpTopic[];
}

const CONTACT = "hello@essentialsedm.com";

export const HELP_MANUALS: Record<HelpRole, HelpManual> = {
  artist: {
    role: "artist",
    title: "DJ manual",
    summary:
      "How a DJ profile, slots, gigs and invoices fit together, with an invoicing walkthrough from bank details to paid and a browser broadcasting walkthrough.",
    screens: "My Profile · Live Calendar · Go Live · Artist Portal · Gig Calendar · Earnings · Notifications · Account",
    topics: [
      {
        title: "Start with My Profile",
        intro: "Everything a DJ does hangs off this profile. Without it there is nothing to apply with or bill from.",
        points: [
          "Set your stage name, bio and photo. The photo must be a real image under 5 MB; anything else is refused.",
          "Your home base and travel settings feed the route plan and the travel line on invoices. Enter the address or use USE MY LOCATION; the rate is set platform-wide by an admin and shown read-only here.",
          "If Gig Calendar and Earnings look empty, check this page first — an account with no profile has no gigs to show.",
        ],
      },
      {
        title: "Applying for a slot",
        intro: "A night is split into slots, and each slot is a queue: several DJs may apply, one gets confirmed.",
        points: [
          "Browse open slots on Gig Calendar and apply from there or from the event page on the site.",
          "You cannot apply for a slot on a date you have blocked.",
          "DJ Applications (inside the Artist Portal) shows each application as pending, confirmed or declined.",
          "A decline may include the promoter's reason. The reason is optional — if it is blank, ask the promoter.",
          "Once confirmed, the fee for that slot is locked and you appear on the public lineup with your set time.",
          "An admin can cancel a booking after a promoter confirms it — the slot reopens to the other applicants and everyone involved is told. A gig already marked played cannot be cancelled this way.",
        ],
      },
      {
        title: "Booking a live session",
        intro:
          "A DJ can only broadcast inside a session booked on the Live Calendar, so book the window before your set starts.",
        points: [
          "Live Calendar shows a month grid; pick a day, enter a start and end time, and book the session. A dot marks days that already have one.",
          "A session can be up to 12 hours, and two of your sessions cannot overlap. An end time earlier than the start is treated as the next day, so 20:00–02:00 works.",
          "Cancel a session you no longer need. An active or upcoming session is listed under Your sessions; Go Live is refused outside its window.",
          "Live sessions need a DJ profile. Without one, create it on My Profile first.",
        ],
      },
      {
        title: "Going live in the browser, start to finish",
        intro:
          "Your first broadcast, in order. The whole encoder runs in the browser — there is no OBS, stream key or second app to install.",
        steps: [
          "Book the window. Live Calendar (/bookings) → pick the day → enter a start and end time → book the session. Go Live only unlocks while one of your sessions covers the current time, so book it before your set, not after you are already on air.",
          "Open Go Live (/go-live) on a laptop or desktop in Chrome or Edge. A booked-session banner confirms the window you are broadcasting inside; if it says no session is booked, go back to step 1.",
          "Choose the picture. CAMERA films you; SCREEN shares a window, tab or your whole display. Then pick the camera and the microphone or mixer input. The device lists stay empty until the browser has permission — press START PREVIEW once and allow access, then choose the right input.",
          "Press START PREVIEW. The PRE-FLIGHT panel fills in as the browser gets each piece: camera or screen, microphone, audio level, live session and broadcast channel. Check the framing in the video panel and play a record: the audio meter and the Audio level check should move with the music. If they stay flat, the wrong input is selected or the mixer is not connected. Echo cancellation, noise suppression and auto gain are deliberately off so they cannot pump or duck the mix.",
          "Press GO LIVE once PRE-FLIGHT shows the live session and broadcast channel green. The page shows CONNECTING…, then a red-dot LIVE badge and a running timer. The stream now plays on the public front page and is pushed to every platform enabled on the admin Streaming page. Leave the tab open and keep the machine awake for the whole set.",
          "End with END BROADCAST, or simply close the tab. The public player and every restream stop with it. Preview and press GO LIVE again if you need to come back on air.",
        ],
        points: [
          "If a broadcast is already live, GO LIVE is refused: only one broadcast can run at a time. Wait for it to end.",
          "PRE-FLIGHT is advice, not a second gate: a missing microphone or a flat meter shows amber and the broadcast still starts video only. Only an unbooked session or another live broadcast blocks GO LIVE.",
          "DJs need a booked live session; admins can broadcast without one. A venue gig on Gig Calendar does not count as a live session.",
          "Use a wired connection if you can. The browser sends one encoded stream to the server; a dropped connection ends the broadcast, so preview again to restart it.",
        ],
      },
      {
        title: "When Go Live will not start",
        intro:
          "Most failures are one of five things. Check PRE-FLIGHT first — it names the piece that is missing.",
        points: [
          "No booked session: the session check is red and GO LIVE is refused. Book a window on Live Calendar that covers now. The page re-checks every 30 seconds, so refresh it after booking.",
          "Another broadcast is live: the channel check is red and GO LIVE is disabled until that broadcast ends. Only one can run at a time, platform-wide.",
          "Camera or microphone blocked: the device lists stay empty and preview shows a permission error. Allow camera and microphone for the site in the browser's address-bar settings, reload, then press START PREVIEW again.",
          "No microphone by choice or by accident: PRE-FLIGHT shows amber and the broadcast runs video only. Plug the mixer in, pick it under Microphone / mixer input, and preview again if you need sound.",
          "Audio level flat while a record plays: PRE-FLIGHT keeps Audio level amber. Select the mixer input rather than the laptop microphone, check the cable and the mixer's USB/level, and watch the meter before going live.",
          "Streaming server errors: “Could not reach the streaming server” or “The streaming server did not answer” means the connection failed before anything was sent. Check the network and press GO LIVE again; the preview stays up.",
          "The broadcast ended by itself: a dropped connection, a closed shared screen or Stop sharing ends it with a reason. Preview again, confirm PRE-FLIGHT, and GO LIVE to return. Closing the tab always ends the broadcast.",
          "Screen sharing will not start: pick a window or screen in the browser picker. Cancelling the picker leaves you in preview with an error. Use Chrome or Edge on a laptop or desktop; phones and unsupported browsers cannot capture this way.",
        ],
      },
      {
        title: "Blocking dates you cannot play",
        points: [
          "Gig Calendar → Dates I can't play blocks a day, with an optional reason.",
          "New applications on a blocked day are refused automatically.",
          "Blocking a day does not cancel a gig that is already confirmed — that needs a conversation with the promoter.",
        ],
      },
      {
        title: "Your fee",
        points: [
          "A slot's fee is the event's hourly rate multiplied by the slot's length, unless the promoter priced that slot individually.",
          "After a promoter confirms you, the agreed fee is fixed. Changes are the promoter's decision, not an edit you can make.",
          "There is no commission line: the fee is what was agreed, and you invoice the venue directly through the invoice.",
        ],
      },
      {
        title: "Invoicing end to end",
        intro:
          "A gig's money moves through six stages. Follow them in order the first time; after that, Earnings tells you where each gig is.",
        steps: [
          "Set up payment details once. My Profile → Bank account needs the account holder, bank, account number and branch code. They are printed on every invoice so the venue can pay you, and promoters never see them. Invoicing is refused until all four are filled in and your home base is set.",
          "Get confirmed for a slot. Apply on Gig Calendar or the public event page. When the promoter confirms you, the slot's fee is locked — that agreed fee is what the invoice will bill.",
          "Play the night. Do not invoice yet: a confirmed gig is not billable.",
          "Wait for the promoter to mark the gig played. They do that in DJ Applications after the set ends. Only then does the gig appear on Earnings (/earnings) with INVOICE VENUE next to it.",
          "Raise the invoice. Earnings → INVOICE VENUE sends one invoice to the venue for the agreed fee, with your bank details and a printable PDF. A gig can only be billed once.",
          "Get paid. The venue pays through the payment link on the invoice (Stripe or PayFast) or by bank transfer. The invoice stays invoiced until the provider clears it, then shows paid. While it is unpaid, REMIND VENUE nudges the venue manager in-app.",
        ],
        points: [
          "The fee is the amount agreed with the promoter. There is no commission line, and return travel from your home base to the venue is added at the platform rate.",
          "A failed payment does not cancel the invoice — retry the payment link instead of raising a second invoice.",
          "One invoice per gig, so the same set can never be billed to the venue twice. A gig missing from Earnings has not been marked played yet.",
          "Export calendar downloads confirmed and played gigs as an .ics file for your own calendar.",
        ],
      },
      {
        title: "Invoices at a glance",
        points: [
          "Earnings splits your gigs into not yet invoiced, invoiced and waiting, and paid.",
          "Unpaid invoices have REMIND VENUE, which nudges the venue manager in-app.",
          "The printable invoice can be opened and saved as a PDF, and carries your bank details and the invoice number the venue must quote.",
        ],
      },
      {
        title: "Alerts",
        points: [
          "The bell feed lives under Notifications: DJ calls, confirmations, declines and invoice notices.",
          "Telegram can be linked from the Account tab in the mobile app; once linked, gig alerts also arrive there.",
        ],
      },
      {
        title: "What's new",
        intro:
          "The site's What's new page is the release notes, read straight from the changelog — nobody edits it by hand.",
        points: [
          "What's new (/whats-new) lists every change that shipped, newest first. It is built from the release notes on each visit, so it cannot fall behind the app.",
          "It is members only. A guest account sees a members-only notice instead of the notes, and the menu entry does not appear.",
        ],
      },
      {
        title: "When something looks wrong",
        points: [
          "Sent back to a password screen? The account was created for you and has never chosen its own password. Setting one is the last step before the dashboard opens.",
          "No dashboard at all? The account is a guest. Only an admin can set DJ, promoter or venue manager on Users.",
          "INVOICE VENUE refused? My Profile is missing bank details or a home base, or the promoter has not marked the gig played yet.",
          "DJs are not asked for a two-step code; if you are being asked, the account holds a different role.",
          "Still stuck? Email " + CONTACT + " with your account email, the gig or event name, and what you expected to happen. Nobody can promise how fast a reply arrives.",
        ],
      },
    ],
  },

  promoter: {
    role: "promoter",
    title: "Promoter manual",
    summary:
      "Running a night end to end: the venue, the lineup and fees, the guest list, the door, and settling with DJs afterwards.",
    screens:
      "Analytics · Events · Venue Portal · Artists · Promotions · Insights · DJ Applications · Door · Settlements · Social Hub · Notifications · Account",
    topics: [
      {
        title: "Before you can create a night",
        points: [
          "The venue has to exist first, in Venue Portal. Creating a venue there makes you its manager.",
          "When you create an event you pick the venue. If you manage that venue yourself the event is approved immediately; otherwise the venue manager approves it before it goes public.",
          "Two-step verification is required for promoter accounts — after your password you enter a six-digit authenticator code.",
        ],
      },
      {
        title: "Creating and managing events",
        points: [
          "Statuses run draft → pending venue approval → approved → live → completed. Cancelled events can be reopened.",
          "Cancel keeps the guest list, door check-ins and DJ bookings. Delete removes the event and everything hanging off it. Use cancel for a night that is off, delete for a mistake.",
          "Clone copies a past night's venue, slot plan, fees and budget. Repeat weekly creates up to 12 dated drafts.",
          "Approving a night puts it on the front page lineup by itself, and confirming a DJ adds their name and set time to that night's card. Nobody edits the lineup by hand.",
        ],
      },
      {
        title: "Booking DJs and setting fees",
        points: [
          "Slots & budget sets a DJ fee per hour, how many slots there are, how long each runs and when the first starts.",
          "A slot's fee stays editable until a DJ is confirmed for it; after that it is locked. Decline the DJ first if the fee must change.",
          "The budget is a planning ceiling. Confirming a DJ that would pass it is refused — raise the budget or pick a cheaper slot.",
          "DJ Applications lists each applicant with the slot, fee and the DJ's record; confirming or declining notifies the DJ.",
          "Private notes on a DJ are visible only to you, follow that DJ across events, and are flagged once they are older than three months. The DJ never sees them.",
        ],
      },
      {
        title: "After the night",
        points: [
          "Mark the gig played once the set has ended. Until then the DJ cannot invoice it.",
          "Settlements shows, per night, fees agreed, invoiced, paid by the venue and still outstanding — with invoice numbers and margin.",
          "Spend CSV lists every slot, DJ, fee, completion and invoice state per event; Guest CSV downloads the guest list.",
        ],
      },
      {
        title: "Guest list and the door",
        points: [
          "Guests RSVP from the public event page while capacity allows; a duplicate RSVP is refused.",
          "Door searches the guest list by name or email and checks people in without a scanner.",
          "A guest's door pass is a signed token, so a screenshot cannot be edited into someone else's entry.",
        ],
      },
      {
        title: "Reaching the crowd",
        points: [
          "Promotions are per-event codes — discount, free entry or bottle upgrade — with a use cap and optional expiry.",
          "Insights covers guest lifetime value and cohort retention; Analytics shows RSVPs, check-ins and pacing for the next night.",
          "Social Hub generates copy, queues posts per platform and can publish immediately.",
        ],
      },
      {
        title: "What's new",
        intro:
          "The site's What's new page is the release notes, read straight from the changelog — nobody edits it by hand.",
        points: [
          "What's new (/whats-new) lists every change that shipped, newest first, and builds itself from the release notes — so the page and the dashboard cannot disagree.",
          "It is members only: promoters, DJs, venue managers and admins get in; a guest account sees a members-only notice and the menu entry is hidden.",
          "It is about what changed, not how to run a night — the manuals above stay the place for that.",
        ],
      },
      {
        title: "When something looks wrong",
        points: [
          "Cannot confirm a DJ? The confirmation would pass the event budget.",
          "Slot fee greyed out? A DJ is already confirmed for that slot.",
          "No events, DJ Applications or Settlements? Those pages belong to promoters — the account's role is something else.",
          "Still stuck? Email " + CONTACT + " with your account email, the event name, and what you expected to happen.",
        ],
      },
    ],
  },

  door: {
    role: "door",
    title: "Door staff manual",
    summary:
      "Working the guest list on the night: picking the event, searching by name or email, and checking people in without a scanner.",
    screens: "Door · Notifications · Account",
    topics: [
      {
        title: "Working the door",
        intro:
          "Door is built for a phone at the entrance: one night, one search box, one action per guest.",
        points: [
          "The Night selector lists approved, live and completed events; the most recent is chosen for you. A pending event is not a door night yet.",
          "Search by name or email — part of either is enough. Each row shows the guest, their party size and their status.",
          "Tap CHECK IN once they are inside. A guest already checked in shows INSIDE instead of being counted twice, and every check-in is written to the door log against your account.",
          "The counters are for the whole night, not the current search: On list is entries on the list, Inside is people (party sizes added up), Today is check-ins made today, and Capacity is the room's limit.",
          "RECENT ENTRIES shows the last five guests in, with the time each was checked in.",
          "The list covers the RSVPs and any guests the promoter added. A waitlisted guest is not checked in.",
          "QR scanning at the door still works and logs to the same place.",
          "Door staff sign in with email and password; two-step verification is not required for this role.",
        ],
      },
      {
        title: "When a guest is not on the list",
        points: [
          "Search by email instead — the name on the list may be spelled differently.",
          "If they are still missing, the promoter adds them to the guest list; door staff cannot create entries.",
          "A check-in cannot be undone from Door. Ask the promoter or an admin to correct a guest marked in by mistake.",
        ],
      },
      {
        title: "When something looks wrong",
        points: [
          "No events in the selector? Only approved, live and completed nights appear.",
          "Forbidden right after a role change? Roles apply at the next sign-in; sign out and back in.",
          "Still stuck? Email " + CONTACT + " with the event name, the guest and what you expected.",
        ],
      },
    ],
  },

  venue_manager: {
    role: "venue_manager",
    title: "Venue manager manual",
    summary:
      "The rooms you run, the events waiting on your approval, the door on the night, and the invoices DJs send you.",
    screens: "Venue Portal · Door · Notifications · Account",
    topics: [
      {
        title: "Your rooms",
        points: [
          "Venue Portal lists the rooms you manage. Editing a venue changes its address, map coordinates, capacity and amenities.",
          "Rooms are linked to your account by an admin; if a room is missing, that link is what has to change.",
          "Two-step verification is required for venue manager accounts — after your password you enter a six-digit authenticator code.",
        ],
      },
      {
        title: "Approving events",
        points: [
          "Events booked at your rooms arrive as pending approval. Approving publishes the event.",
          "The promoter's DJ call and lineup plan are already prepared, so approving is the step that lets the night go out.",
          "If the promoter manages the venue themselves, their events are approved immediately and never reach this queue.",
        ],
      },
      {
        title: "The door on the night",
        points: [
          "Door searches the guest list by name or email and checks people in without a scanner.",
          "Door passes are signed tokens: a pass for one event or one guest cannot be reused for another.",
          "Door logs and venue analytics are per room, so you can see how a night actually filled.",
        ],
      },
      {
        title: "Paying DJs",
        points: [
          "A DJ invoices the venue through the invoice's payment link once the promoter has marked the gig played. The platform does not hold or forward the money.",
          "Stripe and PayFast are the payment providers; only the provider clears an invoice.",
          "A failed payment does not cancel the invoice — retry the link before escalating.",
          "If the venue paid but the invoice still shows unpaid, email " + CONTACT + " with the invoice number; do not pay twice.",
        ],
      },
      {
        title: "What's new",
        intro:
          "The site's What's new page lists every change that shipped, built from the release notes rather than written by hand.",
        points: [
          "What's new (/whats-new) is members only: a guest account sees a members-only notice, and the menu entry is hidden for guests and signed-out visitors.",
          "Nothing in this manual changes without a line there, so when a screen looks different, check What's new first.",
        ],
      },
      {
        title: "When something looks wrong",
        points: [
          "No venues listed? The account is not linked to a room yet — an admin does that.",
          "An event is missing from your queue? It is either at a room you do not manage, or it was created by the venue's own manager and approved already.",
          "Signed out unexpectedly? Account shows every browser signed in to the account; revoke the one that is not yours.",
          "Still stuck? Email " + CONTACT + " with your account email, the room name and the event date.",
        ],
      },
    ],
  },

  admin: {
    role: "admin",
    title: "Admin manual",
    summary:
      "Accounts and roles, the platform rates, the security trail, the public site's content, and what to do with what support hands over.",
    screens:
      "Everything above, plus Users · Audit · Settings · Streaming · Front Page",
    topics: [
      {
        title: "Accounts and roles",
        points: [
          "Anyone can register at essentialsedm.com/register. A new account is a guest: it can RSVP to events but has no dashboard.",
          "Users lists every account. Creating one asks for a temporary password and a role; the password is shown once and the account must choose its own at first sign-in.",
          "Role changes are made here and take effect on the person's next sign-in, because the API reads the role from the database rather than the token.",
          "There is no self-service upgrade and no application form inside the app, so a request to become a DJ is a decision for the team.",
        ],
      },
      {
        title: "Rates and money settings",
        points: [
          "Settings holds the platform travel rate in rand per kilometre. Saving it applies to every DJ profile.",
          "It cannot be saved as zero; the floor is R0.01.",
          "There is no commission setting — the platform takes no cut of a DJ's fee, and the venue pays the DJ's invoice directly.",
        ],
      },
      {
        title: "The booking desk",
        points: [
          "Admin accounts see CANCEL SLOT on pending and confirmed rows in DJ Applications. It is the override for a booking neither the promoter nor the DJ can resolve.",
          "Cancelling a confirmed slot frees it, reopens it to the other applicants, and tells the DJ, the promoter and anyone still waiting on that slot. Cancelling a pending application just removes it from the promoter's queue.",
          "A gig already marked played cannot be cancelled here: it is payable, and settling it is a conversation with the DJ.",
          "Cancelling twice sends no duplicate notices. The DJ still withdraws their own pending application, and the promoter still declines, moves and extends bookings.",
        ],
      },
      {
        title: "Security",
        points: [
          "Promoters, venue managers and admins need two-step verification; DJs and guests do not.",
          "Audit records sign-ins, linked accounts, role changes and MFA activity with account, IP and detail.",
          "Dashboard sessions last 30 days and live on the server; logging out revokes the session immediately. Account lists the browsers signed in to your own account.",
          "The support chat identifies a signed-in person with a hash signed by the API. The agent's secret stays on the server and is never sent to the browser.",
        ],
      },
      {
        title: "Content and delivery",
        points: [
          "Front Page edits the curated lineup, broadcasts and site copy; media uploads are capped at 10 MB and must be real images. Approved events with a future date are added to the lineup automatically, after the curated entries.",
          "What's new on the site is read from CHANGELOG.md on every request — see the What's new topic above before changing the file.",
          "Streaming shows restream targets and their status; the public broadcast and room chat sit on the front page. Room chat clears every day at midnight, South African time.",
          "Notifications test sends through the real delivery path — bell and Telegram — and reports what each channel reached.",
        ],
      },
      {
        title: "What support hands over",
        points: [
          "Money, roles, refunds, disputed fees, failed payments and bugs go to " + CONTACT + ", with the account email, the event or gig and what was expected.",
          "Download your own data from the public privacy page, or send access, correction, deletion and objection requests to privacy@essentialsedm.com. The notice covers POPIA, GDPR/UK GDPR, CPA marketing and ECTA.",
          "No reply time is ever promised to a customer, so keep it that way when you answer.",
          "The support agent answers from docs/chatbot-manual.md. When a screen or rule changes, that file changes with it — otherwise the bot keeps describing the old app.",
        ],
      },
      {
        title: "What's new and the release notes",
        points: [
          "The site's /whats-new page is built from CHANGELOG.md. The API parses the file on every request and re-reads it when it changes, so a new dated section shows up as soon as the file is deployed — no site rebuild and no API restart.",
          "Only dated `## YYYY-MM-DD` headings open a release; the `###` headings become sections and the bullets become items. The page shows the three newest releases.",
          "The page is members only: signed-out visitors are sent to sign-in, guest accounts see a members-only notice, and the entry is hidden from both in the menu.",
        ],
      },
      {
        title: "When something looks wrong",
        points: [
          "A customer stuck on a password screen has never chosen their own password; the Users page can set one for them.",
          "A DJ with no artist profile sees empty Gig Calendar and Earnings pages — the fix is on their My Profile, not in support.",
          "Before blaming a browser, check the known-issues list in the support manual: if it is listed there, say so plainly and offer no fix or time.",
          "Still stuck? Email " + CONTACT + ".",
        ],
      },
    ],
  },
};

/** Reading order in the Help index. */
export const HELP_ORDER: HelpRole[] = ["artist", "promoter", "venue_manager", "door", "admin"];

export const HELP_LABELS: Record<HelpRole, string> = {
  artist: "DJ",
  promoter: "Promoter",
  venue_manager: "Venue manager",
  door: "Door staff",
  admin: "Admin",
};

export function isHelpRole(role: string | null | undefined): role is HelpRole {
  return (
    role === "artist" ||
    role === "promoter" ||
    role === "venue_manager" ||
    role === "door" ||
    role === "admin"
  );
}
