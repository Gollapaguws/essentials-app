import { useSiteContent } from "@/lib/useSiteContent";

export default function SiteFooter() {
  const c = useSiteContent();

  return (
    <footer id="contact" className="noir-contact">
      <div className="noir-foot">
        <span className="noir-micro">{c.footerLeft}</span>
        <a
          className="noir-micro noir-foot-newsletter"
          href="https://newsletters.essentialsedm.com/lists/?p=subscribe"
          target="_blank"
          rel="noreferrer"
        >
          Newsletter
        </a>
        <span className="noir-micro">{c.footerRight}</span>
      </div>
    </footer>
  );
}
