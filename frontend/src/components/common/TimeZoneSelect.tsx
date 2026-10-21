// The UTC offset an observation's wall-clock date is in, beside the date it
// applies to. Shared by the upload modal and the batch uploader.
import { MenuItem, TextField, type TextFieldProps } from "@mui/material";
import { UTC_OFFSETS, browserUtcOffset } from "../../lib/observationInput";

/** Select values standing for "the browser's zone" and "the selection disagrees". */
const ZONE_LOCAL = "local";
const ZONE_MIXED = "mixed";

/** "-07:00" as -420, for sorting offsets west to east. */
function offsetMinutes(offset: string): number {
  const [hours = "0", minutes = "0"] = offset.slice(1).split(":");
  return (offset.startsWith("-") ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

export interface TimeZoneSelectProps {
  /** The chosen offset, e.g. "-07:00", or `null` for the browser's own zone. */
  value: string | null;
  /** The `datetime-local` value the zone applies to; picks the local offset across DST. */
  date: string;
  onChange: (utcOffset: string | null) => void;
  /** Several observations that disagree: shows "Mixed values" until one is chosen. */
  mixed?: boolean;
  /** Offsets to list even if no zone uses them today, such as ones read from photos. */
  extraOffsets?: string[];
  margin?: TextFieldProps["margin"];
}

export function TimeZoneSelect({
  value,
  date,
  onChange,
  mixed = false,
  extraOffsets = [],
  margin,
}: TimeZoneSelectProps) {
  return (
    <TextField
      select
      fullWidth
      label="Time zone"
      value={mixed ? ZONE_MIXED : (value ?? ZONE_LOCAL)}
      // Changing the zone keeps the clock time and moves the moment it names.
      onChange={(e) => onChange(e.target.value === ZONE_LOCAL ? null : e.target.value)}
      margin={margin}
      slotProps={{ inputLabel: { shrink: true } }}
    >
      {mixed && (
        <MenuItem value={ZONE_MIXED} disabled>
          Mixed values
        </MenuItem>
      )}
      <MenuItem value={ZONE_LOCAL}>Local time (UTC{browserUtcOffset(date)})</MenuItem>
      {/* A photo can carry an offset that no zone uses today. */}
      {[...new Set([...UTC_OFFSETS, ...extraOffsets, ...(value ? [value] : [])])]
        .sort((a, b) => offsetMinutes(a) - offsetMinutes(b))
        .map((offset) => (
          <MenuItem key={offset} value={offset}>
            UTC{offset}
          </MenuItem>
        ))}
    </TextField>
  );
}
