import {
  Box,
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import transparencyData from "../../data/transparency.json";

interface MonthCost {
  month: string;
  cost: number;
}

interface TransparencyData {
  currency: string;
  notes: string;
  months: MonthCost[];
}

const data: TransparencyData = transparencyData;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMonth(value: string): string {
  const [yearStr, monthStr] = value.split("-");
  const monthIdx = Number(monthStr) - 1;
  if (!yearStr || Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return value;
  }
  return `${MONTH_NAMES[monthIdx]} ${yearStr}`;
}

export function TransparencyPage() {
  usePageTitle("Transparency");

  const formatCurrency = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: data.currency,
  }).format;

  const total = data.months.reduce((sum, m) => sum + m.cost, 0);
  const sortedMonths = [...data.months].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Transparency
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
          {data.notes}
        </Typography>

        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          {sortedMonths.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No cost data has been recorded yet.
              </Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Month</TableCell>
                    <TableCell align="right">Cost</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedMonths.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{formatMonth(m.month)}</TableCell>
                      <TableCell align="right">{formatCurrency(m.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {formatCurrency(total)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
