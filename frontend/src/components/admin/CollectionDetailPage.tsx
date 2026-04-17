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
  TextField,
  Typography,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import {
  AdminError,
  type CollectionDetail,
  type RecordSummary,
  getCollection,
  getRecord,
  listRecords,
} from "../../services/admin";
import { RowDetailDialog } from "./RowDetailDialog";

const PAGE_SIZE = 50;

export function CollectionDetailPage() {
  const { nsid: rawNsid } = useParams<{ nsid: string }>();
  const nsid = rawNsid ? decodeURIComponent(rawNsid) : "";
  usePageTitle(`Admin: ${nsid}`);

  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [didFilter, setDidFilter] = useState("");
  const [appliedDid, setAppliedDid] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [detailUri, setDetailUri] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const openDetail = (uri: string) => {
    setDetailUri(uri);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(true);
    getRecord(nsid, uri)
      .then(setDetailData)
      .catch((e: unknown) => {
        setDetailError(e instanceof Error ? e.message : "Failed to load record");
      })
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    if (!nsid) return;
    setLoading(true);
    setError(null);
    const opts: { limit: number; offset: number; did?: string } = {
      limit: PAGE_SIZE,
      offset,
    };
    if (appliedDid) opts.did = appliedDid;
    Promise.all([getCollection(nsid), listRecords(nsid, opts)])
      .then(([d, r]) => {
        setDetail(d);
        setRecords(r.records);
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
  }, [nsid, offset, appliedDid]);

  if (loading && !detail) {
    return (
      <Container sx={{ py: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error && !detail) {
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
      <Link component={RouterLink} to="/admin" underline="hover">
        ← All collections
      </Link>
      <Typography variant="h4" sx={{ mt: 1, fontFamily: "monospace" }} gutterBottom>
        {nsid}
      </Typography>

      {detail && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap" }}>
            <Stat label="Table" value={detail.table} mono />
            <Stat label="Count" value={detail.count.toLocaleString()} />
            <Stat label="Unique DIDs" value={detail.unique_dids.toLocaleString()} />
            <Stat label="Oldest indexed" value={detail.oldest_indexed_at ?? "—"} />
            <Stat label="Newest indexed" value={detail.newest_indexed_at ?? "—"} />
            <Stat label="Cascades to" value={detail.cascades_to.join(", ") || "—"} />
          </Stack>
        </Paper>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Filter by DID"
          value={didFilter}
          onChange={(e) => setDidFilter(e.target.value)}
          placeholder="did:plc:..."
          sx={{ minWidth: 320 }}
        />
        <Button
          variant="outlined"
          onClick={() => {
            setOffset(0);
            setAppliedDid(didFilter.trim());
          }}
        >
          Apply
        </Button>
        {appliedDid && (
          <Button
            onClick={() => {
              setDidFilter("");
              setAppliedDid("");
              setOffset(0);
            }}
          >
            Clear
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>DID</TableCell>
              <TableCell>rkey</TableCell>
              <TableCell>URI</TableCell>
              <TableCell>CID</TableCell>
              <TableCell>Indexed at</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((r) => (
              <TableRow
                key={r.uri}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => openDetail(r.uri)}
              >
                <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{r.did}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{r.rkey}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.uri}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                  {r.cid ?? "—"}
                </TableCell>
                <TableCell sx={{ fontSize: "0.8rem" }}>{r.indexed_at}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ color: "text.secondary", py: 3 }}>
                  No records
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Showing {records.length === 0 ? 0 : offset + 1}–{offset + records.length}
          {detail ? ` of ${detail.count.toLocaleString()}` : ""}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            disabled={records.length < PAGE_SIZE || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </Stack>
      </Box>

      {detailUri && (
        <RowDetailDialog
          title={detailUri}
          data={detailData}
          loading={detailLoading}
          error={detailError}
          onClose={() => setDetailUri(null)}
        />
      )}
    </Container>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: mono ? "monospace" : undefined }}>
        {value}
      </Typography>
    </Box>
  );
}
