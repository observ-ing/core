import { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Chip,
} from "@mui/material";
import type { Occurrence } from "../../services/types";
import type { QualityIssue } from "../../bindings/QualityIssue";
import { getImageUrl } from "../../services/api";
import { getObservationUrl, getDisplayName } from "../../lib/utils";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

interface ExploreTableProps {
  observations: Occurrence[];
}

// Short, human-readable labels for the quality-issue codes surfaced per row.
// (QualityIssue is the inverse of the filter's QualityCriterion — these are the
// problems an observation *has*, not the criteria it meets.)
const QUALITY_ISSUE_LABELS: Record<QualityIssue, string> = {
  MISSING_DATE: "No date",
  MISSING_LOCATION: "No location",
  MISSING_MEDIA: "No media",
  COORDINATES_IMPRECISE: "Imprecise coords",
  NO_CONSENSUS_ID: "No community ID",
};

// Column definitions, declared once so the header and the empty placeholder
// stay in sync with the body. `numeric` right-aligns and uses a tabular font.
const COLUMNS: ReadonlyArray<{ label: string; numeric?: boolean }> = [
  { label: "" }, // thumbnail
  { label: "Scientific name" },
  { label: "Common name" },
  { label: "Rank" },
  { label: "Kingdom" },
  { label: "Phylum" },
  { label: "Class" },
  { label: "Order" },
  { label: "Family" },
  { label: "Genus" },
  { label: "Observer" },
  { label: "Date" },
  { label: "Lat", numeric: true },
  { label: "Lng", numeric: true },
  { label: "± m", numeric: true },
  { label: "Qty" },
  { label: "IDs", numeric: true },
  { label: "Likes", numeric: true },
  { label: "Quality" },
  { label: "Posted" },
];

// Render the date portion of an ISO timestamp as YYYY-MM-DD (CSV-friendly,
// locale-stable). Falls back to an em dash when absent or unparseable.
function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function formatCoord(n?: number): string {
  return typeof n === "number" ? n.toFixed(5) : "—";
}

function text(v?: string | null): string {
  return v && v.length > 0 ? v : "—";
}

const numericSx = { fontVariantNumeric: "tabular-nums", textAlign: "right" } as const;

const ExploreTableRow = memo(function ExploreTableRow({
  observation: obs,
}: {
  observation: Occurrence;
}) {
  const navigate = useNavigate();
  const tax = obs.effectiveTaxonomy;
  const sciName = obs.communityId || tax?.scientificName || "Unknown";
  const italic = shouldItalicizeTaxonName(sciName, tax?.rank);
  const issues = obs.qualityIssues ?? [];

  const quantity =
    obs.organismQuantity != null
      ? [obs.organismQuantity, obs.organismQuantityType].filter(Boolean).join(" ")
      : "—";

  return (
    <TableRow
      hover
      onClick={() => navigate(getObservationUrl(obs.uri))}
      sx={{ cursor: "pointer", "& td": { whiteSpace: "nowrap" } }}
    >
      <TableCell sx={{ p: 0.5 }}>
        <Box
          component="img"
          src={obs.images[0] ? getImageUrl(obs.images[0].url) : undefined}
          alt=""
          loading="lazy"
          sx={{
            width: 36,
            height: 36,
            borderRadius: 0.5,
            objectFit: "cover",
            display: "block",
            bgcolor: "action.hover",
          }}
        />
      </TableCell>
      <TableCell sx={{ fontStyle: italic ? "italic" : "normal", fontWeight: 500 }}>
        {sciName}
      </TableCell>
      <TableCell>{text(tax?.vernacularName)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.rank)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.kingdom)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.phylum)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.class)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.order)}</TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{text(tax?.family)}</TableCell>
      <TableCell sx={{ color: "text.secondary", fontStyle: "italic" }}>
        {text(tax?.genus)}
      </TableCell>
      <TableCell>{getDisplayName(obs.observer)}</TableCell>
      <TableCell>{formatDate(obs.eventDate)}</TableCell>
      <TableCell sx={numericSx}>{formatCoord(obs.location?.latitude)}</TableCell>
      <TableCell sx={numericSx}>{formatCoord(obs.location?.longitude)}</TableCell>
      <TableCell sx={numericSx}>
        {typeof obs.location?.uncertaintyMeters === "number"
          ? Math.round(obs.location.uncertaintyMeters)
          : "—"}
      </TableCell>
      <TableCell>{quantity}</TableCell>
      <TableCell sx={numericSx}>{obs.identificationCount}</TableCell>
      <TableCell sx={numericSx}>{obs.likeCount ?? 0}</TableCell>
      <TableCell>
        {issues.length === 0 ? (
          <Chip size="small" color="success" variant="outlined" label="Verifiable" />
        ) : (
          <Tooltip title={issues.map((i) => QUALITY_ISSUE_LABELS[i]).join(", ")}>
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={`${issues.length} issue${issues.length === 1 ? "" : "s"}`}
            />
          </Tooltip>
        )}
      </TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{formatDate(obs.createdAt)}</TableCell>
    </TableRow>
  );
});

/**
 * Dense, CSV-style table view of the explore feed. Surfaces the full taxonomy
 * ladder, coordinates, quantities and quality state per observation in one
 * horizontally-scrollable grid. Rows link to the observation detail page.
 *
 * The table sits on a raised `background.paper` surface to lift it off the page
 * background, and the header row is sticky. Crucially this component owns NO
 * scroll container of its own: both axes scroll on the ancestor in FeedView, so
 * (a) the infinite-scroll trigger keeps firing and (b) `stickyHeader` can pin
 * the header to the top of that same scroller. An intermediate `overflow` box
 * here would capture the scroll and break both.
 */
export const ExploreTable = memo(function ExploreTable({ observations }: ExploreTableProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ width: "max-content", minWidth: "100%", my: 1.5, overflow: "visible" }}
    >
      <Table
        stickyHeader
        size="small"
        sx={{
          "& th, & td": { fontSize: "0.8rem", py: 0.75, px: 1 },
        }}
      >
        <TableHead>
          <TableRow>
            {COLUMNS.map((col, i) => (
              <TableCell
                key={col.label || `col-${i}`}
                sx={{
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  color: "text.secondary",
                  // Opaque header so rows don't bleed through while pinned. A
                  // touch lighter than the body via the elevation overlay.
                  bgcolor: "background.paper",
                  backgroundImage: (theme) =>
                    `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
                  ...(col.numeric ? { textAlign: "right" } : {}),
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {observations.map((obs) => (
            <ExploreTableRow key={obs.uri} observation={obs} />
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
});
