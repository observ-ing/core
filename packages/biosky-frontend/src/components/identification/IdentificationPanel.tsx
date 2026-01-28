import { useState, FormEvent } from "react";
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
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import NatureIcon from "@mui/icons-material/Nature";
import CloseIcon from "@mui/icons-material/Close";
import { submitIdentification } from "../../services/api";
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
      setIdentifyingNewOrganism(false);
      onSuccess?.();
    } catch (error) {
      dispatch(addToast({ message: `Error: ${(error as Error).message}`, type: "error" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Paper sx={{ mt: 3, p: 2, bgcolor: "background.paper" }}>
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
          startIcon={<CheckIcon />}
          onClick={handleAgree}
          disabled={isSubmitting}
        >
          Agree
        </Button>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<EditIcon />}
          onClick={() => setShowSuggestForm(true)}
          disabled={isSubmitting}
        >
          Suggest Different ID
        </Button>
      </Stack>

      {showSuggestForm && (
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <TextField
            fullWidth
            label="Scientific Name"
            value={taxonName}
            onChange={(e) => setTaxonName(e.target.value)}
            placeholder="Enter species name..."
            margin="normal"
            size="small"
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
              onClick={() => {
                setShowSuggestForm(false);
                setIdentifyingNewOrganism(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isSubmitting}
            >
              Submit ID
            </Button>
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
