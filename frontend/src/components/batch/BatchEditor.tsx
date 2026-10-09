// Side panel of the batch uploader: edits identification, date, location, and
// remarks on every selected observation at once. A field shows a value only
// when the whole selection agrees on it.
import { lazy, Suspense, useState } from "react";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { TaxonMatchChip } from "../common/TaxonMatchChip";
import { KingdomSelect } from "../common/KingdomSelect";
import { RankSelect } from "../common/RankSelect";
import { CenteredSpinner } from "../common/CenteredSpinner";
import { coverImageSx } from "../common/layoutSx";
import { VisualId } from "../identification/VisualId";
import type { BatchEdit, BatchObservation } from "../../lib/batchUpload";
import { MAX_REMARK_LENGTH } from "../../lib/remarks";
import { formatCoordinate } from "../../lib/utils";

const LocationPicker = lazy(() =>
  import("../map/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

export interface BatchEditorProps {
  selected: BatchObservation[];
  onEdit: (patch: BatchEdit) => void;
}

const MIXED = "Mixed values";

/** The value every item shares, or `undefined` when they differ. */
function shared<T>(values: T[]): T | undefined {
  const [first, ...rest] = values;
  return rest.every((v) => v === first) ? first : undefined;
}

const plural = (count: number) => `${count} observation${count === 1 ? "" : "s"}`;

function EditorFields({ selected, onEdit }: BatchEditorProps) {
  const [first] = selected;
  // The point clicked on the map for a multi-selection, not yet applied.
  const [proposed, setProposed] = useState<{ latitude: number; longitude: number } | null>(null);
  // Bumped to remount the map with no pin once a proposal is applied or dropped.
  const [mapKey, setMapKey] = useState(0);
  if (!first) return null;

  const single = selected.length === 1;
  const taxonName = shared(selected.map((o) => o.taxon.name));
  const unmatched = !!taxonName?.trim() && selected.every((o) => !o.taxon.match);
  const kingdom = shared(selected.map((o) => o.taxon.kingdom)) ?? "";
  const rank = shared(selected.map((o) => o.taxon.rank)) ?? "";
  const date = shared(selected.map((o) => o.date));
  const remarks = shared(selected.map((o) => o.remarks));
  const located = selected.flatMap((o) =>
    o.latitude !== null && o.longitude !== null
      ? [{ latitude: o.latitude, longitude: o.longitude }]
      : [],
  );
  const sameLocation =
    located.length === selected.length &&
    shared(located.map((p) => `${p.latitude},${p.longitude}`)) !== undefined;
  const [cover] = first.photos;

  const clearProposal = () => {
    setProposed(null);
    setMapKey((key) => key + 1);
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Editing {plural(selected.length)}
        </Typography>
        {!single && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Changes apply to every selected observation.
          </Typography>
        )}
      </Box>

      <Box>
        <TaxaAutocomplete
          value={taxonName ?? ""}
          onChange={(name) => {
            // The autocomplete also reports its own resets; only act on a change,
            // or a mixed selection would be cleared just by being shown.
            if (name === (taxonName ?? "")) return;
            onEdit({
              taxon: name === "" ? { name, match: null, kingdom: "", rank: "" } : { name },
            });
          }}
          onMatchChange={(match) =>
            onEdit({
              taxon: {
                match,
                ...(match?.kingdom ? { kingdom: match.kingdom } : {}),
                ...(match ? { rank: "" } : {}),
              },
            })
          }
          label="Identification"
          placeholder={taxonName === undefined ? MIXED : "e.g. Eschscholzia californica"}
          margin="none"
          bottomContent={
            taxonName?.trim() ? (
              <TaxonMatchChip matchedTaxon={shared(selected.map((o) => o.taxon.match)) ?? null} />
            ) : single && cover ? (
              <Box sx={{ mt: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                  <Box sx={{ width: 40, height: 40, borderRadius: 1, overflow: "hidden" }}>
                    <Box component="img" src={cover.previewUrl} alt="" sx={coverImageSx} />
                  </Box>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Cover photo, used for visual ID
                  </Typography>
                </Stack>
                <VisualId
                  imageUrl={cover.previewUrl}
                  latitude={first.latitude ?? undefined}
                  longitude={first.longitude ?? undefined}
                  onSelect={(s) =>
                    onEdit({
                      taxon: s.taxonMatch
                        ? {
                            name: s.scientificName,
                            match: s.taxonMatch,
                            kingdom: s.taxonMatch.kingdom ?? "",
                            rank: "",
                          }
                        : { name: s.scientificName, match: null, kingdom: s.kingdom ?? "" },
                    })
                  }
                  onSelectAncestor={(ancestor) =>
                    onEdit({
                      taxon: {
                        name: ancestor.name,
                        match: null,
                        kingdom: ancestor.kingdom ?? "",
                        rank: ancestor.rank,
                      },
                    })
                  }
                />
              </Box>
            ) : undefined
          }
        />
        {unmatched && (
          <>
            <KingdomSelect
              idPrefix="batch-kingdom"
              value={kingdom}
              onChange={(value) => onEdit({ taxon: { kingdom: value } })}
            />
            {!kingdom && (
              <Typography variant="caption" sx={{ color: "error.main", display: "block" }}>
                Select a kingdom for a name that isn't in the taxonomy.{" "}
                {single ? "This observation counts" : "These observations count"} as incomplete
                until you do.
              </Typography>
            )}
            <RankSelect
              idPrefix="batch-rank"
              value={rank}
              onChange={(value) => onEdit({ taxon: { rank: value } })}
            />
          </>
        )}
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, "& > *": { flex: "1 1 200px" } }}>
        <TextField
          label={single && first.endDate ? "Start date" : "Observation date"}
          type="datetime-local"
          value={date ?? ""}
          onChange={(e) => onEdit({ date: e.target.value })}
          error={date === ""}
          helperText={
            date === undefined
              ? "Selected observations have different dates."
              : date === ""
                ? "Required."
                : single && first.utcOffset
                  ? `From the photo, in its own time zone (UTC${first.utcOffset}).`
                  : undefined
          }
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {single && (
          <TextField
            label="End date (optional)"
            type="date"
            value={first.endDate}
            onChange={(e) => onEdit({ endDate: e.target.value })}
            error={first.endDate !== "" && first.endDate < first.date.slice(0, 10)}
            helperText={
              first.endDate !== "" && first.endDate < first.date.slice(0, 10)
                ? "End date can't be before the start date."
                : undefined
            }
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: first.date.slice(0, 10) },
            }}
          />
        )}
      </Box>

      <Box>
        <Suspense
          fallback={<CenteredSpinner size={24} sx={{ height: 260, alignItems: "center" }} />}
        >
          {single ? (
            <LocationPicker
              latitude={first.latitude}
              longitude={first.longitude}
              onChange={(latitude, longitude) => onEdit({ latitude, longitude })}
              uncertaintyMeters={first.uncertaintyMeters}
              onUncertaintyChange={(uncertaintyMeters) => onEdit({ uncertaintyMeters })}
              showHints={false}
            />
          ) : (
            <LocationPicker
              key={mapKey}
              latitude={proposed?.latitude ?? null}
              longitude={proposed?.longitude ?? null}
              onChange={(latitude, longitude) => setProposed({ latitude, longitude })}
              extraMarkers={located}
              showHints={false}
            />
          )}
        </Suspense>
        {!single && !proposed && (
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
            {located.length === 0
              ? `None of the ${selected.length} selected observations has a location.`
              : sameLocation
                ? `The ${selected.length} selected observations share one location, shown in grey.`
                : `The ${selected.length} selected observations are at different locations, ` +
                  "shown in grey."}{" "}
            Click the map to choose one location for all of them.
          </Typography>
        )}
        {!single && proposed && (
          <Paper variant="outlined" sx={{ mt: 1, p: 1.5, borderColor: "primary.main" }}>
            <Stack spacing={1}>
              <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>New location</Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {formatCoordinate(proposed.latitude)}, {formatCoordinate(proposed.longitude)}
                </Typography>
              </Stack>
              <Button
                variant="contained"
                onClick={() => {
                  onEdit(proposed);
                  clearProposal();
                }}
              >
                Set location for {plural(selected.length)}
              </Button>
              <Button variant="outlined" color="inherit" onClick={clearProposal}>
                Cancel
              </Button>
            </Stack>
          </Paper>
        )}
      </Box>

      <TextField
        fullWidth
        multiline
        minRows={3}
        label="Remarks"
        value={remarks ?? ""}
        onChange={(e) => onEdit({ remarks: e.target.value })}
        placeholder={
          remarks === undefined
            ? MIXED
            : "e.g. worn wings, feeding on milkweed along the creek trail"
        }
        // The count only earns its line once the limit is in sight.
        helperText={
          remarks !== undefined && remarks.length >= MAX_REMARK_LENGTH * 0.9
            ? `${remarks.length} / ${MAX_REMARK_LENGTH}`
            : undefined
        }
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: { maxLength: MAX_REMARK_LENGTH },
        }}
      />
    </Stack>
  );
}

export function BatchEditor({ selected, onEdit }: BatchEditorProps) {
  return (
    <Paper
      component="aside"
      variant="outlined"
      aria-label="Edit selected observations"
      sx={{ p: 2.5, borderRadius: 2 }}
    >
      {selected.length === 0 ? (
        <Stack spacing={1.25}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Nothing selected
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Click an observation to edit it. Shift-click or use the checkboxes to select several and
            edit them together.
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Drag one card onto another to combine their photos into a single observation. Drag a
            photo out of a card to split it off.
          </Typography>
        </Stack>
      ) : (
        // Keyed on the selection so the map and any pending location start fresh.
        <EditorFields
          key={selected.map((o) => o.id).join(",")}
          selected={selected}
          onEdit={onEdit}
        />
      )}
    </Paper>
  );
}
