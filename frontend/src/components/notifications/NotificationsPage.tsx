import { useEffect, useRef, useCallback, useState } from "react";
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
import { fetchNotifications, markNotificationRead, getImageUrl } from "../../services/api";
import type { Notification } from "../../services/types";
import { formatTimeAgo, getObservationUrl } from "../../lib/utils";

export function NotificationsPage() {
  usePageTitle("Notifications");
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async (loadCursor?: string) => {
    setIsLoading(true);
    try {
      const data = await fetchNotifications(loadCursor);
      if (loadCursor) {
        setNotifications((prev) => [...prev, ...data.notifications]);
      } else {
        setNotifications(data.notifications);
      }
      setCursor(data.cursor ?? undefined);
      setHasMore(data.notifications.length === 20);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      loadNotifications(cursor);
    }
  }, [isLoading, hasMore, cursor, loadNotifications]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handleMarkAllRead = async () => {
    await markNotificationRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleClick = async (notification: Notification) => {
    if (!notification.read) {
      await markNotificationRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      );
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
    <Box ref={contentRef} sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Typography variant="h5" fontWeight={700}>
            Notifications
          </Typography>
          {hasUnread && (
            <Button size="small" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </Box>

        {!isLoading && notifications.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
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
                      <Typography component="span" variant="body2" fontWeight={600}>
                        @{n.actor?.handle || n.actorDid}
                      </Typography>{" "}
                      <Typography component="span" variant="body2">
                        {getKindText(n.kind)}
                      </Typography>
                    </>
                  }
                  secondary={formatTimeAgo(new Date(n.createdAt))}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Container>
    </Box>
  );
}
