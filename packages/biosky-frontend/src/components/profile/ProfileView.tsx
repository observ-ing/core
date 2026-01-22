import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProfileFeed, getImageUrl } from "../../services/api";
import type {
  ProfileFeedResponse,
  Occurrence,
  Identification,
} from "../../services/types";
import styles from "./ProfileView.module.css";

type ProfileTab = "all" | "observations" | "identifications";

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ProfileView() {
  const { did } = useParams<{ did: string }>();
  const [data, setData] = useState<ProfileFeedResponse | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [identifications, setIdentifications] = useState<Identification[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");

  const loadData = useCallback(
    async (loadMore = false) => {
      if (!did) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchProfileFeed(
          did,
          loadMore ? cursor : undefined,
          activeTab
        );

        if (!loadMore) {
          setData(response);
          setOccurrences(response.occurrences);
          setIdentifications(response.identifications);
        } else {
          setOccurrences((prev) => [...prev, ...response.occurrences]);
          setIdentifications((prev) => [...prev, ...response.identifications]);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setIsLoading(false);
      }
    },
    [did, cursor, activeTab]
  );

  useEffect(() => {
    setOccurrences([]);
    setIdentifications([]);
    setCursor(undefined);
    setHasMore(true);
    loadData(false);
  }, [did, activeTab]);

  if (!did) {
    return <div className={styles.container}>Profile not found</div>;
  }

  if (error) {
    return <div className={styles.container}>{error}</div>;
  }

  const profile = data?.profile;
  const counts = data?.counts;

  return (
    <div className={styles.container}>
      {/* Profile Header */}
      <div className={styles.header}>
        <div className={styles.avatar}>
          {profile?.avatar ? (
            <img src={profile.avatar} alt={profile.displayName || profile.handle || did} />
          ) : (
            <div className={styles.avatarPlaceholder} />
          )}
        </div>
        <div className={styles.info}>
          <h1 className={styles.displayName}>
            {profile?.displayName || profile?.handle || did.slice(0, 20)}
          </h1>
          {profile?.handle && (
            <div className={styles.handle}>@{profile.handle}</div>
          )}
        </div>
      </div>

      {/* Stats */}
      {counts && (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.observations}</span>
            <span className={styles.statLabel}>Observations</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.identifications}</span>
            <span className={styles.statLabel}>IDs</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.species}</span>
            <span className={styles.statLabel}>Species</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "all" ? styles.active : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All
        </button>
        <button
          className={`${styles.tab} ${activeTab === "observations" ? styles.active : ""}`}
          onClick={() => setActiveTab("observations")}
        >
          Observations
        </button>
        <button
          className={`${styles.tab} ${activeTab === "identifications" ? styles.active : ""}`}
          onClick={() => setActiveTab("identifications")}
        >
          IDs
        </button>
      </div>

      {/* Feed */}
      <div className={styles.feed}>
        {(activeTab === "all" || activeTab === "observations") &&
          occurrences.map((occ) => (
            <Link
              key={occ.uri}
              to={`/occurrence/${encodeURIComponent(occ.uri)}`}
              className={styles.item}
            >
              <div className={styles.itemType}>Observation</div>
              <div className={styles.itemContent}>
                <div className={styles.species}>
                  {occ.communityId || occ.scientificName || "Unknown species"}
                </div>
                {occ.images[0] && (
                  <img
                    src={getImageUrl(occ.images[0])}
                    alt=""
                    className={styles.thumbnail}
                    loading="lazy"
                  />
                )}
                <div className={styles.itemMeta}>
                  {formatTimeAgo(new Date(occ.createdAt))}
                  {occ.verbatimLocality && ` · ${occ.verbatimLocality}`}
                </div>
              </div>
            </Link>
          ))}

        {(activeTab === "all" || activeTab === "identifications") &&
          identifications.map((id) => (
            <Link
              key={id.uri}
              to={`/occurrence/${encodeURIComponent(id.subject_uri)}`}
              className={styles.item}
            >
              <div className={styles.itemType}>Identification</div>
              <div className={styles.itemContent}>
                <div className={styles.species}>{id.scientific_name}</div>
                {id.identification_remarks && (
                  <div className={styles.remarks}>{id.identification_remarks}</div>
                )}
                <div className={styles.itemMeta}>
                  {formatTimeAgo(new Date(id.date_identified))}
                  {id.is_agreement && " · Agrees"}
                </div>
              </div>
            </Link>
          ))}

        {isLoading && <div className={styles.loading}>Loading...</div>}

        {!isLoading && occurrences.length === 0 && identifications.length === 0 && (
          <div className={styles.empty}>No activity yet</div>
        )}

        {hasMore && !isLoading && (
          <button className={styles.loadMore} onClick={() => loadData(true)}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
