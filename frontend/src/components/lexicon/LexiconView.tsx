import { useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  IconButton,
  Link as MuiLink,
} from "@mui/material";
import { ExpandMore, ExpandLess } from "@mui/icons-material";

// Eagerly import all lexicons at build time via the @lexicons alias.
// This avoids duplicating the schema files — the source of truth remains in /lexicons/.
const lexiconModules = import.meta.glob("@lexicons/**/*.json", {
  eager: true,
});

interface LexiconProperty {
  type: string;
  description?: string;
  format?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  ref?: string;
  enum?: string[];
  knownValues?: string[];
  default?: string | number | boolean;
  items?: LexiconProperty;
  accept?: string[];
  maxSize?: number;
  required?: string[];
  properties?: Record<string, LexiconProperty>;
}

interface LexiconDef {
  type: string;
  description?: string;
  key?: string;
  required?: string[];
  record?: {
    type: string;
    required?: string[];
    properties?: Record<string, LexiconProperty>;
  };
  properties?: Record<string, LexiconProperty>;
}

interface LexiconSchema {
  lexicon: number;
  id: string;
  description?: string;
  defs: Record<string, LexiconDef>;
}

// Parse and sort lexicons by ID
const allLexicons: LexiconSchema[] = Object.values(lexiconModules)
  .map((mod) => (mod as { default: LexiconSchema }).default)
  .sort((a, b) => a.id.localeCompare(b.id));

const isInHouse = (schema: LexiconSchema) =>
  schema.id.startsWith("org.rwell.test.");

const inHouseLexicons = allLexicons.filter(isInHouse);
const externalLexicons = allLexicons.filter((s) => !isInHouse(s));

function formatType(prop: LexiconProperty): string {
  if (prop.type === "ref" && prop.ref) {
    const refName = prop.ref.startsWith("#") ? prop.ref.slice(1) : prop.ref;
    return `ref → ${refName}`;
  }
  if (prop.type === "array" && prop.items) {
    return `array<${formatType(prop.items)}>`;
  }
  if (prop.type === "blob") {
    return "blob";
  }
  let t = prop.type;
  if (prop.format) t += ` (${prop.format})`;
  return t;
}

function PropertyTable({
  properties,
  required,
}: {
  properties: Record<string, LexiconProperty>;
  required?: string[];
}) {
  const requiredSet = new Set(required ?? []);

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Field</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(properties).map(([name, prop]) => (
            <TableRow key={name}>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography
                    variant="body2"
                    component="code"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.8rem",
                      color: prop.description?.includes("[DEPRECATED")
                        ? "text.disabled"
                        : "text.primary",
                    }}
                  >
                    {name}
                  </Typography>
                  {requiredSet.has(name) && (
                    <Chip label="required" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: "0.65rem" }} />
                  )}
                </Box>
              </TableCell>
              <TableCell>
                <Typography
                  variant="body2"
                  component="code"
                  sx={{ fontFamily: "monospace", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                >
                  {formatType(prop)}
                </Typography>
                {prop.enum && (
                  <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {prop.enum.map((v) => (
                      <Chip key={v} label={v} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.6rem" }} />
                    ))}
                  </Box>
                )}
                {prop.knownValues && (
                  <Box sx={{ mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {prop.knownValues.map((v) => (
                      <Chip key={v} label={v} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.6rem" }} />
                    ))}
                  </Box>
                )}
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                  {prop.description}
                </Typography>
                {prop.maxLength != null && (
                  <Typography variant="caption" color="text.disabled">
                    max length: {prop.maxLength}
                  </Typography>
                )}
                {prop.default != null && (
                  <Typography variant="caption" color="text.disabled" sx={{ display: "block" }}>
                    default: {String(prop.default)}
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function DefSection({ name, def }: { name: string; def: LexiconDef }) {
  const [open, setOpen] = useState(true);

  const properties = def.record?.properties ?? def.properties;
  const required = def.record?.required ?? def.required;

  if (!properties) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Box
        sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <IconButton size="small">
          {open ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
        <Typography
          variant="subtitle2"
          component="code"
          sx={{ fontFamily: "monospace" }}
        >
          #{name}
        </Typography>
        {def.type && (
          <Chip
            label={def.type}
            size="small"
            sx={{ ml: 1, height: 20, fontSize: "0.65rem" }}
          />
        )}
        {def.key && (
          <Chip
            label={`key: ${def.key}`}
            size="small"
            variant="outlined"
            sx={{ ml: 1, height: 20, fontSize: "0.65rem" }}
          />
        )}
      </Box>
      {def.description && name !== "main" && (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 5, mb: 1 }}>
          {def.description}
        </Typography>
      )}
      <Collapse in={open}>
        <Box sx={{ ml: 2 }}>
          <PropertyTable properties={properties} required={required} />
        </Box>
      </Collapse>
    </Box>
  );
}

function LexiconCard({ schema }: { schema: LexiconSchema }) {
  const mainDef = schema.defs.main;
  const otherDefs = Object.entries(schema.defs).filter(([k]) => k !== "main");

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography
          variant="h6"
          component="code"
          sx={{ fontFamily: "monospace", fontWeight: 700 }}
        >
          {schema.id}
        </Typography>

        {mainDef?.description && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
            {mainDef.description}
          </Typography>
        )}

        {mainDef && <DefSection name="main" def={mainDef} />}

        {otherDefs.map(([name, def]) => (
          <DefSection key={name} name={name} def={def} />
        ))}
      </CardContent>
    </Card>
  );
}

export function LexiconView() {
  return (
    <Box sx={{ maxWidth: 960, mx: "auto", p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Lexicons
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Observ.ing is built on the{" "}
        <MuiLink href="https://atproto.com" target="_blank" rel="noopener noreferrer">
          AT Protocol
        </MuiLink>
        . All data is stored as records defined by these{" "}
        <MuiLink href="https://atproto.com/guides/lexicon" target="_blank" rel="noopener noreferrer">
          Lexicon
        </MuiLink>{" "}
        schemas, which follow{" "}
        <MuiLink href="https://dwc.tdwg.org" target="_blank" rel="noopener noreferrer">
          Darwin Core
        </MuiLink>{" "}
        biodiversity standards.
      </Typography>

      <Typography variant="h5" fontWeight={600} sx={{ mt: 2, mb: 2 }}>
        Observ.ing Lexicons
      </Typography>
      {inHouseLexicons.map((schema) => (
        <LexiconCard key={schema.id} schema={schema} />
      ))}

      <Typography variant="h5" fontWeight={600} sx={{ mt: 4, mb: 1 }}>
        External Lexicons
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Third-party AT Protocol lexicons used by Observ.ing.
      </Typography>
      {externalLexicons.map((schema) => (
        <LexiconCard key={schema.id} schema={schema} />
      ))}
    </Box>
  );
}
