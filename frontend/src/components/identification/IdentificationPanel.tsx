import { useState, type FormEvent } from "react";
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
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import NatureIcon from "@mui/icons-material/Nature";
import { submitIdentification } from "../../services/api";
import { TaxaAutocomplete } from "../common/TaxaAutocomplete";
import { useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";

type ConfidenceLevel = "low" | "medium" | "high";

interface IdentificationPanelProps {
  observation: {
    uri: string;
    cid: string;
    scientificName?: string | undefined;
    communityId?: string | undefined;
  };
  subjectIndex?: number | undefined;
  /** Number of existing subjects in this observation (used to calculate next available index) */
  existingSubjectCount?: number | undefined;
  onSuccess?: (() => void) | undefined;
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

  // Calculate the next available subject index for new organisms
  const nextSubjectIndex = existingSubjectCount;

  const currentId = observation.communityId || observation.scientificName || "Unknown";

  const handleAgree = async () => {
    setIsSubmitting(true);
    try {
      await submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        subjectIndex,
        scientificName: currentId,
        isAgreement: true,
        confidence: "high",
      });
      dispatch(
        addToast({
          message: "Your agreement has been recorded!",
          type: "success",
        }),
      );
      onSuccess?.();
    } catch (error) {
      dispatch(
        addToast({
          message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
        }),
      );
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
      const trimmedComment = comment.trim();
      await submitIdentification({
        occurrenceUri: observation.uri,
        occurrenceCid: observation.cid,
        subjectIndex: targetSubjectIndex,
        scientificName: taxonName.trim(),
        ...(trimmedComment ? { comment: trimmedComment } : {}),
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
      setIdentifyingNewOrganism(false);
      onSuccess?.();
    } catch (error) {
      dispatch(
        addToast({
          message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toConfidence = (v: string): ConfidenceLevel =>
    v === "low" || v === "medium" || v === "high" ? v : "medium";

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Community ID
          </Typography>
          <Typography sx={{ fontStyle: "italic", color: "primary.main" }}>{currentId}</Typography>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
          onClick={() => {
            setIdentifyingNewOrganism(false);
            setShowSuggestForm(true);
          }}
          disabled={isSubmitting || showSuggestForm}
        >
          Suggest Different ID
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<NatureIcon />}
          onClick={() => {
            setIdentifyingNewOrganism(true);
            setShowSuggestForm(true);
          }}
          disabled={isSubmitting || showSuggestForm}
        >
          Add Another Organism
        </Button>
      </Stack>

      {showSuggestForm && (
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <TaxaAutocomplete value={taxonName} onChange={setTaxonName} size="small" />

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
              onChange={(e) => setConfidence(toConfidence(e.target.value))}
            >
              <MenuItem value="high">High - I'm sure</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="low">Low - Best guess</MenuItem>
            </Select>
          </FormControl>

          {identifyingNewOrganism && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                mt: 2,
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
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="p"
                    sx={{ mt: 0.5 }}
                  >
                    This creates a new organism in this observation. Use this when multiple species
                    are visible (e.g., a butterfly AND the flower it's on).
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          )}

          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setShowSuggestForm(false);
                setTaxonName("");
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
