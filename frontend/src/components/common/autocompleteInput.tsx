import { CircularProgress, TextField } from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material";

interface RenderAutocompleteInputOptions {
  params: AutocompleteRenderInputParams;
  loading: boolean;
  label: string;
  placeholder: string;
  margin?: "normal" | "dense" | "none";
}

/**
 * Shared `renderInput` for MUI Autocomplete components: threads through MUI's
 * slot props while adding a loading spinner as an endAdornment.
 */
export function renderAutocompleteInput({
  params,
  loading,
  label,
  placeholder,
  margin,
}: RenderAutocompleteInputOptions) {
  const { slotProps: paramsSlotProps, ...rest } = params;
  return (
    <TextField
      {...rest}
      fullWidth
      label={label}
      placeholder={placeholder}
      {...(margin ? { margin } : {})}
      slotProps={{
        ...paramsSlotProps,
        input: {
          ...paramsSlotProps.input,
          endAdornment: (
            <>
              {loading && <CircularProgress color="inherit" size={20} />}
              {paramsSlotProps.input?.endAdornment}
            </>
          ),
        },
      }}
    />
  );
}
