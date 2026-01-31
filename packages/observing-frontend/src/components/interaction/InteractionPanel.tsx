import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  Chip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Avatar,
  Divider,
  Alert,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import LinkIcon from "@mui/icons-material/Link";
import { useAppSelector } from "../../store";
import {
  submitInteraction,
  fetchInteractionsForOccurrence,
  searchTaxa,
  type InteractionResponse,
} from "../../services/api";
import type { Subject, TaxaResult } from "../../services/types";
import { formatDate } from "../../lib/utils";

// Known interaction types with human-readable labels
const INTERACTION_TYPES = [
  { value: "predation", label: "Predation", description: "One organism eating another" },
  { value: "pollination", label: "Pollination", description: "Transfer of pollen between plants" },
  { value: "parasitism", label: "Parasitism", description: "One organism living on/in another" },
  { value: "herbivory", label: "Herbivory", description: "Animal eating plant material" },
  { value: "symbiosis", label: "Symbiosis", description: "Close physical association" },
  { value: "mutualism", label: "Mutualism", description: "Both organisms benefit" },
  { value: "competition", label: "Competition", description: "Competing for resources" },
  { value: "shelter", label: "Shelter", description: "One provides shelter to another" },
  { value: "transportation", label: "Transportation", description: "One transports another" },
  { value: "oviposition", label: "Oviposition", description: "Laying eggs on/in another organism" },
  { value: "seed_dispersal", label: "Seed Dispersal", description: "Dispersing seeds of another" },
];

const DIRECTION_OPTIONS = [
  { value: "AtoB", label: "A affects B" },
  { value: "BtoA", label: "B affects A" },
  { value: "bidirectional", label: "Bidirectional" },
];

const CONFIDENCE_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface InteractionPanelProps {
  observation: {
    uri: string;
    cid: string;
    scientificName?: string;
    communityId?: string;
  };
  subjects: Subject[];
  onSuccess?: () => void;
}

