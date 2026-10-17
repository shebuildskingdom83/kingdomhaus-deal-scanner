import { useState } from "react";
import { safeListingImage } from "./hybridListing";
import type { ListingPhotograph } from "./types";

export function ListingPhotographs({ photographs }: { photographs: ListingPhotograph[] }) {
  const safe = photographs.filter((photo) => safeListingImage(photo.url));
  if (!safe.length) return null;
  return <section className="listing-photographs" aria-label="Listing photographs">
    <h3>Listing photographs</h3>
    <div className="listing-photo-strip" tabIndex={0} role="region" aria-label="Listing photograph gallery">
      {safe.map((photo, index) => <ListingPhoto key={photo.url} photo={photo} index={index} />)}
    </div>
    <p className="section-note">Source: BizBuySell via Apify. Third-party listing images, for internal research.</p>
  </section>;
}

function ListingPhoto({ photo, index }: { photo: ListingPhotograph; index: number }) {
  const [failed, setFailed] = useState(false);
  return <figure className="listing-photo">
    {failed ? <div className="listing-photo-unavailable" role="status">Photograph unavailable</div> :
      <img src={photo.url} alt={`Listing photograph ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    <figcaption>Listing photograph {index + 1}</figcaption>
  </figure>;
}
