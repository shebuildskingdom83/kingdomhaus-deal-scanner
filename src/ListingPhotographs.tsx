import { useEffect, useId, useRef, useState } from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { approvedBizBuySellUrl, safeListingImage } from "./hybridListing";
import type { DealScan, ListingPhotograph } from "./types";
import { publicReportText } from "./reporting";
import { websiteProjectPhotographs } from "./websiteProjectMedia";

export function ListingPhotographs({ photographs }: { photographs: ListingPhotograph[] }) {
  const safe = photographs.filter(photo => {
    try { return Boolean(safeListingImage(photo.url) && approvedBizBuySellUrl(photo.sourceUrl)); }
    catch { return false; }
  });
  return <PhotographGallery photographs={safe} />;
}

export function BusinessWebsiteProjectGallery({ scan }: { scan: DealScan }) {
  return <PhotographGallery photographs={websiteProjectPhotographs(scan)} websiteProjects />;
}

function PhotographGallery({ photographs: safe, websiteProjects = false }: { photographs: ListingPhotograph[]; websiteProjects?: boolean }) {
  const title = websiteProjects ? "Business Website Project Gallery" : "Listing photographs";
  const previousLabel = websiteProjects ? "Previous business website project photographs" : "Previous listing photographs";
  const nextLabel = websiteProjects ? "Next business website project photographs" : "Next listing photographs";
  const gallery = useRef<HTMLDivElement>(null);
  const id = useId();
  const [bounds, setBounds] = useState({ start: true, end: false });
  const measure = () => {
    const element = gallery.current;
    if (element) setBounds({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
  };
  useEffect(() => {
    const element = gallery.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [safe.length]);
  if (!safe.length) return null;
  const move = (direction: number) => {
    const element = gallery.current;
    if (element) element.scrollBy({
      left: direction * Math.max(256, element.clientWidth * 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  };
  return <section className={"listing-photographs" + (websiteProjects ? " website-project-gallery" : "")} aria-label={title}>
    <div className="listing-photo-heading" style={websiteProjects ? { justifyContent: "flex-end" } : undefined}>
      {!websiteProjects ? <h3>{title}</h3> : null}
      {safe.length > 1 ? <div className="listing-photo-navigation">
        <button type="button" aria-label={previousLabel} aria-controls={id} disabled={bounds.start} onClick={() => move(-1)}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" aria-label={nextLabel} aria-controls={id} disabled={bounds.end} onClick={() => move(1)}><ChevronRight aria-hidden="true" /></button>
      </div> : null}
    </div>
    <div ref={gallery} id={id} className="listing-photo-strip" tabIndex={0} role="region" aria-label={websiteProjects ? "Business website project photograph gallery" : "Listing photograph gallery"} onScroll={measure}>
      {safe.map((photo, index) => <ListingPhoto key={photo.url} photo={photo} index={index} websiteProjects={websiteProjects} />)}
    </div>
  </section>;
}

function ListingPhoto({ photo, index, websiteProjects }: { photo: ListingPhotograph; index: number; websiteProjects: boolean }) {
  const [failed, setFailed] = useState(false);
  const provenanceId = useId();
  const generatedCredit = /^BizBuySell listing photograph(?:, retrieved via Apify)?; third-party rights retained\.$/i.test(photo.attribution);
  const showCredit = photo.creditRequired === true || (photo.creditRequired !== false && !generatedCredit && Boolean(photo.attribution));
  return <figure className="listing-photo" style={websiteProjects ? { position: "relative" } : undefined}>
    {failed ? <div className="listing-photo-unavailable" role="status">Photograph unavailable</div> :
      <img src={photo.url} alt={(websiteProjects && /^untitled$/i.test(photo.alt ?? "") ? photo.caption : photo.alt) || photo.caption || `${websiteProjects ? "Seller website project" : "Listing photograph"} ${index + 1}`} aria-describedby={websiteProjects ? provenanceId : undefined} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    {websiteProjects ? <figcaption id={provenanceId} className="sr-only">
      Seller website project photograph, not a marketplace listing photograph or verified transaction asset.
      {photo.caption ? ` Caption: ${photo.caption}.` : ""}
      {photo.alt ? ` Source alt text: ${photo.alt}.` : ""}
      {` Source type: seller_website. Originating webpage: ${photo.sourceUrl}. Direct image URL: ${photo.url}. ${photo.attribution}`}
    </figcaption> : showCredit ? <figcaption>{publicReportText(photo.attribution)}</figcaption> : null}
  </figure>;
}
