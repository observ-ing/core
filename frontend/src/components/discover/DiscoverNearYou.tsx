import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box, Card, CardContent, CardMedia, Skeleton, Typography } from "@mui/material";
import { useDiscoverHere } from "../../lib/query/hooks";
import { ConservationStatus } from "../common/ConservationStatus";

// Used when geolocation is denied/unavailable so the rail always renders
// something. Boulder, CO is iNaturalist-dense.
const FALLBACK = { lat: 40.015, lon: -105.2705 };
const GEO_TIMEOUT_MS = 6000;

/** Resolve the viewer's location: browser geolocation, else a sensible default. */
function useCoords() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let settled = false;
    const settle = (c: { lat: number; lon: number }, fallback: boolean) => {
      if (settled) return;
      settled = true;
      setCoords(c);
      setUsingFallback(fallback);
    };

    if (!navigator.geolocation) {
      settle(FALLBACK, true);
      return;
    }
    const timer = setTimeout(() => settle(FALLBACK, true), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        settle({ lat: pos.coords.latitude, lon: pos.coords.longitude }, false);
      },
      () => {
        clearTimeout(timer);
        settle(FALLBACK, true);
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: 1000 * 60 * 60 },
    );
    return () => clearTimeout(timer);
  }, []);

  return { coords, usingFallback };
}

/**
 * Homepage "what could you find near here" rail. Backed by the species range
 * index (`/api/discover/here`), so it's rich from global range data with no
 * dependence on nearby user activity.
 */
export function DiscoverNearYou() {
  const { coords, usingFallback } = useCoords();
  const { data, isLoading } = useDiscoverHere(coords, 12);

  // No range data here (ocean/poles) → don't show an empty rail.
  if (data && !data.areaHasData) return null;

  const items = data?.items ?? [];
  const showSkeletons = !data && (isLoading || !coords);

  return (
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Find near you{usingFallback ? " · Boulder, CO" : ""}
        </Typography>
        {data && (
          <Typography variant="caption" color="text.secondary">
            {data.totalInRange.toLocaleString()} species recorded here
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 1,
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {showSkeletons &&
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} sx={{ minWidth: 150, maxWidth: 150, flexShrink: 0 }}>
              <Skeleton variant="rectangular" height={150} />
              <CardContent sx={{ py: 1 }}>
                <Skeleton width="85%" />
                <Skeleton width="55%" />
              </CardContent>
            </Card>
          ))}

        {items.map((sp) => {
          const to = sp.kingdom
            ? `/taxon/${encodeURIComponent(sp.kingdom)}/${encodeURIComponent(sp.scientificName)}`
            : "/explore";
          return (
            <Card
              key={sp.scientificName}
              component={RouterLink}
              to={to}
              sx={{
                minWidth: 150,
                maxWidth: 150,
                flexShrink: 0,
                textDecoration: "none",
                position: "relative",
                "&:hover": { boxShadow: 4 },
              }}
            >
              {sp.photoUrl ? (
                <CardMedia
                  component="img"
                  image={sp.photoUrl}
                  alt={sp.commonName ?? sp.scientificName}
                  sx={{ height: 150, objectFit: "cover" }}
                />
              ) : (
                <Box
                  sx={{
                    height: 150,
                    bgcolor: "action.hover",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    No photo
                  </Typography>
                </Box>
              )}

              {sp.conservationStatus && (
                <Box sx={{ position: "absolute", top: 6, right: 6 }}>
                  <ConservationStatus status={sp.conservationStatus} size="sm" />
                </Box>
              )}

              <CardContent sx={{ py: 1, px: 1, "&:last-child": { pb: 1 } }}>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontStyle: "italic", fontWeight: 600, lineHeight: 1.2 }}
                >
                  {sp.scientificName}
                </Typography>
                {sp.commonName && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: "block" }}
                  >
                    {sp.commonName}
                  </Typography>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
