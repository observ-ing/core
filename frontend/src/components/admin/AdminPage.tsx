import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  CircularProgress,
  Container,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  AdminError,
  type CollectionSummary,
  type TableSummary,
  listCollections,
  listTables,
} from "../../services/admin";

export function AdminPage() {
  usePageTitle("Admin");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([listCollections(), listTables()])
      .then(([cRes, tRes]) => {
        setCollections(cRes.collections);
        setTotal(cRes.total);
        setTables(tRes.tables);
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
            </TableRow>
          </TableHead>
          <TableBody>
            {collections.map((c) => (
              <TableRow key={c.nsid}>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  <Link
                    component={RouterLink}
                    to={`/admin/collections/${encodeURIComponent(c.nsid)}`}
                    underline="hover"
                  >
                    {c.nsid}
                  </Link>
                </TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{c.table}</TableCell>
                <TableCell align="right">{c.count.toLocaleString()}</TableCell>
                <TableCell sx={{ fontSize: "0.8rem", color: "text.secondary" }}>
                  {c.cascades_to.join(", ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="h5" sx={{ mt: 5, mb: 2 }}>
        Other tables
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Internal tables (not lexicon records). Read-only. OAuth state and sessions are intentionally
        excluded.
      </Typography>
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Table</TableCell>
              <TableCell>Columns</TableCell>
              <TableCell align="right">Count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tables.map((t) => (
              <TableRow key={t.name}>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  <Link
                    component={RouterLink}
                    to={`/admin/tables/${encodeURIComponent(t.name)}`}
                    underline="hover"
                  >
                    {t.name}
                  </Link>
                </TableCell>
                <TableCell sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
                  {t.columns.join(", ")}
                </TableCell>
                <TableCell align="right">{t.count.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Container>
  );
}
