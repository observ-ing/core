import { Stack, Typography, Link as MuiLink } from "@mui/material";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import type { ExternalRecord } from "../../bindings/ExternalRecord";
import { DetailListItem, detailIconSx } from "../common/DetailListItem";
import { getExternalRecordLabel, getExternalRecordHref } from "../../lib/externalRecords";

interface ExternalRecordsItemProps {
  records: ExternalRecord[];
}

/**
 * "Also recorded on" row of the observation Details list: the occurrence
 * lexicon's `externalRecords`, which cross-link this observation to the same
 * organism recorded on another platform (iNaturalist, BugGuide) or in another
 * AT Protocol lexicon.
 *
 * Renders nothing when there are none — which is the case for the vast
 * majority of observations, so the row never becomes dead weight in the list.
 * Entries are shown verbatim: the appview doesn't resolve the targets, so we
 * label them by service and let the reader decide whether to follow.
 */
export function ExternalRecordsItem({ records }: ExternalRecordsItemProps) {
  if (records.length === 0) return null;

  return (
    <DetailListItem
      icon={<LinkOutlinedIcon sx={detailIconSx} />}
      primary="Also recorded on"
      secondary={
        <Stack spacing={0.25}>
          {records.map((record) => {
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
        </Stack>
      }
    />
  );
}
