import { useState } from "react";
import { likeObservation, unlikeObservation } from "../services/api";

export function useLikeToggle(initialLiked = false, initialCount = 0) {
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialCount);

  const handleLikeToggle = async (uri: string, cid: string) => {
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => c + (wasLiked ? -1 : 1));

    try {
      if (wasLiked) {
        await unlikeObservation(uri);
      } else {
        await likeObservation(uri, cid);
      }
    } catch {
      // Revert optimistic update on failure
      setLiked(wasLiked);
      setLikeCount((c) => c + (wasLiked ? 1 : -1));
    }
  };

  return { liked, setLiked, likeCount, setLikeCount, handleLikeToggle };
}
