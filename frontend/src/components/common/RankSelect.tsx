import { FormControl, InputLabel, MenuItem, Select, type SelectProps } from "@mui/material";
import { TAXON_RANKS } from "../../lib/taxonRanks";

export interface RankSelectProps {
  value: string;
  onChange: (value: string) => void;
  size?: SelectProps["size"];
  /** Distinguishes this select's `labelId` when more than one instance mounts at once. */
  idPrefix?: string;
}

/**
 * Optional "Rank" dropdown shown alongside a free-typed taxon name that
 * didn't match a known taxon (upload form, visual-ID suggestion panel).
 */
export function RankSelect({ value, onChange, size, idPrefix = "rank" }: RankSelectProps) {
  const labelId = `${idPrefix}-label`;
  return (
    <FormControl fullWidth margin="normal" size={size}>
      <InputLabel id={labelId}>Rank (optional)</InputLabel>
      <Select
        labelId={labelId}
        value={value}
        label="Rank (optional)"
        onChange={(e) => onChange(e.target.value)}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {TAXON_RANKS.map((r) => (
          <MenuItem key={r} value={r}>
            {r}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
