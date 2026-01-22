import { useEffect, useRef, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store";
import { loadFeed, loadInitialFeed, switchTab } from "../../store/feedSlice";
import { openEditModal } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import styles from "./FeedView.module.css";

export function FeedView() {
  const dispatch = useAppDispatch();
  const { occurrences, isLoading, currentTab, hasMore } = useAppSelector(
    (state) => state.feed
  );
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dispatch(loadInitialFeed());
  }, [dispatch, currentTab]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el || isLoading || !hasMore) return;

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      dispatch(loadFeed());
    }
  }, [dispatch, isLoading, hasMore]);

  const handleTabClick = (tab: FeedTab) => {
    if (tab !== currentTab) {
      dispatch(switchTab(tab));
    }
  };

  const handleEdit = useCallback((occurrence: Occurrence) => {
    dispatch(openEditModal(occurrence));
  }, [dispatch]);

  return (
    <div className={styles.container}>
      <nav className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${currentTab === "home" ? styles.active : ""}`}
          onClick={() => handleTabClick("home")}
        >
          Home
        </button>
        <button
          className={`${styles.tabBtn} ${currentTab === "explore" ? styles.active : ""}`}
          onClick={() => handleTabClick("explore")}
        >
          Explore
        </button>
      </nav>
      <div className={styles.content} ref={contentRef} onScroll={handleScroll}>
        <div className={styles.list}>
          {occurrences.map((occ) => (
            <FeedItem key={occ.uri} occurrence={occ} onEdit={handleEdit} />
          ))}
        </div>
        {isLoading && <div className={styles.loading}>Loading...</div>}
        {!isLoading && occurrences.length === 0 && (
          <div className={styles.empty}>
            No occurrences yet. Be the first to post!
          </div>
        )}
      </div>
    </div>
  );
}
