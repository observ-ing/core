import { useState, FormEvent, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Stack,
  Paper,
  Divider,
  Collapse,
  Link,
  Autocomplete,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import NatureIcon from "@mui/icons-material/Nature";
import CloseIcon from "@mui/icons-material/Close";
import { submitIdentification, searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ConservationStatus } from "../common/ConservationStatus";
import { useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";

type ConfidenceLevel = "low" | "medium" | "high";

interface IdentificationPanelProps {
  observation: {
    uri: string;
    cid: string;
    scientificName?: string;
    communityId?: string;
  };
  subjectIndex?: number;
  /** Number of existing subjects in this observation (used to calculate next available index) */
  existingSubjectCount?: number;
  onSuccess?: () => void;
}

export function IdentificationPanel({
  observation,
  subjectIndex = 0,
  existingSubjectCount = 1,
  onSuccess,
}: IdentificationPanelProps) {
  const dispatch = useAppDispatch();
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [taxonName, setTaxonName] = useState("");
  const [comment, setComment] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [identifyingNewOrganism, setIdentifyingNewOrganism] = useState(false);
  const [suggestions, setSuggestions] = useState<TaxaResult[]>([]);

  const handleSpeciesSearch = useCallback(async (value: string) => {
    if (value.length >= 2) {
      const results = await searchTaxa(value);
      setSuggestions(results.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, []);

  // Calculate the next available subject index for new organisms
  const nextSubjectIndex = existingSubjectCount;

  const currentId =
    observation.communityId || observation.scientificName || "Unknown";

  const handleAgree = async () => {
    setIsSubmitting(true);
    try {
      await submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        subjectIndex,
        taxonName: currentId,
        isAgreement: true,
        confidence: "high",
      });
      dispatch(addToast({ message: "Your agreement has been recorded!", type: "success" }));
      onSuccess?.();
    } catch (error) {
      dispatch(addToast({ message: `Error: ${(error as Error).message}`, type: "error" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!taxonName.trim()) {
      dispatch(addToast({ message: "Please enter a species name", type: "error" }));
      return;
    }

    // Use next available index if identifying a new organism
    const targetSubjectIndex = identifyingNewOrganism ? nextSubjectIndex : subjectIndex;

    setIsSubmitting(true);
    try {
      await submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        subjectIndex: targetSubjectIndex,
        taxonName: taxonName.trim(),
        comment: comment.trim() || undefined,
        confidence,
        isAgreement: false,
      });
      const message = identifyingNewOrganism
        ? "New organism added and identification submitted!"
        : "Your identification has been submitted!";
      dispatch(addToast({ message, type: "success" }));
      setShowSuggestForm(false);
      setTaxonName("");
      setComment("");
      setSuggestions([]);
      setIdentifyingNewOrganism(false);
      onSuccess?.();
    } catch (error) {
      dispatch(addToast({ message: `Error: ${(error as Error).message}`, type: "error" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Community ID
          </Typography>
          <Typography sx={{ fontStyle: "italic", color: "primary.main" }}>
            {currentId}
          </Typography>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          color="primary"
          size="small"
          startIcon={<CheckIcon />}
          onClick={handleAgree}
          disabled={isSubmitting}
        >
          Agree
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<EditIcon />}
          onClick={() => setShowSuggestForm(true)}
          disabled={isSubmitting}
        >
          Suggest Different ID
        </Button>
      </Stack>

      {showSuggestForm && (
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <Autocomplete
            freeSolo
            options={suggestions}
            getOptionLabel={(option) =>
              typeof option === "string" ? option : option.scientificName
            }
            inputValue={taxonName}
            onInputChange={(_, value) => {
              setTaxonName(value);
              handleSpeciesSearch(value);
            }}
            onChange={(_, value) => {
              if (value) {
                const name = typeof value === "string" ? value : value.scientificName;
                setTaxonName(name);
                setSuggestions([]);
              }
            }}
            filterOptions={(x) => x}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                fullWidth
                label="Species Name"
                placeholder="Search by common or scientific name..."
                margin="normal"
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box
                  component="li"
                  key={key}
                  {...otherProps}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    p: 1.5,
                  }}
                >
                  {option.photoUrl && (
                    <Box
                      component="img"
                      src={option.photoUrl}
                      alt=""
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1,
                        objectFit: "cover",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography fontWeight={600}>{option.scientificName}</Typography>
                      {option.isSynonym && (
                        <Typography
                          variant="caption"
                          sx={{
                            bgcolor: "action.selected",
                            px: 0.75,
                            py: 0.25,
                            borderRadius: 0.5,
                            fontSize: "0.65rem",
                          }}
                        >
                          synonym
                        </Typography>
                      )}
                      {option.conservationStatus && (
                        <ConservationStatus status={option.conservationStatus} size="sm" />
                      )}
                    </Stack>
                    {option.isSynonym && option.acceptedName && (
                      <Typography variant="caption" color="text.disabled">
                        → {option.acceptedName}
                      </Typography>
                    )}
                    {option.commonName && !option.isSynonym && (
                      <Typography variant="caption" color="text.disabled">
                        {option.commonName}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
          />

          <TextField
            fullWidth
            label="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            rows={2}
            margin="normal"
            size="small"
          />

          <FormControl fullWidth margin="normal" size="small">
            <InputLabel>Confidence</InputLabel>
            <Select
              value={confidence}
              label="Confidence"
              onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)}
            >
              <MenuItem value="high">High - I'm sure</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="low">Low - Best guess</MenuItem>
            </Select>
          </FormControl>

          {/* Different organism toggle */}
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Collapse in={!identifyingNewOrganism}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setIdentifyingNewOrganism(true)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  color: "text.secondary",
                  textDecoration: "none",
                  "&:hover": { color: "primary.main" },
                }}
              >
                <NatureIcon fontSize="small" />
                Identify a different organism in this photo
              </Link>
            </Collapse>
            <Collapse in={identifyingNewOrganism}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  bgcolor: "action.hover",
                  borderColor: "primary.main",
                }}
              >
                <Stack direction="row" alignItems="flex-start" spacing={1}>
                  <NatureIcon color="primary" sx={{ mt: 0.5 }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight="medium" color="primary.main">
                      Adding organism #{nextSubjectIndex + 1}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                      This creates a new organism in this observation. Use this when multiple
                      species are visible (e.g., a butterfly AND the flower it's on).
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, fontStyle: "italic" }}>
                      For a different opinion on the same organism, cancel this and just submit your ID.
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setIdentifyingNewOrganism(false)}
                    sx={{ minWidth: "auto", p: 0.5 }}
                  >
                    <CloseIcon fontSize="small" />
                  </Button>
                </Stack>
              </Paper>
            </Collapse>
          </Box>

          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setShowSuggestForm(false);
                setTaxonName("");
                setSuggestions([]);
                setIdentifyingNewOrganism(false);
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
