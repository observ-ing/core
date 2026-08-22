import { FormControl, InputLabel, MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { LICENSE_OPTIONS } from "../../lib/licenses";

export interface LicenseSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Distinguishes this select's `labelId` when more than one instance mounts at once. */
  idPrefix?: string;
  size?: "small" | "medium";
  disabled?: boolean;
  margin?: "none" | "dense" | "normal";
  /** Optional leading sentinel option, e.g. "No default (use CC BY)". */
  noneOption?: { value: string; label: string };
}

/**
 * Creative Commons license dropdown shown wherever a license is picked or
 * defaulted (upload form, settings preferences).
 */
export function LicenseSelect({
  value,
  onChange,
  label = "License",
  idPrefix = "license",
  size,
  disabled,
  margin = "normal",
  noneOption,
}: LicenseSelectProps) {
  const labelId = `${idPrefix}-label`;
  return (
    <FormControl fullWidth margin={margin} size={size} disabled={disabled}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        value={value}
        label={label}
        onChange={(e: SelectChangeEvent<string>) => onChange(e.target.value)}
      >
        {noneOption && <MenuItem value={noneOption.value}>{noneOption.label}</MenuItem>}
        {LICENSE_OPTIONS.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
