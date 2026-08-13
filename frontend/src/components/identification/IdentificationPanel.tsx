import { useState, useCallback, type FormEvent } from "react";
import { Box, Typography, Button, Stack, Divider, CircularProgress } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import type { TaxaResult } from "../../services/types";
import { useSubmitIdentification } from "../../lib/query/mutations";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { TaxonMatchChip } from "../common/TaxonMatchChip";
import { KingdomSelect } from "../common/KingdomSelect";
import { RankSelect } from "../common/RankSelect";
import { VisualIdCards } from "./VisualIdCards";
import { useVisualId } from "../../hooks/useVisualId";
import { TaxonLink } from "../common/TaxonLink";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { useToast } from "../../hooks/useToast";

interface IdentificationPanelProps {
  observation: {
    uri: string;
    cid: string;
    scientificName?: string | undefined;
    communityId?: string | undefined;
    kingdom?: string | undefined;
    rank?: string | undefined;
  };
  /** Full URL of the observation's primary image, for visual ID matching */
  imageUrl?: string | undefined;
  /** Observation latitude, passed to species-id for geo-prior context */
  latitude?: number | undefined;
  /** Observation longitude, passed to species-id for geo-prior context */
  longitude?: number | undefined;
}

export function IdentificationPanel({
  observation,
  imageUrl,
  latitude,
  longitude,
}: IdentificationPanelProps) {
  const toast = useToast();
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [taxonName, setTaxonName] = useState("");
  const [matchedTaxon, setMatchedTaxon] = useState<TaxaResult | null>(null);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");

  const currentId = observation.communityId || observation.scientificName || "Unknown";

  // The mutation invalidates the parent observation on success, so the new
  // identification shows up without a caller-supplied refetch callback.
  const submitId = useSubmitIdentification();

  const agreeFn = useCallback(
    () =>
      submitId.mutateAsync({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        scientificName: currentId,
      }),
    [submitId, observation.uri, observation.cid, currentId],
  );

  const { isSubmitting: isAgreeing, handleSubmit: handleAgree } = useFormSubmit(agreeFn, {
    successMessage: "Your agreement has been recorded!",
  });

  const effectiveKingdom = matchedTaxon?.kingdom ?? (kingdom || undefined);
  const effectiveRank = matchedTaxon?.rank ?? (rank || undefined);

  const suggestFn = useCallback(
    () =>
      submitId.mutateAsync({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        scientificName: taxonName.trim(),
        ...(effectiveKingdom ? { kingdom: effectiveKingdom } : {}),
        ...(effectiveRank ? { taxonRank: effectiveRank } : {}),
      }),
    [submitId, observation.uri, observation.cid, taxonName, effectiveKingdom, effectiveRank],
  );

  const { isSubmitting: isSuggesting, handleSubmit: doSuggest } = useFormSubmit(suggestFn, {
    successMessage: "Your identification has been submitted!",
    onSuccess: () => {
      setShowSuggestForm(false);
      setTaxonName("");
      setMatchedTaxon(null);
      setKingdom("");
      setRank("");
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
      toast.error("Please enter a taxon name");
      return;
    }

    if (!matchedTaxon && !kingdom) {
      toast.error("Please select a kingdom for the taxon name you entered");
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
              display: "block",
            }}
          >
            Community ID
          </Typography>
          <TaxonLink name={currentId} kingdom={observation.kingdom} rank={observation.rank} />
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
                    setKingdom("");
                    setRank("");
                  }
                }}
                onMatchChange={(match) => {
                  setMatchedTaxon(match);
                  if (match?.kingdom) {
                    setKingdom(match.kingdom);
                  }
                  if (match) {
                    setRank("");
                  }
                }}
                label="Taxon Name"
                size="small"
                margin="none"
                bottomContent={
                  taxonName.trim() ? (
                    <TaxonMatchChip matchedTaxon={matchedTaxon} />
                  ) : (
                    <VisualIdCards
                      suggestions={visualId.suggestions}
                      onSelectSpecies={(s) => {
                        setTaxonName(s.scientificName);
                        if (s.taxonMatch) {
                          setMatchedTaxon(s.taxonMatch);
                          setKingdom(s.taxonMatch.kingdom ?? "");
                          setRank("");
                        } else {
                          setMatchedTaxon(null);
                          if (s.kingdom) setKingdom(s.kingdom);
                        }
                      }}
                      onSelectAncestor={(ancestor) => {
                        setTaxonName(ancestor.name);
                        setMatchedTaxon(null);
                        if (ancestor.kingdom) setKingdom(ancestor.kingdom);
                        setRank(ancestor.rank);
                      }}
                    />
                  )
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

          {!!taxonName.trim() && !matchedTaxon && (
            <KingdomSelect
              idPrefix="suggest-kingdom"
              value={kingdom}
              onChange={setKingdom}
              size="small"
            />
          )}

          {!!taxonName.trim() && !matchedTaxon && (
            <RankSelect idPrefix="suggest-rank" value={rank} onChange={setRank} size="small" />
          )}

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
                setKingdom("");
                setRank("");
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