export function InteractionPanel({
  observation,
  subjects,
  onSuccess,
}: InteractionPanelProps) {
  const user = useAppSelector((state) => state.auth.user);
  const [interactions, setInteractions] = useState<InteractionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [subjectAIndex, setSubjectAIndex] = useState(0);
  const [subjectBType, setSubjectBType] = useState<"occurrence" | "taxon">("taxon");
  const [subjectBTaxon, setSubjectBTaxon] = useState("");
  const [subjectBKingdom, setSubjectBKingdom] = useState("");
  const [taxonSuggestions, setTaxonSuggestions] = useState<TaxaResult[]>([]);
  const [interactionType, setInteractionType] = useState("predation");
  const [direction, setDirection] = useState<"AtoB" | "BtoA" | "bidirectional">("AtoB");
  const [confidence, setConfidence] = useState<"low" | "medium" | "high">("medium");
  const [comment, setComment] = useState("");

  useEffect(() => {
    loadInteractions();
  }, [observation.uri]);

  const loadInteractions = async () => {
    setLoading(true);
    try {
      const result = await fetchInteractionsForOccurrence(observation.uri);
      setInteractions(result.interactions);
    } catch {
      // Ignore errors, just show empty list
    }
    setLoading(false);
  };

  const handleTaxonSearch = async (query: string) => {
    setSubjectBTaxon(query);
    if (query.length >= 2) {
      const results = await searchTaxa(query);
      setTaxonSuggestions(results.slice(0, 5));
    } else {
      setTaxonSuggestions([]);
    }
  };

  const handleSelectTaxon = (taxon: TaxaResult) => {
    setSubjectBTaxon(taxon.scientificName);
    setSubjectBKingdom(taxon.rank === "kingdom" ? taxon.scientificName : "");
    setTaxonSuggestions([]);
  };

  const handleSubmit = async () => {
    if (!subjectBTaxon.trim()) {
      setError("Please specify the other organism");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const selectedSubject = subjects.find((s) => s.index === subjectAIndex) || subjects[0];

      await submitInteraction({
        subjectA: {
          occurrenceUri: observation.uri,
          occurrenceCid: observation.cid,
          subjectIndex: subjectAIndex,
          taxonName: selectedSubject?.communityId || observation.communityId || observation.scientificName,
        },
        subjectB: {
          taxonName: subjectBTaxon.trim(),
          kingdom: subjectBKingdom || undefined,
        },
        interactionType,
        direction,
        confidence,
        comment: comment.trim() || undefined,
      });

      // Reset form
      setShowForm(false);
      setSubjectBTaxon("");
      setSubjectBKingdom("");
      setComment("");
      setInteractionType("predation");
      setDirection("AtoB");
      setConfidence("medium");

      // Reload interactions
      await loadInteractions();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit interaction");
    }

    setSubmitting(false);
  };

  const getInteractionLabel = (type: string) => {
    return INTERACTION_TYPES.find((t) => t.value === type)?.label || type;
  };

  const getDirectionLabel = (dir: string, subjectA: string, subjectB: string) => {
    switch (dir) {
      case "AtoB":
        return `${subjectA} \u2192 ${subjectB}`;
      case "BtoA":
        return `${subjectB} \u2192 ${subjectA}`;
      case "bidirectional":
        return `${subjectA} \u2194 ${subjectB}`;
      default:
        return "";
    }
  };

  if (loading) {
    return (
      <Box sx={{ py: 2, textAlign: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Paper sx={{ mt: 3, p: 2, bgcolor: "background.paper" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          <LinkIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: "middle" }} />
          Species Interactions
        </Typography>
        {user && !showForm && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setShowForm(true)}
          >
            Add
          </Button>
        )}
      </Stack>

      {/* Existing interactions */}
      {interactions.length > 0 ? (
        <Stack spacing={1.5} sx={{ mb: showForm ? 2 : 0 }}>
          {interactions.map((interaction) => (
            <Box
              key={interaction.uri}
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: "action.hover",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip
                  label={getInteractionLabel(interaction.interaction_type)}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
                <Typography variant="body2">
                  {getDirectionLabel(
                    interaction.direction,
                    interaction.subject_a_taxon_name || "Subject A",
                    interaction.subject_b_taxon_name || "Subject B"
                  )}
                </Typography>
                {interaction.confidence && (
                  <Chip
                    label={interaction.confidence}
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: "capitalize" }}
                  />
                )}
              </Stack>
              {interaction.comment && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {interaction.comment}
                </Typography>
              )}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                {interaction.creator && (
                  <>
                    <Avatar
                      src={interaction.creator.avatar}
                      alt={interaction.creator.displayName || interaction.creator.handle}
                      sx={{ width: 20, height: 20 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {interaction.creator.displayName || interaction.creator.handle}
                    </Typography>
                  </>
                )}
                <Typography variant="caption" color="text.secondary">
                  {formatDate(interaction.created_at)}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        !showForm && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No interactions documented yet.
          </Typography>
        )
      )}

      {/* Add interaction form */}
      {showForm && user && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 2 }} />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Stack spacing={2}>
            {/* Subject A - select from occurrence subjects */}
            {subjects.length > 1 && (
              <FormControl size="small" fullWidth>
                <InputLabel>Subject A (this observation)</InputLabel>
                <Select
                  value={subjectAIndex}
                  label="Subject A (this observation)"
                  onChange={(e) => setSubjectAIndex(Number(e.target.value))}
                >
                  {subjects.map((subject) => (
                    <MenuItem key={subject.index} value={subject.index}>
                      Subject {subject.index + 1}
                      {subject.communityId && ` - ${subject.communityId}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* Subject B - taxon name input */}
            <Box>
              <TextField
                size="small"
                fullWidth
                label="Other organism (Subject B)"
                placeholder="Start typing to search..."
                value={subjectBTaxon}
                onChange={(e) => handleTaxonSearch(e.target.value)}
              />
              {taxonSuggestions.length > 0 && (
                <Paper
                  sx={{
                    mt: 0.5,
                    maxHeight: 200,
                    overflow: "auto",
                    position: "absolute",
                    zIndex: 10,
                    width: "calc(100% - 32px)",
                  }}
                >
                  {taxonSuggestions.map((taxon) => (
                    <Box
                      key={taxon.id}
                      sx={{
                        p: 1,
                        cursor: "pointer",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      onClick={() => handleSelectTaxon(taxon)}
                    >
                      <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                        {taxon.scientificName}
                      </Typography>
                      {taxon.commonName && (
                        <Typography variant="caption" color="text.secondary">
                          {taxon.commonName}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Paper>
              )}
            </Box>

            {/* Interaction type */}
            <FormControl size="small" fullWidth>
              <InputLabel>Interaction Type</InputLabel>
              <Select
                value={interactionType}
                label="Interaction Type"
                onChange={(e) => setInteractionType(e.target.value)}
              >
                {INTERACTION_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    <Stack>
                      <Typography>{type.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {type.description}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Direction */}
            <FormControl size="small" fullWidth>
              <InputLabel>Direction</InputLabel>
              <Select
                value={direction}
                label="Direction"
                onChange={(e) => setDirection(e.target.value as typeof direction)}
              >
                {DIRECTION_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Confidence */}
            <FormControl size="small" fullWidth>
              <InputLabel>Confidence</InputLabel>
              <Select
                value={confidence}
                label="Confidence"
                onChange={(e) => setConfidence(e.target.value as typeof confidence)}
              >
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Comment */}
            <TextField
              size="small"
              fullWidth
              multiline
              rows={2}
              label="Comment (optional)"
              placeholder="Describe the interaction..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            {/* Actions */}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                size="small"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={handleSubmit}
                disabled={submitting || !subjectBTaxon.trim()}
              >
                {submitting ? <CircularProgress size={20} /> : "Add Interaction"}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}

      {!user && !showForm && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
          Log in to add interactions
        </Typography>
      )}
    </Paper>
  );
}
