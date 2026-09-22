import { FormControl, InputLabel, MenuItem, Select, type SelectProps } from "@mui/material";
import { KINGDOMS } from "../../lib/kingdoms";

export interface KingdomSelectProps {
  value: string;
  onChange: (value: string) => void;
  size?: SelectProps["size"];
  /** Distinguishes this select's `labelId` when more than one instance mounts at once. */
  idPrefix?: string;
  /** Placeholder option's value/label. Defaults to the required-field "None" placeholder. */
  emptyOption?: { value: string; label: string };
  /** Italicize the empty option, as for a true placeholder rather than a selectable "all" option. Defaults to true. */
  emptyOptionItalic?: boolean;
  /** Whether the field itself is required. Defaults to true, matching the upload/ID-panel usage. */
  required?: boolean;
  margin?: "none" | "dense" | "normal";
}

/**
 * "Kingdom" dropdown shared by the upload form, visual-ID suggestion panel
 * (both required, with a "None" placeholder), and the explore feed filter
 * (optional, with an "All Kingdoms" placeholder).
 */
export function KingdomSelect({
  value,
  onChange,
  size,
  idPrefix = "kingdom",
  emptyOption = { value: "", label: "None" },
  emptyOptionItalic = true,
  required = true,
  margin = "normal",
}: KingdomSelectProps) {
  const labelId = `${idPrefix}-label`;
  return (
    <FormControl fullWidth margin={margin} required={required} size={size}>
      <InputLabel id={labelId}>Kingdom</InputLabel>
      <Select
        labelId={labelId}
        value={value}
        label="Kingdom"
        onChange={(e) => onChange(e.target.value)}
      >
        <MenuItem value={emptyOption.value}>
          {emptyOptionItalic ? <em>{emptyOption.label}</em> : emptyOption.label}
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
