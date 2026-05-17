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

interface ServiceCost {
  name: string;
  cost: number;
}

interface MonthEntry {
  month: string;
  services: ServiceCost[];
}

interface TransparencyData {
  currency: string;
  notes: string;
  months: MonthEntry[];
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

  const serviceTotals = new Map<string, number>();
  for (const month of data.months) {
    for (const s of month.services) {
      serviceTotals.set(s.name, (serviceTotals.get(s.name) ?? 0) + s.cost);
    }
  }
  const services = [...serviceTotals.keys()].sort((a, b) => {
    const diff = (serviceTotals.get(b) ?? 0) - (serviceTotals.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const sortedMonths = [...data.months].sort((a, b) => b.month.localeCompare(a.month));

  const costFor = (m: MonthEntry, name: string) =>
    m.services.find((s) => s.name === name)?.cost ?? 0;
  const monthTotal = (m: MonthEntry) => m.services.reduce((sum, s) => sum + s.cost, 0);
  const grandTotal = sortedMonths.reduce((sum, m) => sum + monthTotal(m), 0);

  return (
    <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="md" sx={{ py: 3 }}>
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
                    {services.map((s) => (
                      <TableCell key={s} align="right">
                        {s}
                      </TableCell>
                    ))}
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedMonths.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell>{formatMonth(m.month)}</TableCell>
                      {services.map((s) => (
                        <TableCell key={s} align="right">
                          {formatCurrency(costFor(m, s))}
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {formatCurrency(monthTotal(m))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                    {services.map((s) => (
                      <TableCell key={s} align="right" sx={{ fontWeight: 600 }}>
                        {formatCurrency(serviceTotals.get(s) ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {formatCurrency(grandTotal)}
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
