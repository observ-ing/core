import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  CircularProgress,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemButton,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { getImageUrl } from "../../services/api";
import type { Notification } from "../../services/types";
import { getObservationUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { useNotifications } from "../../lib/query/hooks";
import { useMarkNotificationRead } from "../../lib/query/mutations";

export function NotificationsPage() {
  usePageTitle("Notifications");
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useNotifications();
  const notifications = data?.pages.flatMap((page) => page.notifications) ?? [];
  const markRead = useMarkNotificationRead();

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el || isFetchingNextPage || !hasNextPage) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void fetchNextPage();
    }
  }, [fetchNextPage, isFetchingNextPage, hasNextPage]);

  const handleMarkAllRead = () => {
    markRead.mutate(undefined);
  };

  const handleClick = (notification: Notification) => {
    if (!notification.read) {
      markRead.mutate(notification.id);
    }
    navigate(getObservationUrl(notification.subjectUri));
  };

  const getKindText = (kind: string) => {
    switch (kind) {
      case "comment":
        return "commented on your observation";
      case "identification":
        return "identified your observation";
      case "like":
        return "liked your observation";
      default:
        return "interacted with your observation";
    }
  };

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <Box
      ref={contentRef}
      onScroll={handleScroll}
      sx={{ flex: 1, overflow: "auto", height: "100%" }}
    >
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: 700,
            }}
          >
            Notifications
          </Typography>
          {hasUnread && (
            <Button size="small" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </Box>

        {!isLoading && notifications.length === 0 && (
          <Typography
            sx={{
              color: "text.secondary",
              textAlign: "center",
              mt: 4,
            }}
          >
            No notifications yet
          </Typography>
        )}

        <List disablePadding>
          {notifications.map((n) => (
            <ListItem
              key={n.id}
              disablePadding
              sx={{
                bgcolor: n.read ? "transparent" : "action.hover",
                borderRadius: 2,
                mb: 0.5,
              }}
            >
              <ListItemButton onClick={() => handleClick(n)} sx={{ borderRadius: 2, py: 1.5 }}>
                <ListItemAvatar>
                  <Avatar
                    {...(n.actor?.avatar ? { src: getImageUrl(n.actor.avatar) } : {})}
                    sx={{ width: 40, height: 40 }}
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <>
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                        }}
                      >
                        @{n.actor?.handle || n.actorDid}
                      </Typography>{" "}
                      <Typography component="span" variant="body2">
                        {getKindText(n.kind)}
                      </Typography>
                    </>
                  }
                  secondary={<RelativeTime date={new Date(n.createdAt)} />}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        {(isLoading || isFetchingNextPage) && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Container>
    </Box>
  );
}
