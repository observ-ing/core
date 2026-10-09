import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from "@mui/material";
import type { SkippedFile } from "../../lib/batchUpload";

export interface SkippedFilesDialogProps {
  /** Files left out of the last drop; the dialog is open while there are any. */
  skipped: SkippedFile[];
  /** How many files from the same drop were added. */
  addedCount: number;
  onClose: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One summary of everything a drop left out, and why. */
export function SkippedFilesDialog({ skipped, addedCount, onClose }: SkippedFilesDialogProps) {
  return (
    <Dialog open={skipped.length > 0} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {plural(skipped.length, "file")} {skipped.length === 1 ? "wasn't" : "weren't"} added
      </DialogTitle>
      <DialogContent>
        <Typography>
          {addedCount > 0
            ? `${plural(addedCount, "photo")} ${addedCount === 1 ? "was" : "were"} added. `
            : "No photos were added. "}
          {skipped.length === 1 ? "This was skipped:" : "These were skipped:"}
        </Typography>
        <List dense>
          {skipped.map((file, i) => (
            <ListItem
              // Two dropped files can share a name, so the name alone isn't a key.
              key={`${file.name}-${i}`}
              disableGutters
              sx={{ justifyContent: "space-between", gap: 2 }}
            >
              <Typography variant="body2" noWrap sx={{ fontFamily: "monospace" }}>
                {file.name}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", flexShrink: 0 }}>
                {file.reason}
              </Typography>
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}
