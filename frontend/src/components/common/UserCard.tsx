import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, Box, Stack, Typography } from "@mui/material";
import type { SxProps, Theme, TypographyProps } from "@mui/material";
import { getDisplayName } from "../../lib/utils";
import { gradientFromString } from "../../lib/gradientFromString";

/** The minimal actor shape rendered by UserCard (matches Profile / NotificationActor). */
export interface UserCardActor {
  did?: string;
  handle?: string | null;
  displayName?: string | null;
  avatar?: string | null;
}

export interface UserCardProps {
  /** The actor to display (avatar + name + handle). */
  actor: UserCardActor;
  /** Avatar diameter in pixels (default 40). */
  avatarSize?: number;
  /**
   * Avatar image URL override. When omitted, `actor.avatar` is used. Pass this
   * when the URL needs transforming (e.g. `getImageUrl(actor.avatar)`).
   */
  avatarSrc?: string | undefined;
  /** Render the `@handle` line beneath the name (default false). */
  showHandle?: boolean;
  /** Typography variant for the `@handle` line (default "body2"). */
  handleVariant?: TypographyProps["variant"];
  /**
   * Wrap the avatar + name in a profile link to `/profile/{did}`. The `did` is
   * taken from `linkDid` when provided, otherwise `actor.did`.
   */
  link?: boolean;
  /** DID to link to / fall back to for the display name (overrides `actor.did`). */
  linkDid?: string;
  /** Typography variant for the display name. */
  nameVariant?: TypographyProps["variant"];
  /** Extra `sx` applied to the display name. */
  nameSx?: SxProps<Theme>;
  /** `sx` for the outer row Stack. */
  sx?: SxProps<Theme>;
  /** Horizontal spacing between avatar and text block (Stack `spacing`, default 1.5). */
  spacing?: number;
  /** Stop click propagation on the profile link (useful inside clickable cards). */
  stopPropagation?: boolean;
  /** Trailing content rendered after the name on the same baseline row. */
  trailing?: ReactNode;
  /**
   * Content rendered below the name within the text column (e.g. a comment
   * body). Takes the place of the `@handle` line when provided alongside it.
   */
  belowName?: ReactNode;
  /** Vertical alignment of the avatar against the text column (default "center"). */
  alignItems?: "center" | "flex-start";
}

/**
 * Avatar + display name (+ optional `@handle`) cluster used across feed,
 * observation, profile, comment, and notification views. Routes the display
 * name and avatar-initial fallback through `getDisplayName`.
 */
export function UserCard({
  actor,
  avatarSize = 40,
  avatarSrc,
  showHandle = false,
  handleVariant = "body2",
  link = false,
  linkDid,
  nameVariant,
  nameSx,
  sx,
  spacing = 1.5,
  stopPropagation = false,
  trailing,
  belowName,
  alignItems = "center",
}: UserCardProps) {
  const did = linkDid ?? actor.did;
  const displayName = getDisplayName({
    ...(actor.displayName != null ? { displayName: actor.displayName } : {}),
    ...(actor.handle != null ? { handle: actor.handle } : {}),
    ...(did ? { did } : {}),
  });
  const handle = actor.handle ? `@${actor.handle}` : "";
  const src = avatarSrc ?? actor.avatar ?? undefined;

  const stop = stopPropagation ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  const avatar = src ? (
    <Avatar src={src} alt={displayName} sx={{ width: avatarSize, height: avatarSize }} />
  ) : (
    // Image-less fallback: a deterministic gradient (stable per user) with the
    // display-name initial, instead of MUI's flat grey default. Still a real
    // MUI Avatar so it stays a `.MuiAvatar-root` (consistent shape + asserted
    // by avatar tests).
    <Avatar
      alt={displayName}
      sx={{
        width: avatarSize,
        height: avatarSize,
        background: gradientFromString(did ?? actor.handle ?? displayName),
        color: "common.white",
        fontWeight: 600,
        fontSize: avatarSize * 0.45,
      }}
    >
      {displayName[0]}
    </Avatar>
  );

  const name = (
    <Typography
      {...(nameVariant ? { variant: nameVariant } : {})}
      sx={{ fontWeight: 600, color: "text.primary", ...nameSx }}
    >
      {displayName}
    </Typography>
  );

  const linkSx = {
    textDecoration: "none",
    color: "inherit",
  } as const;

  const avatarEl =
    link && did ? (
      <Box
        component={Link}
        to={`/profile/${encodeURIComponent(did)}`}
        {...(stop ? { onClick: stop } : {})}
        sx={{ display: "inline-flex", ...linkSx }}
      >
        {avatar}
      </Box>
    ) : (
      avatar
    );

  const nameEl =
    link && did ? (
      <Box
        component={Link}
        to={`/profile/${encodeURIComponent(did)}`}
        {...(stop ? { onClick: stop } : {})}
        sx={{ ...linkSx, "&:hover": { textDecoration: "underline" } }}
      >
        {name}
      </Box>
    ) : (
      name
    );

  return (
    <Stack direction="row" spacing={spacing} sx={{ alignItems, ...sx }}>
      {avatarEl}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          {nameEl}
          {trailing}
        </Stack>
        {showHandle && handle && (
          <Typography
            {...(handleVariant ? { variant: handleVariant } : {})}
            sx={{ color: "text.disabled" }}
          >
            {handle}
          </Typography>
        )}
        {belowName}
      </Box>
    </Stack>
  );
}
