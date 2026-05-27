import { useState, useCallback, type FormEvent } from "react";
import {
  Avatar,
  Box,
  Typography,
  Button,
  Chip,
  Stack,
  Divider,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import { submitIdentification } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { VisualIdCards } from "./VisualIdCards";
import { useVisualId } from "../../hooks/useVisualId";
import { TaxonLink } from "../common/TaxonLink";
import { useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";
import { useFormSubmit } from "../../hooks/useFormSubmit";
import { KINGDOMS } from "../../lib/kingdoms";
import { TAXON_RANKS } from "../../lib/taxonRanks";

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
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");

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

  const effectiveKingdom = matchedTaxon?.kingdom ?? (kingdom || undefined);
  const effectiveRank = matchedTaxon?.rank ?? (rank || undefined);

  const suggestFn = useCallback(
    () =>
      submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        scientificName: taxonName.trim(),
        ...(effectiveKingdom ? { kingdom: effectiveKingdom } : {}),
        ...(effectiveRank ? { taxonRank: effectiveRank } : {}),
      }),
    [observation.uri, observation.cid, taxonName, effectiveKingdom, effectiveRank],
  );

  const { isSubmitting: isSuggesting, handleSubmit: doSuggest } = useFormSubmit(suggestFn, {
    successMessage: "Your identification has been submitted!",
    onSuccess: () => {
      setShowSuggestForm(false);
      setTaxonName("");
      setMatchedTaxon(null);
      setKingdom("");
      setRank("");
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
      dispatch(addToast({ message: "Please enter a taxon name", type: "error" }));
      return;
    }

    if (!matchedTaxon && !kingdom) {
      dispatch(
        addToast({
          message: "Please select a kingdom for the taxon name you entered",
          type: "error",
        }),
      );
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
                    matchedTaxon ? (
                      <Chip
                        {...(matchedTaxon.photoUrl
                          ? { avatar: <Avatar src={matchedTaxon.photoUrl} alt="" /> }
                          : { icon: <CheckCircleOutlinedIcon /> })}
                        label={["Existing taxon", matchedTaxon.commonName, matchedTaxon.rank]
                          .filter((p): p is string => Boolean(p))
                          .join(" · ")}
                        color="success"
                        size="small"
                        variant="outlined"
                        sx={{ mt: 0.5 }}
                      />
                    ) : (
                      <Chip
                        icon={<AddCircleOutlinedIcon />}
                        label="New taxon"
                        color="info"
                        size="small"
                        variant="outlined"
                        sx={{ mt: 0.5 }}
                      />
                    )
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
            <FormControl fullWidth margin="normal" required size="small">
              <InputLabel id="suggest-kingdom-label">Kingdom</InputLabel>
              <Select
                labelId="suggest-kingdom-label"
                value={kingdom}
                label="Kingdom"
                onChange={(e) => setKingdom(e.target.value)}
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
          )}

          {!!taxonName.trim() && !matchedTaxon && (
            <FormControl fullWidth margin="normal" size="small">
              <InputLabel id="suggest-rank-label">Rank (optional)</InputLabel>
              <Select
                labelId="suggest-rank-label"
                value={rank}
                label="Rank (optional)"
                onChange={(e) => setRank(e.target.value)}
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
