import { CircularProgress, TextField } from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material";
import { SearchAdornment, searchFieldSx } from "./SearchField";

interface RenderAutocompleteInputOptions {
  params: AutocompleteRenderInputParams;
  loading: boolean;
  label: string;
  placeholder: string;
  margin?: "normal" | "dense" | "none";
  /**
   * Render as a search box — rounded, with a leading search icon and no visible
   * label (the `label` becomes the input's `aria-label`) — to match the shared
   * {@link SearchField} look. Defaults to the standard floating-label field.
   */
  search?: boolean;
}

/**
 * Shared `renderInput` for MUI Autocomplete components: threads through MUI's
 * slot props while adding a loading spinner as an endAdornment. Pass `search`
 * for the rounded, icon-led search-box variant.
 */
export function renderAutocompleteInput({
  params,
  loading,
  label,
  placeholder,
  margin,
  search,
}: RenderAutocompleteInputOptions) {
  const { slotProps: paramsSlotProps, ...rest } = params;
  return (
    <TextField
      {...rest}
      fullWidth
      {...(search ? {} : { label })}
      placeholder={placeholder}
      {...(margin ? { margin } : {})}
      {...(search ? { sx: searchFieldSx } : {})}
      slotProps={{
        ...paramsSlotProps,
        input: {
          ...paramsSlotProps.input,
          ...(search
            ? {
                startAdornment: (
                  <>
                    <SearchAdornment />
                    {paramsSlotProps.input?.startAdornment}
                  </>
                ),
              }
            : {}),
          endAdornment: (
            <>
              {loading && <CircularProgress color="inherit" size={20} />}
              {paramsSlotProps.input?.endAdornment}
            </>
          ),
        },
        ...(search ? { htmlInput: { ...paramsSlotProps.htmlInput, "aria-label": label } } : {}),
      }}
    />
  );
}
