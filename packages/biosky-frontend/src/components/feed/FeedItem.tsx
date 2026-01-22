import { Link } from "react-router-dom";
import type { Occurrence } from "../../services/types";
import { getImageUrl } from "../../services/api";
import styles from "./FeedItem.module.css";

interface FeedItemProps {
  occurrence: Occurrence;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FeedItem({ occurrence }: FeedItemProps) {
  const displayName =
    occurrence.observer.displayName ||
    occurrence.observer.handle ||
    occurrence.observer.did.slice(0, 20);
  const handle = occurrence.observer.handle
    ? `@${occurrence.observer.handle}`
    : "";
  const timeAgo = formatTimeAgo(new Date(occurrence.createdAt));
  const species =
    occurrence.communityId || occurrence.scientificName || "Unknown species";
  const imageUrl = occurrence.images[0]
    ? getImageUrl(occurrence.images[0])
    : "";

  const occurrenceUrl = `/occurrence/${encodeURIComponent(occurrence.uri)}`;

  return (
    <Link to={occurrenceUrl} className={styles.item}>
      <div className={styles.avatar}>
        {occurrence.observer.avatar && (
          <img src={occurrence.observer.avatar} alt={displayName} />
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.header}>
          <Link
            to={`/profile/${encodeURIComponent(occurrence.observer.did)}`}
            className={styles.name}
            onClick={(e) => e.stopPropagation()}
          >
            {displayName}
          </Link>
          {handle && <span className={styles.handle}>{handle}</span>}
          <span className={styles.time}>{timeAgo}</span>
        </div>
        <div className={styles.species}>{species}</div>
        {occurrence.occurrenceRemarks && (
          <div className={styles.notes}>{occurrence.occurrenceRemarks}</div>
        )}
        {occurrence.verbatimLocality && (
          <div className={styles.location}>{occurrence.verbatimLocality}</div>
        )}
        {imageUrl && (
          <div className={styles.image}>
            <img src={imageUrl} alt={species} loading="lazy" />
          </div>
        )}
      </div>
    </Link>
  );
}
