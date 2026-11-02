const ticketHref = (event) =>
  `mailto:bookings@essentials.co.za?subject=${encodeURIComponent(
    `Tickets — ${event.title} (${event.displayDate}, ${event.city})`
  )}`;

export default function LineupStrip({ events = [] }) {
  const hasEvents = events.length > 0;

  return (
    <section id="lineup" className="noir-sec">
      <div className="noir-sec-head">
        <span className="noir-micro">{hasEvents ? "SEASON 07" : "DATES TBA"}</span>
        <h2 className="noir-h2">THE LINEUP</h2>
      </div>

      <div className="noir-strip">
        {hasEvents
          ? events.map((event) => (
              <article key={event.id} className="noir-frame">
                <span className="noir-scan" aria-hidden="true" />
                <span className="noir-micro">{event.displayDate}</span>
                <span className="noir-frame-title">{event.title}</span>
                <span className="noir-micro">
                  {event.city} — {event.venue}
                </span>
                <span className="noir-frame-meta">
                  <span className="noir-micro">Doors {event.doors}</span>
                  <span className="noir-micro">{event.status}</span>
                </span>
                <a href={ticketHref(event)} className="noir-ticket">
                  TICKETS — {event.price}
                </a>
              </article>
            ))
          : (
            <article className="noir-frame noir-frame-empty">
              <span className="noir-scan" aria-hidden="true" />
              <span className="noir-micro">SEASON 07</span>
              <span className="noir-frame-title">NO DATES ANNOUNCED.</span>
              <span className="noir-frame-meta">
                <span className="noir-micro">Venue —</span>
                <span className="noir-micro">Doors —</span>
              </span>
            </article>
          )}

        <a href="#contact" className="noir-frame noir-frame-cta">
          <span className="noir-micro">Join the list</span>
          <span className="noir-frame-title">JOIN THE LIST</span>
          <span className="noir-micro">→</span>
        </a>
      </div>

      {!hasEvents && (
        <>
          <span className="noir-micro noir-lbl-block">Lineup</span>
          <p className="noir-note">
            The next ESSENTIALS room is still being built. Get on the list and you
            will hear about it before anyone else.
          </p>
        </>
      )}
    </section>
  );
}