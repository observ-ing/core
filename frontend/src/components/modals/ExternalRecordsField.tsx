import { useState, type KeyboardEvent } from "react";
import { Box, Button, Chip, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import type { ExternalRecord } from "../../bindings/ExternalRecord";
import {
  getExternalRecordLabel,
  parseExternalRecordInput,
  MAX_EXTERNAL_RECORDS,
} from "../../lib/externalRecords";

interface ExternalRecordsFieldProps {
  records: ExternalRecord[];
  onChange: (records: ExternalRecord[]) => void;
}

/**
 * Submit/edit-form field for the occurrence lexicon's `externalRecords`: links
 * to this same sighting already recorded elsewhere (an iNaturalist
 * observation, a record in another AT Protocol lexicon).
 *
 * Only a link is asked for — the `service` identifier is derived from the host
 * where we recognize one, so nobody has to learn the lexicon's vocabulary to
 * cross-link an observation, and an unrecognized host is left unlabelled
 * rather than guessed at. Added entries render as chips showing that label,
 * which is also how they read on the observation page.
 */
export function ExternalRecordsField({ records, onChange }: ExternalRecordsFieldProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const atCapacity = records.length >= MAX_EXTERNAL_RECORDS;

  const handleAdd = () => {
    const parsed = parseExternalRecordInput(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (records.some((record) => record.uri === parsed.record.uri)) {
      setError("That link has already been added.");
      return;
    }
    onChange([...records, parsed.record]);
    setDraft("");
    setError(null);
  };

  // Enter adds the link instead of submitting the observation — the field sits
  // inside the upload form, where a stray Enter would otherwise save early.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleAdd();
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Also recorded on (optional)
      </Typography>
      <Typography variant="caption" sx={{ color: "text.disabled" }}>
        Link this observation to the same sighting on another platform.
      </Typography>

      {records.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1 }}>
          {records.map((record) => (
            <Tooltip key={record.uri} title={record.uri}>
              <Chip
                label={getExternalRecordLabel(record)}
                size="small"
                onDelete={() => onChange(records.filter((r) => r.uri !== record.uri))}
              />
            </Tooltip>
          ))}
        </Stack>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "flex-start" }}>
        <TextField
          fullWidth
          size="small"
          label="Link to the record"
          value={draft}
          disabled={atCapacity}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://www.inaturalist.org/observations/123456789"
          error={error !== null}
          helperText={
            error ??
            (atCapacity ? `At most ${MAX_EXTERNAL_RECORDS} links.` : "https:// or at:// links.")
          }
        />
        <Button
          onClick={handleAdd}
          disabled={atCapacity || draft.trim() === ""}
          startIcon={<AddIcon />}
          // Nudged down to sit level with the text field, whose helper text
          // makes the row taller than the button.
          sx={{ mt: 0.5, flexShrink: 0 }}
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
}
