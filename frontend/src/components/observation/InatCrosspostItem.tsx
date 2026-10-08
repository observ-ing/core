import { Typography, Link as MuiLink } from "@mui/material";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import { DetailListItem, detailIconSx } from "../common/DetailListItem";
import type { InatCrosspost } from "../../hooks/useInatCrosspost";

interface InatCrosspostItemProps {
  crosspost: InatCrosspost;
}

/**
 * "iNaturalist" row of the observation Details list, shown to the owner while
 * a cross-post is under way, after it failed, and once it is done but before
 * its link has reached the record. After that the link is an ordinary external
 * record and {@link ExternalRecordsItem} shows it, to everyone.
 */
export function InatCrosspostItem({ crosspost }: InatCrosspostItemProps) {
  if (crosspost.status === null) return null;

  return (
    <DetailListItem
      icon={<CloudUploadOutlinedIcon sx={detailIconSx} />}
      primary="iNaturalist"
      secondary={
        <>
          {crosspost.status === "pending" && "Posting to iNaturalist…"}
          {crosspost.status === "failed" && (
            <>
              Couldn't post to iNaturalist
              {crosspost.lastError && (
                <Typography
                  variant="caption"
                  component="div"
                  sx={{ color: "text.secondary", overflowWrap: "anywhere" }}
                >
                  {crosspost.lastError}
                </Typography>
              )}
            </>
          )}
          {crosspost.status === "synced" && crosspost.inatUrl && (
            <MuiLink
              href={crosspost.inatUrl}
              target="_blank"
              rel="noopener noreferrer"
              color="primary"
            >
              View on iNaturalist
            </MuiLink>
          )}
        </>
      }
    />
  );
}
