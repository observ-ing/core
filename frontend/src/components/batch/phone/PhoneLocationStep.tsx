// The map, full screen, for one observation or for several at once. Nothing
// changes until the button at the bottom is pressed. The phone layout's
// location step, and what "Expand map" opens on wider touch screens.
import { lazy, Suspense, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import PlaceIcon from "@mui/icons-material/Place";
import { CenteredSpinner } from "../../common/CenteredSpinner";
import type { BatchEdit, BatchObservation } from "../../../lib/batchUpload";
import { formatCoordinate, plural } from "../../../lib/utils";
import { shared } from "../BatchEditor";
import { PhoneStep } from "./PhoneStep";

const LocationPicker = lazy(() =>
  import("../../map/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

export interface PhoneLocationStepProps {
  /** The observations being located. Never empty. */
  observations: BatchObservation[];
  /** Sets the location; the step is done once it has been called. */
  onApply: (patch: BatchEdit) => void;
  onBack: () => void;
}

export function PhoneLocationStep({ observations, onApply, onBack }: PhoneLocationStepProps) {
  const [first] = observations;
  const single = observations.length === 1;
  const [point, setPoint] = useState(
    single && first && first.latitude !== null && first.longitude !== null
      ? { latitude: first.latitude, longitude: first.longitude }
      : null,
  );
  const sharedUncertainty = shared(observations.map((o) => o.uncertaintyMeters));
  // `null` until the slider is moved, so several observations keep the
  // uncertainties they have unless one is chosen for them.
  const [uncertainty, setUncertainty] = useState<number | null>(null);
  if (!first) return null;

  const located = observations.flatMap((o) =>
    o.latitude !== null && o.longitude !== null
      ? [{ latitude: o.latitude, longitude: o.longitude }]
      : [],
  );

  return (
    <PhoneStep
      title="Location"
      subtitle={single ? undefined : `For ${plural(observations.length, "observation")}`}
      backLabel="Back without changing"
      onBack={onBack}
      footer={
        <>
          {point ? (
            <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>
                {single && located.length > 0 ? "Location" : "New location"}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {formatCoordinate(point.latitude)}, {formatCoordinate(point.longitude)}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Search for a place or tap the map.
            </Typography>
          )}
          {!single && located.length > 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {located.length} of the {observations.length} selected observations already{" "}
              {located.length === 1 ? "has" : "have"} a location, shown in grey.
            </Typography>
          )}
          <Button
            variant="contained"
            startIcon={<PlaceIcon />}
            disabled={!point}
            onClick={() =>
              point &&
              onApply({
                ...point,
                ...(uncertainty !== null ? { uncertaintyMeters: uncertainty } : {}),
              })
            }
            sx={{ minHeight: 48 }}
          >
            {single ? "Set location" : `Set location for ${observations.length} observations`}
          </Button>
        </>
      }
    >
      <Suspense fallback={<CenteredSpinner size={24} sx={{ flex: 1, alignItems: "center" }} />}>
        <LocationPicker
          fill
          latitude={point?.latitude ?? null}
          longitude={point?.longitude ?? null}
          onChange={(latitude, longitude) => setPoint({ latitude, longitude })}
          uncertaintyMeters={uncertainty ?? sharedUncertainty ?? first.uncertaintyMeters}
          uncertaintyMixed={uncertainty === null && sharedUncertainty === undefined}
          onUncertaintyChange={setUncertainty}
          {...(single ? {} : { extraMarkers: located })}
          showHints={false}
        />
      </Suspense>
    </PhoneStep>
  );
}
