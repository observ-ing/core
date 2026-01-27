import { useState, FormEvent } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Paper,
  TextField,
  Button,
  IconButton,
  Menu,
  MenuItem,
} from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { submitComment } from "../../services/api";
import { useAppSelector, useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";
import type { Comment } from "../../services/types";
import { formatRelativeTime, getPdslsUrl } from "../../lib/utils";

interface CommentSectionProps {
  occurrenceUri: string;
  occurrenceCid: string;
  comments: Comment[];
  onCommentAdded?: () => void;
}

export function CommentSection({
  occurrenceUri,
  occurrenceCid,
  comments,
  onCommentAdded,
}: CommentSectionProps) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<{ [key: string]: HTMLElement | null }>({});

  const handleMenuOpen = (commentUri: string, event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl((prev) => ({ ...prev, [commentUri]: event.currentTarget }));
  };

  const handleMenuClose = (commentUri: string) => {
    setMenuAnchorEl((prev) => ({ ...prev, [commentUri]: null }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!body.trim()) {
      dispatch(addToast({ message: "Please enter a comment", type: "error" }));
      return;
    }

    setIsSubmitting(true);
    try {
      await submitComment({
        occurrenceUri,
        occurrenceCid,
        body: body.trim(),
      });
      dispatch(addToast({ message: "Comment posted!", type: "success" }));
      setBody("");
      setShowForm(false);
      onCommentAdded?.();
    } catch (error) {
      dispatch(addToast({ message: `Error: ${(error as Error).message}`, type: "error" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Paper sx={{ p: 2, bgcolor: "background.paper" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <ChatBubbleOutlineIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">
          Discussion {comments.length > 0 && `(${comments.length})`}
        </Typography>
      </Stack>

      {comments.length === 0 && !showForm && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No comments yet. Start a discussion!
        </Typography>
      )}

      {comments.length > 0 && (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {comments.map((comment) => (
            <Box key={comment.uri} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <RouterLink to={`/profile/${encodeURIComponent(comment.commenter?.did || comment.did)}`}>
                  <Avatar
                    src={comment.commenter?.avatar}
                    sx={{ width: 32, height: 32 }}
                  >
                    {(comment.commenter?.displayName || comment.commenter?.handle || "?")[0]}
                  </Avatar>
                </RouterLink>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <RouterLink
                      to={`/profile/${encodeURIComponent(comment.commenter?.did || comment.did)}`}
                      style={{ textDecoration: "none" }}
                    >
                      <Typography variant="body2" fontWeight="medium" color="text.primary">
                        {comment.commenter?.displayName || comment.commenter?.handle || "Unknown"}
                      </Typography>
                    </RouterLink>
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(comment.created_at)}
                    </Typography>
                    <Box sx={{ ml: "auto" }}>
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(comment.uri, e)}
                        aria-label="More options"
                        sx={{ color: "text.disabled", p: 0.5 }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                      <Menu
                        anchorEl={menuAnchorEl[comment.uri]}
                        open={Boolean(menuAnchorEl[comment.uri])}
                        onClose={() => handleMenuClose(comment.uri)}
                        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                        transformOrigin={{ vertical: "top", horizontal: "right" }}
                      >
                        <MenuItem
                          component="a"
                          href={getPdslsUrl(comment.uri)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => handleMenuClose(comment.uri)}
                        >
                          View on AT Protocol
                        </MenuItem>
                      </Menu>
                    </Box>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                    {comment.body}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {user ? (
        showForm ? (
          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Add a comment"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              rows={2}
              size="small"
              placeholder="Share your thoughts, ask questions..."
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
              <Button
                color="inherit"
                onClick={() => {
                  setShowForm(false);
                  setBody("");
                }}
                size="small"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={isSubmitting}
                size="small"
              >
                Post
              </Button>
            </Stack>
          </Box>
        ) : (
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<ChatBubbleOutlineIcon />}
            onClick={() => setShowForm(true)}
            size="small"
          >
            Add Comment
          </Button>
        )
      ) : (
        <Typography variant="body2" color="text.secondary">
          Log in to add a comment
        </Typography>
      )}
    </Paper>
  );
}
