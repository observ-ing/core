import { memo } from "react";
import type { Occurrence } from "../../services/types";
import { useIsPending } from "../../store/pendingSlice";
import { ObservationGridCard } from "../common/ObservationGridCard";
import { PendingBadge } from "./PendingBadge";

interface ExploreGridCardProps {
  observation: Occurrence;
}

export const ExploreGridCard = memo(function ExploreGridCard({
  observation,
}: ExploreGridCardProps) {
  // Optimistic tombstone awaiting ingestion: dim it and block navigation to a
  // detail page that would 404 until the record lands.
  const isPending = useIsPending(observation.uri);

  return (
    <ObservationGridCard
      observation={observation}
      isPending={isPending}
      badge={isPending ? <PendingBadge /> : undefined}
    />
  );
});
