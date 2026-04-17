import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  AdminError,
  type CollectionSummary,
  type DeleteResponse,
  deleteCollection,
  listCollections,
} from "../../services/admin";

export function AdminPage() {
  usePageTitle("Admin");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [target, setTarget] = useState<CollectionSummary | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    listCollections()
      .then((res) => {
        setCollections(res.collections);
        setTotal(res.total);
      })
      .catch((e: unknown) => {
        if (e instanceof AdminError) {
          setStatus(e.status);
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return (
      <Container sx={{ py: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity={status === 403 || status === 401 ? "warning" : "error"}>
          {status != null ? `[${status}] ` : ""}
          {error}
        </Alert>
      </Container>
    );
  }

  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Admin
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Total records across all collections: <strong>{total.toLocaleString()}</strong>
      </Typography>

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>NSID</TableCell>
              <TableCell>Table</TableCell>
              <TableCell align="right">Count</TableCell>
              <TableCell>Cascades to</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {collections.map((c) => (
              <TableRow key={c.nsid}>
                <TableCell sx={{ fontFamily: "monospace" }}>{c.nsid}</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{c.table}</TableCell>
                <TableCell align="right">{c.count.toLocaleString()}</TableCell>
                <TableCell sx={{ fontSize: "0.8rem", color: "text.secondary" }}>
                  {c.cascades_to.join(", ") || "—"}
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="error"
                    disabled={c.count === 0}
                    onClick={() => setTarget(c)}
                  >
                    Purge
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {target && (
        <PurgeDialog
          collection={target}
          onClose={() => setTarget(null)}
          onPurged={() => {
            setTarget(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}

function PurgeDialog({
  collection,
  onClose,
  onPurged,
}: {
  collection: CollectionSummary;
  onClose: () => void;
  onPurged: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteResponse | null>(null);

  const confirmed = typed === collection.nsid;

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await deleteCollection(collection.nsid, { dryRun });
      setResult(res);
      if (!res.dry_run) {
        // Trigger refresh shortly so the user can read the result.
        setTimeout(onPurged, 1200);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Purge {collection.nsid}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will delete <strong>{collection.count.toLocaleString()}</strong> rows from{" "}
          <code>{collection.table}</code>.
          {collection.cascades_to.length > 0 && (
            <> Cascades to: {collection.cascades_to.join(", ")}.</>
          )}
        </Alert>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Type the NSID to confirm:
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={collection.nsid}
          disabled={pending}
          autoFocus
        />
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />}
          label="Dry run (count only, don't delete)"
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {result && (
          <Alert severity={result.dry_run ? "info" : "success"} sx={{ mt: 2 }}>
            {result.dry_run
              ? `Dry run: would delete ${result.rows_affected.toLocaleString()} rows.`
              : `Deleted ${result.rows_affected.toLocaleString()} rows.`}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Close
        </Button>
        <Button color="error" variant="contained" onClick={submit} disabled={!confirmed || pending}>
          {dryRun ? "Dry run" : "Purge"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
