import { FormControl, InputLabel, MenuItem, Select, type SelectProps } from "@mui/material";
import { KINGDOMS } from "../../lib/kingdoms";

export interface KingdomSelectProps {
  value: string;
  onChange: (value: string) => void;
  size?: SelectProps["size"];
  /** Distinguishes this select's `labelId` when more than one instance mounts at once. */
  idPrefix?: string;
}

/**
 * Required "Kingdom" dropdown shown alongside a free-typed taxon name that
 * didn't match a known taxon (upload form, visual-ID suggestion panel).
 */
export function KingdomSelect({ value, onChange, size, idPrefix = "kingdom" }: KingdomSelectProps) {
  const labelId = `${idPrefix}-label`;
  return (
    <FormControl fullWidth margin="normal" required size={size}>
      <InputLabel id={labelId}>Kingdom</InputLabel>
      <Select
        labelId={labelId}
        value={value}
        label="Kingdom"
        onChange={(e) => onChange(e.target.value)}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {KINGDOMS.map((k) => (
          <MenuItem key={k.value} value={k.value}>
            {k.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
