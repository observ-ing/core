import type { Occurrence } from "../services/types";
import { hasInatRecord } from "../lib/externalRecords";
import { getErrorMessage } from "../lib/utils";
import { useInatAccount, useCrosspostStatus } from "../lib/query/hooks";
import { useCrosspostObservation } from "../lib/query/mutations";
import { useToast } from "./useToast";

export interface InatCrosspost {
  /**
   * Where this observation's cross-post stands, or null when it has none:
   * it was never posted, or it reached iNaturalist some other way.
   */
  status: "pending" | "failed" | "synced" | null;
  /** Why the last attempt failed. */
  lastError: string | null;
  /** The iNaturalist observation, once it exists. */
  inatUrl: string | null;
  /** Post the observation, or retry posting it. Null when the viewer can't. */
  post: (() => void) | null;
}

const NOTHING: InatCrosspost = { status: null, lastError: null, inatUrl: null, post: null };

/**
 * Cross-posting state for an observation, from its owner's point of view.
 * Everything is null for anyone else, for an owner with no linked iNaturalist
 * account, and when the server has cross-posting turned off.
 */
export function useInatCrosspost(
  observation: Occurrence | null,
  viewerDid: string | undefined,
): InatCrosspost {
  const toast = useToast();
  const isOwner = observation !== null && observation.observer.did === viewerDid;
  const account = useInatAccount();
  const linked = account.data?.enabled === true && account.data.login !== null;
  const statusQuery = useCrosspostStatus(observation?.uri, isOwner && linked);
  const post = useCrosspostObservation();

  // Checked here as well as on the query: the edit form reads the same status
  // for any owner, so cached data alone doesn't mean the viewer can post.
  if (!observation || !isOwner || !linked || !statusQuery.data) return NOTHING;

  const { status, lastError, inatUrl } = statusQuery.data;
  // An iNaturalist link from anywhere else means the observation is already
  // there. The cross-post's own link doesn't count: it goes on the record
  // before the photos are posted, so a cross-post can fail with it in place.
  // The appview applies the same rule; this keeps the page from offering what
  // it would refuse.
  const otherRecords = (observation.externalRecords ?? []).filter(
    (record) => record.uri !== inatUrl,
  );
  if (hasInatRecord(otherRecords)) return NOTHING;

  const canPost = !post.isPending && (status === null || status === "failed");
  return {
    status,
    lastError,
    inatUrl,
    post: canPost
      ? () =>
          post.mutate(observation.uri, {
            onError: (error) => toast.error(getErrorMessage(error, "Couldn't post to iNaturalist")),
          })
      : null,
  };
}
