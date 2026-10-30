import { useSiteContent } from "@/lib/useSiteContent";

export default function ManifestoQuote() {
  const c = useSiteContent();
  const quoteLines = String(c.quote).split("\n");
  return (
    <section id="collective" className="noir-sec noir-quote-sec">
      <span className="noir-micro">THE COLLECTIVE</span>
      <blockquote className="noir-quote">
        {quoteLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < quoteLines.length - 1 && <br />}
          </span>
        ))}
      </blockquote>

      <div className="noir-cols">
        <p>{c.manifestoP1}</p>
        <p>{c.manifestoP2}</p>
      </div>
    </section>
  );
}
