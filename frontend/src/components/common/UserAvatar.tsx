import { Avatar } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { gradientFromString } from "../../lib/gradientFromString";

export interface UserAvatarProps {
  /** did/handle seed for the deterministic gradient shown when there's no image. */
  did?: string | undefined;
  handle?: string | null | undefined;
  /** Resolved display name: `alt` text, and (image-less) the fallback initial. */
  displayName: string;
  /** Avatar image URL. Falls back to the gradient-initial avatar when omitted. */
  src?: string | undefined;
  /** Avatar diameter in pixels (default 40). */
  size?: number;
  sx?: SxProps<Theme>;
}

/**
 * Avatar + image-less fallback shared by `UserCard` and any other place a
 * user's own avatar is rendered outside that row layout (e.g. `TopBar`'s
 * account menu). The fallback is a deterministic gradient (stable per user)
 * with the display-name initial, instead of MUI's flat grey default.
 */
export function UserAvatar({ did, handle, displayName, src, size = 40, sx }: UserAvatarProps) {
  if (src) {
    return <Avatar src={src} alt={displayName} sx={{ width: size, height: size, ...sx }} />;
  }

  return (
    <Avatar
      alt={displayName}
      sx={{
        width: size,
        height: size,
        background: gradientFromString(did ?? handle ?? displayName),
        color: "common.white",
        fontWeight: 600,
        fontSize: size * 0.45,
        ...sx,
      }}
    >
      {displayName[0]}
    </Avatar>
  );
}
