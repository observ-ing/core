import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import { AdminError, type ListTableRowsResponse, listTableRows } from "../../services/admin";
import { RowDetailDialog } from "./RowDetailDialog";

const PAGE_SIZE = 50;

export function TableDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const name = rawName ? decodeURIComponent(rawName) : "";
  usePageTitle(`Admin: ${name}`);

  const [data, setData] = useState<ListTableRowsResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setError(null);
    listTableRows(name, { limit: PAGE_SIZE, offset })
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof AdminError) {
          setStatus(e.status);
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      })
      .finally(() => setLoading(false));
  }, [name, offset]);

  if (loading && !data) {
    return (
      <Container sx={{ py: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error && !data) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity={status === 403 || status === 401 ? "warning" : "error"}>
          {status != null ? `[${status}] ` : ""}
          {error}
        </Alert>
      </Container>
    );
  }

  if (!data) return null;

  return (
    <Container sx={{ py: 4 }}>
      <Link component={RouterLink} to="/admin" underline="hover">
        ← Admin
      </Link>
      <Typography variant="h4" sx={{ mt: 1, fontFamily: "monospace" }} gutterBottom>
        {name}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {data.columns.map((col) => (
                <TableCell key={col}>{col}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.rows.map((row, i) => (
              <TableRow key={i} hover sx={{ cursor: "pointer" }} onClick={() => setDetailRow(row)}>
                {data.columns.map((col) => (
                  <TableCell
                    key={col}
                    sx={{ fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "nowrap" }}
                  >
                    {formatCell(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {data.rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={data.columns.length}
                  align="center"
                  sx={{ color: "text.secondary", py: 3 }}
                >
                  No rows
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Showing {data.rows.length === 0 ? 0 : offset + 1}–{offset + data.rows.length}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            disabled={data.rows.length < PAGE_SIZE || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </Stack>
      </Box>

      {detailRow && (
        <RowDetailDialog
          title={String(detailRow[data.columns[0] ?? ""] ?? "Row detail")}
          data={detailRow}
          onClose={() => setDetailRow(null)}
        />
      )}
    </Container>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
