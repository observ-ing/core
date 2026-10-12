import {
  List,
  ListItem,
  ListItemText,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
} from "@mui/material";
import { usePageTitle } from "../../hooks/usePageTitle";
import transparencyData from "../../data/transparency.json";
import { PageContainer } from "../common/PageContainer";
import { EmptyState } from "../common/EmptyState";
import { PageHeader } from "../common/PageHeader";

interface Category {
  name: string;
  description: string;
}

interface LineItem {
  name: string;
  cost: number;
}

interface MonthEntry {
  month: string;
  items: LineItem[];
}

interface TransparencyData {
  currency: string;
  notes: string;
  /** Line items in display order, as written by scripts/update-transparency.mjs. */
  categories: Category[];
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

  const categories = data.categories.map((c) => c.name);
  const sortedMonths = [...data.months].sort((a, b) => b.month.localeCompare(a.month));

  const costFor = (m: MonthEntry, name: string) =>
    m.items.find((item) => item.name === name)?.cost ?? 0;
  const monthTotal = (m: MonthEntry) => m.items.reduce((sum, item) => sum + item.cost, 0);
  const categoryTotal = (name: string) =>
    sortedMonths.reduce((sum, m) => sum + costFor(m, name), 0);
  const grandTotal = sortedMonths.reduce((sum, m) => sum + monthTotal(m), 0);

  return (
    <PageContainer maxWidth="md">
      <PageHeader title="Transparency" subtitle={data.notes} />

      <Paper variant="outlined">
        {sortedMonths.length === 0 ? (
          <EmptyState message="No cost data has been recorded yet." p={3} />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Month</TableCell>
                  {categories.map((c) => (
                    <TableCell key={c} align="right">
                      {c}
                    </TableCell>
                  ))}
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedMonths.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonth(m.month)}</TableCell>
                    {categories.map((c) => (
                      <TableCell key={c} align="right">
                        {formatCurrency(costFor(m, c))}
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
                  <TableCell>Total</TableCell>
                  {categories.map((c) => (
                    <TableCell key={c} align="right">
                      {formatCurrency(categoryTotal(c))}
                    </TableCell>
                  ))}
                  <TableCell align="right">{formatCurrency(grandTotal)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {data.categories.length > 0 && (
        <List dense sx={{ mt: 2 }}>
          {data.categories.map((c) => (
            <ListItem key={c.name} disableGutters>
              <ListItemText primary={c.name} secondary={c.description} />
            </ListItem>
          ))}
        </List>
      )}
    </PageContainer>
  );
}
