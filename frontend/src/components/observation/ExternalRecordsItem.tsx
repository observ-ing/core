import { Button, CircularProgress, Stack, Typography, Link as MuiLink } from "@mui/material";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import type { ExternalRecord } from "../../bindings/ExternalRecord";
import { DetailListItem, detailIconSx } from "../common/DetailListItem";
import { getExternalRecordLabel, getExternalRecordHref } from "../../lib/externalRecords";
import type { InatCrosspost } from "../../hooks/useInatCrosspost";

interface ExternalRecordsItemProps {
  records: ExternalRecord[];
  /**
   * The owner's cross-posting state for this observation, which adds a "Post
   * to iNaturalist" action and its progress to the row. Omit it, or pass the
   * hook's empty state, for anyone who can't cross-post.
   */
  crosspost?: InatCrosspost | undefined;
}

/**
 * "Also recorded on" row of the observation Details list: the occurrence
 * lexicon's `externalRecords`, which cross-link this observation to the same
 * organism recorded on another platform (iNaturalist, BugGuide) or in another
 * AT Protocol lexicon.
 *
 * Renders nothing when there are none — which is the case for the vast
 * majority of observations, so the row never becomes dead weight in the list.
 * The exception is the observation's owner with a linked iNaturalist account,
 * who gets the row as the place to post it there, without the "Also recorded
 * on" label until there is a link to list. Entries are shown verbatim:
 * the appview doesn't resolve the targets, so we label them by service and let
 * the reader decide whether to follow.
 */
export function ExternalRecordsItem({ records, crosspost }: ExternalRecordsItemProps) {
  // A finished cross-post is a link like any other. Show it from the
  // cross-post's status until the record itself has caught up.
  const posted: ExternalRecord | null =
    crosspost?.status === "synced" && crosspost.inatUrl
      ? { uri: crosspost.inatUrl, service: "inaturalist" }
      : null;
  const shown =
    posted && !records.some((record) => record.uri === posted.uri) ? [...records, posted] : records;
  const unposted =
    crosspost && (crosspost.post || crosspost.status === "pending" || crosspost.status === "failed")
      ? crosspost
      : null;

  if (shown.length === 0 && !unposted) return null;

  return (
    <DetailListItem
      icon={<LinkOutlinedIcon sx={detailIconSx} />}
      // Unlabelled when all it holds is the offer to post: nothing is
      // recorded anywhere else yet.
      primary={shown.length > 0 ? "Also recorded on" : null}
      secondary={
        <Stack spacing={0.25}>
          {shown.map((record) => {
            const label = getExternalRecordLabel(record);
            const href = getExternalRecordHref(record.uri);
            return (
              <Typography key={record.uri} variant="body2" component="div">
                {href ? (
                  <MuiLink href={href} target="_blank" rel="noopener noreferrer" color="primary">
                    {label}
                  </MuiLink>
                ) : (
                  // Not a scheme a browser can follow (an at-uri, typically):
                  // show the raw URI so it can still be copied or pasted into
                  // whichever client handles it.
                  <>
                    {label}{" "}
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "text.disabled", wordBreak: "break-all" }}
                    >
                      {record.uri}
                    </Typography>
                  </>
                )}
              </Typography>
            );
          })}
          {unposted && <InatCrosspostEntry crosspost={unposted} />}
        </Stack>
      }
    />
  );
}

/** The iNaturalist entry of the row before the observation is posted there. */
function InatCrosspostEntry({ crosspost }: { crosspost: InatCrosspost }) {
  if (crosspost.status === "pending") {
    return (
      <Stack
        role="status"
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", color: "text.secondary" }}
      >
        <CircularProgress size={14} color="inherit" />
        <Typography variant="body2" component="div">
          Posting to iNaturalist…
        </Typography>
      </Stack>
    );
  }

  if (crosspost.status === "failed") {
    return (
      <div>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" component="div">
            Couldn't post to iNaturalist
          </Typography>
          {crosspost.post && (
            <Button
              size="small"
              variant="outlined"
              onClick={crosspost.post}
              aria-label="Retry posting to iNaturalist"
            >
              Retry
            </Button>
          )}
        </Stack>
        {crosspost.lastError && (
          <Typography
            variant="caption"
            component="div"
            sx={{ color: "text.secondary", overflowWrap: "anywhere" }}
          >
            {crosspost.lastError}
          </Typography>
        )}
      </div>
    );
  }

  if (!crosspost.post) return null;
  return (
    <div>
      <Button size="small" variant="outlined" onClick={crosspost.post} sx={{ mt: 0.5 }}>
        Post to iNaturalist
      </Button>
    </div>
  );
}
