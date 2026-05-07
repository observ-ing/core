import { useState, useCallback, type FormEvent } from "react";
import { Box, Typography, Button, Stack, Divider, CircularProgress } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { submitIdentification } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { VisualIdCards } from "./VisualIdCards";
import { useVisualId } from "../../hooks/useVisualId";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";
import { useFormSubmit } from "../../hooks/useFormSubmit";

interface IdentificationPanelProps {
  observation: {
    uri: string;
    cid: string;
    scientificName?: string | undefined;
    communityId?: string | undefined;
  };
  /** Full URL of the observation's primary image, for visual ID matching */
  imageUrl?: string | undefined;
  /** Observation latitude, passed to species-id for geo-prior context */
  latitude?: number | undefined;
  /** Observation longitude, passed to species-id for geo-prior context */
  longitude?: number | undefined;
  onSuccess?: (() => void) | undefined;
}

export function IdentificationPanel({
  observation,
  imageUrl,
  latitude,
  longitude,
  onSuccess,
}: IdentificationPanelProps) {
  const dispatch = useAppDispatch();
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [taxonName, setTaxonName] = useState("");
  const [matchedTaxon, setMatchedTaxon] = useState<TaxaResult | null>(null);

  const currentId = observation.communityId || observation.scientificName || "Unknown";

  const agreeFn = useCallback(
    () =>
      submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        scientificName: currentId,
      }),
    [observation.uri, observation.cid, currentId],
  );

  const { isSubmitting: isAgreeing, handleSubmit: handleAgree } = useFormSubmit(agreeFn, {
    successMessage: "Your agreement has been recorded!",
    onSuccess: () => onSuccess?.(),
  });

  const suggestFn = useCallback(
    () =>
      submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        scientificName: taxonName.trim(),
        ...(matchedTaxon?.kingdom ? { kingdom: matchedTaxon.kingdom } : {}),
        ...(matchedTaxon?.rank ? { taxonRank: matchedTaxon.rank } : {}),
      }),
    [observation.uri, observation.cid, taxonName, matchedTaxon],
  );

  const { isSubmitting: isSuggesting, handleSubmit: doSuggest } = useFormSubmit(suggestFn, {
    successMessage: "Your identification has been submitted!",
    onSuccess: () => {
      setShowSuggestForm(false);
      setTaxonName("");
      setMatchedTaxon(null);
      onSuccess?.();
    },
  });

  const isSubmitting = isAgreeing || isSuggesting;

  const visualId = useVisualId({
    imageUrl: imageUrl ?? "",
    latitude,
    longitude,
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!taxonName.trim()) {
      dispatch(addToast({ message: "Please enter a species name", type: "error" }));
      return;
    }

    doSuggest();
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Box>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
            }}
          >
            Community ID
          </Typography>
          <Typography
            sx={{
              fontStyle: shouldItalicizeTaxonName(currentId) ? "italic" : "normal",
              color: "primary.main",
            }}
          >
            {currentId}
          </Typography>
        </Box>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          flexWrap: "wrap",
        }}
      >
        <Button
          variant="outlined"
          color="primary"
          size="small"
          startIcon={<CheckIcon />}
          onClick={handleAgree}
          disabled={isSubmitting || showSuggestForm}
        >
          Agree
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<EditIcon />}
          onClick={() => setShowSuggestForm(true)}
          disabled={isSubmitting || showSuggestForm}
        >
          Suggest Different ID
        </Button>
      </Stack>
      {showSuggestForm && (
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "flex-start",
            }}
          >
            <Box sx={{ flex: 1 }}>
              <TaxaAutocomplete
                value={taxonName}
                onChange={(name) => {
                  setTaxonName(name);
                  if (name === "") {
                    setMatchedTaxon(null);
                  }
                }}
                onMatchChange={setMatchedTaxon}
                size="small"
                margin="none"
                bottomContent={
                  <VisualIdCards
                    suggestions={visualId.suggestions}
                    onSelectSpecies={(s) => {
                      setTaxonName(s.scientificName);
                      setMatchedTaxon(s.taxonMatch ?? null);
                    }}
                    onSelectAncestor={(ancestor) => {
                      setTaxonName(ancestor.name);
                      setMatchedTaxon({
                        id: `${ancestor.kingdom ?? ""}/${ancestor.name}`,
                        scientificName: ancestor.name,
                        rank: ancestor.rank,
                        ...(ancestor.kingdom ? { kingdom: ancestor.kingdom } : {}),
                        source: "visual-id-rollup",
                      });
                    }}
                  />
                }
              />
            </Box>
            {imageUrl && !visualId.hasLoaded && (
              <Button
                variant="outlined"
                size="small"
                onClick={visualId.handleFetch}
                disabled={isSubmitting || visualId.isLoading}
                startIcon={
                  visualId.isLoading ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <AutoFixHighIcon fontSize="small" />
                  )
                }
                sx={{ whiteSpace: "nowrap", height: 40 }}
              >
                Visual ID
              </Button>
            )}
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "flex-end",
              mt: 2,
            }}
          >
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setShowSuggestForm(false);
                setTaxonName("");
                setMatchedTaxon(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              size="small"
              disabled={isSubmitting}
            >
              Submit ID
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
