import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { accentListItemSx } from "./layoutSx";
import { RelativeTime } from "./RelativeTime";
import { RecordOverflowMenu } from "./RecordOverflowMenu";
import { UserCard, type UserCardActor } from "./UserCard";

export interface RecordListItemProps {
  /** The record's author. */
  actor: UserCardActor;
  /** DID to link the author's avatar/name to (falls back to `actor.did`). */
  linkDid?: string | undefined;
  /** Timestamp shown as relative time (e.g. "3h ago"). */
  date: Date;
  /** AT URI of the record, passed to the overflow menu. */
  atUri: string;
  /** Left-accent border color, e.g. `"divider"` or `"primary.main"`. */
  borderColor: string;
  /** Border color shown on hover, when the accent should change (default: unchanged). */
  hoverBorderColor?: string | undefined;
  /** Row opacity, used to visually de-emphasize e.g. a superseded record (default 1). */
  opacity?: number;
  /** Shows a "Delete" item in the overflow menu when provided. */
  onDelete?: (() => void | Promise<void>) | undefined;
  /** Status chips rendered between the timestamp and the overflow menu. */
  badges?: ReactNode;
  /** Content rendered below the author name (comment body, identified taxon, …). */
  belowName: ReactNode;
}

/**
 * Left-accent row for a record's history/discussion list: avatar + author
 * name, relative timestamp, optional status badges, and an overflow menu.
 * Shared by `CommentSection` and `IdentificationHistory` so the row layout
 * can't drift between the two feeds.
 */
export function RecordListItem({
  actor,
  linkDid,
  date,
  atUri,
  borderColor,
  hoverBorderColor,
  opacity = 1,
  onDelete,
  badges,
  belowName,
}: RecordListItemProps) {
  return (
    <Box
      sx={{
        ...accentListItemSx,
        borderColor,
        opacity,
        transition: "all 0.2s ease",
        "&:hover": {
          bgcolor: "action.hover",
          ...(hoverBorderColor ? { borderColor: hoverBorderColor } : {}),
        },
      }}
    >
      <UserCard
        actor={actor}
        {...(linkDid ? { linkDid } : {})}
        avatarSize={32}
        alignItems="flex-start"
        link
        nameVariant="body2"
        nameSx={{ fontWeight: "medium" }}
        trailing={
          <>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              <RelativeTime date={date} withAgo />
            </Typography>
            {badges}
            <Box sx={{ ml: "auto" }}>
              <RecordOverflowMenu
                atUri={atUri}
                sx={{ p: 0.5 }}
                {...(onDelete ? { onDelete } : {})}
              />
            </Box>
          </>
        }
        belowName={belowName}
      />
    </Box>
  );
}
