import { IconButton, Stack, Tooltip, Typography, type SxProps, type Theme } from "@mui/material";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";

export interface LikeButtonProps {
  liked: boolean;
  count: number;
  /** Disables the button, e.g. while an optimistic update is pending. */
  disabled?: boolean;
  /** Shows a "Log in to like" tooltip and disables the button. */
  loggedOut?: boolean;
  onToggle: () => void;
  sx?: SxProps<Theme>;
}

export function LikeButton({ liked, count, disabled, loggedOut, onToggle, sx }: LikeButtonProps) {
  return (
    <Tooltip title={loggedOut ? "Log in to like" : ""}>
      <span>
        <Stack direction="row" sx={{ alignItems: "center", flexShrink: 0, ...sx }}>
          <IconButton
            size="small"
            onClick={onToggle}
            disabled={loggedOut || disabled}
            aria-label={liked ? "Unlike" : "Like"}
            sx={{ color: liked ? "error.main" : "text.disabled" }}
          >
            {liked ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
          </IconButton>
          {count > 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary", ml: -0.25 }}>
              {count}
            </Typography>
          )}
        </Stack>
      </span>
    </Tooltip>
  );
}
