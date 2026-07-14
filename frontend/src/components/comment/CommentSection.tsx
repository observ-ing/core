import { useState, useCallback, type FormEvent } from "react";
import { Box, Typography, Stack, TextField, Button, Chip } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import { countChipSx } from "../common/chipSx";
import { accentListItemSx } from "../common/layoutSx";
import { useAppSelector } from "../../store";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { useToast } from "../../hooks/useToast";
import { useSubmitComment } from "../../lib/query/mutations";
import type { Comment } from "../../services/types";
import { RelativeTime } from "../common/RelativeTime";
import { UserCard } from "../common/UserCard";
import { Section, SectionHeader } from "../common/Section";
import { RecordOverflowMenu } from "../common/RecordOverflowMenu";

interface CommentSectionProps {
  observationUri: string;
  observationCid: string;
  comments: Comment[];
}

export function CommentSection({ observationUri, observationCid, comments }: CommentSectionProps) {
  const toast = useToast();
  const user = useAppSelector((state) => state.auth.user);
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");

  // The mutation invalidates the parent observation on success, so the new
  // comment shows up without the caller wiring a refetch callback.
  const submitComment = useSubmitComment();
  const submitFn = useCallback(
    () =>
      submitComment.mutateAsync({
        occurrenceUri: observationUri,
        occurrenceCid: observationCid,
        body: body.trim(),
      }),
    [submitComment, observationUri, observationCid, body],
  );

  const { isSubmitting, handleSubmit: doSubmit } = useFormSubmit(submitFn, {
    successMessage: "Comment posted!",
    onSuccess: () => {
      setBody("");
      setShowForm(false);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!body.trim()) {
      toast.error("Please enter a comment");
      return;
    }

    doSubmit();
  };

  return (
    <Section>
      <SectionHeader
        icon={<ChatBubbleOutlineIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Discussion"
        sx={{ mb: 2 }}
        trailing={
          <>
            {comments.length > 0 && <Chip label={comments.length} size="small" sx={countChipSx} />}
            {user && !showForm && (
              <Button
                size="small"
                startIcon={<ChatBubbleOutlineIcon />}
                onClick={() => setShowForm(true)}
              >
                Add
              </Button>
            )}
          </>
        }
      />
      {comments.length === 0 && !showForm && (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: 2,
          }}
        >
          No comments yet. Start a discussion!
        </Typography>
      )}
      {comments.length > 0 && (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {comments.map((comment) => (
            <Box
              key={comment.uri}
              sx={{
                ...accentListItemSx,
                borderColor: "divider",
                transition: "all 0.2s ease",
                "&:hover": {
                  bgcolor: "action.hover",
                  borderColor: "primary.main",
                },
              }}
            >
              <UserCard
                actor={comment.commenter ?? {}}
                linkDid={comment.commenter?.did || comment.did}
                avatarSize={32}
                alignItems="flex-start"
                link
                nameVariant="body2"
                nameSx={{ fontWeight: "medium" }}
                trailing={
                  <>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                      }}
                    >
                      <RelativeTime date={new Date(comment.created_at)} withAgo />
                    </Typography>
                    <Box sx={{ ml: "auto" }}>
                      <RecordOverflowMenu atUri={comment.uri} sx={{ p: 0.5 }} />
                    </Box>
                  </>
                }
                belowName={
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                    {comment.body}
                  </Typography>
                }
              />
            </Box>
          ))}
        </Stack>
      )}
      {user && showForm && (
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
          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "flex-end",
              mt: 1,
            }}
          >
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
      )}
      {!user && (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            textAlign: "center",
          }}
        >
          Log in to add a comment
        </Typography>
      )}
    </Section>
  );
}
