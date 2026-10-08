import type { Occurrence } from "../services/types";
import { hasInatRecord } from "../lib/externalRecords";
import { getErrorMessage } from "../lib/utils";
import { useInatAccount, useCrosspostStatus } from "../lib/query/hooks";
import { useCrosspostObservation } from "../lib/query/mutations";
import { useToast } from "./useToast";

export interface InatCrosspost {
  /**
   * What to tell the owner about this observation's cross-post, or null when
   * there is nothing to say: it was never posted, or its iNaturalist link is
   * already on the record with the other external records.
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

  if (!observation || !statusQuery.data) return NOTHING;

  const { status, lastError, inatUrl } = statusQuery.data;
  // The appview refuses these too; this only keeps the page from offering them.
  const onInat = hasInatRecord(observation.externalRecords ?? []);
  if (onInat) return NOTHING;

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
