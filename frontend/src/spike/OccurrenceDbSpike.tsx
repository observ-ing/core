// SPIKE demo route — see ./tanstackDb.ts for the rationale. Renders a taxon's
// occurrences from a per-viewer TanStack DB collection that persists to
// IndexedDB, so the list survives an offline reload, and likes apply
// optimistically. Mounted at /spike/:kingdom/:name in App.tsx.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Chip,
  Stack,
  CircularProgress,
  Alert,
  IconButton,
} from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { useLiveQuery } from "@tanstack/react-db";
import { useAppSelector } from "../store";
import {
  restoreQueryClient,
  clearSpikeCache,
  getOccurrenceCollection,
  type OccurrenceCollection,
} from "./tanstackDb";

/** Subscribe to navigator.onLine so the banner reflects live connectivity. */
function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
  );
}

function OccurrenceList({ collection }: { collection: OccurrenceCollection }) {
  const { data: occurrences, status } = useLiveQuery((q) => q.from({ occ: collection }));

  const toggleLike = (uri: string) => {
    collection
      .update(uri, (draft) => {
        const nowLiked = !draft.viewerHasLiked;
        draft.viewerHasLiked = nowLiked;
        draft.likeCount = (draft.likeCount ?? 0) + (nowLiked ? 1 : -1);
      })
      .isPersisted.promise.catch(() => {
        // Offline / server error: collection auto-rolls-back the optimistic
        // change. Nothing to do — the UI reverts on its own.
      });
  };

  if (status === "loading" && occurrences.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (occurrences.length === 0) {
    return (
      <Typography sx={{ p: 3, color: "text.secondary" }}>
        No occurrences cached for this taxon yet. Load it once while online.
      </Typography>
    );
  }

  return (
    <Stack divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}>
      {occurrences.map((occ) => (
        <Box
          key={occ.uri}
          sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {occ.observer.displayName || occ.observer.handle}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {occ.effectiveTaxonomy?.scientificName ?? occ.uri.split("/").pop()}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexShrink: 0 }}>
            <Typography variant="caption">{occ.likeCount ?? 0}</Typography>
            <IconButton size="small" onClick={() => toggleLike(occ.uri)} color="error">
              {occ.viewerHasLiked ? (
                <FavoriteIcon fontSize="small" />
              ) : (
                <FavoriteBorderIcon fontSize="small" />
              )}
            </IconButton>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export function OccurrenceDbSpike() {
  const { kingdom, name } = useParams<{ kingdom: string; name: string }>();
  const viewerDid = useAppSelector((state) => state.auth.user?.did) ?? "anon";
  const online = useOnlineStatus();

  // Gate rendering on cache restore so an offline first paint reads IndexedDB
  // rather than firing a doomed network request.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    restoreQueryClient().then(() => setRestored(true));
  }, []);

  if (!kingdom || !name) {
    return <Alert severity="error">Usage: /spike/&lt;kingdom&gt;/&lt;name&gt;</Alert>;
  }

  if (!restored) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress size={22} />
        <Typography variant="caption" sx={{ display: "block", mt: 1 }}>
          Restoring cache…
        </Typography>
      </Box>
    );
  }

  const collection = getOccurrenceCollection(viewerDid, kingdom, name);

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Typography variant="h6">TanStack DB spike</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
        {kingdom} / {name}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2, flexWrap: "wrap" }}>
        <Chip
          size="small"
          label={online ? "online" : "offline"}
          color={online ? "success" : "warning"}
        />
        <Chip size="small" variant="outlined" label={`viewer: ${viewerDid.slice(0, 16)}…`} />
        <Button size="small" onClick={() => clearSpikeCache().then(() => window.location.reload())}>
          Clear cache & reload
        </Button>
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>
        Load this once online, then toggle DevTools → Network → Offline and reload. The list renders
        from IndexedDB, scoped to this viewer DID. Likes apply optimistically and roll back if the
        network call fails.
      </Alert>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <OccurrenceList collection={collection} />
      </Box>
    </Container>
  );
}
