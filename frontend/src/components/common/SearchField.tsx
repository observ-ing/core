import { InputAdornment, TextField } from "@mui/material";
import type { TextFieldProps } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

/**
 * Shared "search box" styling: rounded corners, a paper fill, and a soft
 * divider-colored border. Applied to standalone search inputs ({@link
 * SearchField}) and to autocomplete-backed search inputs (see
 * `renderAutocompleteInput`'s `search` option) so every search field across the
 * app reads the same. Plain object so callers can also nest it in an `sx`
 * array (e.g. `sx={[searchFieldSx, { mb: 1 }]}`).
 */
export const searchFieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 1.5,
    backgroundColor: "background.paper",
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "divider",
  },
};

/** Leading magnifier icon shown inside search inputs. */
export function SearchAdornment() {
  return (
    <InputAdornment position="start">
      <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
    </InputAdornment>
  );
}

export type SearchFieldProps = Omit<TextFieldProps, "label"> & {
  /** Accessible name for the input (rendered as `aria-label`, not a visible label). */
  label: string;
};

/**
 * A generic search text input: a label-less, rounded {@link TextField} with a
 * leading search icon, driven by its placeholder. Use for any standalone
 * search box (place search, list filters, …). For autocomplete-backed search,
 * pass `search` to `renderAutocompleteInput` instead so the look stays in sync.
 */
export function SearchField({ label, sx, slotProps, ...props }: SearchFieldProps) {
  // slotProps.input / .htmlInput can each be an object or a callback; only an
  // object can be safely merged with our defaults (a callback is passed through
  // as-is, replacing them).
  const inputSlot = typeof slotProps?.input === "object" ? slotProps.input : undefined;
  const htmlInputSlot = typeof slotProps?.htmlInput === "object" ? slotProps.htmlInput : undefined;
  return (
    <TextField
      fullWidth
      sx={[searchFieldSx, ...(Array.isArray(sx) ? sx : [sx])]}
      slotProps={{
        ...slotProps,
        input: { startAdornment: <SearchAdornment />, ...inputSlot },
        htmlInput: { "aria-label": label, ...htmlInputSlot },
      }}
      {...props}
    />
  );
}
