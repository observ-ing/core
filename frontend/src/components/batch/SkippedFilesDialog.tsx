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
import { plural } from "../../lib/utils";

export interface SkippedFilesDialogProps {
  /**
   * Separate from the list, which has to stay as it was while the dialog fades
   * out, or it rewords itself as "0 files" on the way.
   */
  open: boolean;
  /** Files left out of the last drop. */
  skipped: SkippedFile[];
  /** How many files from the same drop were added. */
  addedCount: number;
  onClose: () => void;
}

/** One summary of everything a drop left out, and why. */
export function SkippedFilesDialog({
  open,
  skipped,
  addedCount,
  onClose,
}: SkippedFilesDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
