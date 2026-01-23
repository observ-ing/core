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
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import {
  IdentificationService,
  type ConfidenceLevel,
} from "../../lib/identification";
import type { AtpAgent } from "@atproto/api";

interface IdentificationPanelProps {
  occurrence: {
    uri: string;
    cid: string;
    scientificName?: string;
    communityId?: string;
  };
  subjectIndex?: number;
  agent: AtpAgent;
  onSuccess?: () => void;
}

export function IdentificationPanel({
  occurrence,
  subjectIndex = 0,
  agent,
  onSuccess,
}: IdentificationPanelProps) {
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [taxonName, setTaxonName] = useState("");
  const [comment, setComment] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const service = new IdentificationService(agent);
  const currentId =
    occurrence.communityId || occurrence.scientificName || "Unknown";

  const handleAgree = async () => {
    setIsSubmitting(true);
    try {
      await service.agree(occurrence.uri, occurrence.cid, currentId, subjectIndex);
      alert("Your agreement has been recorded!");
      onSuccess?.();
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!taxonName.trim()) {
      alert("Please enter a species name");
      return;
    }

    setIsSubmitting(true);
    try {
      await service.suggestId(
        occurrence.uri,
        occurrence.cid,
        taxonName.trim(),
        {
          subjectIndex,
          comment: comment.trim() || undefined,
          confidence,
        }
      );
      alert("Your identification has been submitted!");
      setShowSuggestForm(false);
      setTaxonName("");
      setComment("");
      onSuccess?.();
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
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

          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              color="inherit"
              onClick={() => setShowSuggestForm(false)}
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
