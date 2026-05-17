import { Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Paper, Stack } from "@mui/material";
import { Schema, AutoStories, GitHub, AccountBalance, ChevronRight } from "@mui/icons-material";
import { usePageTitle } from "../../hooks/usePageTitle";

interface DocLink {
  label: string;
  description: string;
  icon: React.ReactNode;
  to?: string;
  href?: string;
}

const links: DocLink[] = [
  {
    label: "Lexicons",
    description: "AT Protocol record schemas that define how data is stored.",
    icon: <Schema />,
    to: "/lexicons",
  },
  {
    label: "Transparency",
    description: "Monthly Google Cloud hosting costs for Observ.ing.",
    icon: <AccountBalance />,
    to: "/transparency",
  },
  {
    label: "Storybook",
    description: "Interactive component library and UI documentation.",
    icon: <AutoStories />,
    href: "https://storybook.observ.ing",
  },
  {
    label: "Source Code",
    description: "Browse the project on GitHub.",
    icon: <GitHub />,
    href: "https://github.com/observ-ing/core",
  },
];

export function DocsPage() {
  usePageTitle("Docs");

  return (
    <Box sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          Docs
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 3 }}>
          Reference material and resources for Observ.ing.
        </Typography>

        <Stack spacing={1.5}>
          {links.map((link) => {
            const linkProps = link.to
              ? { component: RouterLink, to: link.to }
              : {
                  component: "a" as const,
                  href: link.href,
                  target: "_blank",
                  rel: "noopener noreferrer",
                };
            return (
              <Paper
                key={link.label}
                variant="outlined"
                {...linkProps}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  textDecoration: "none",
                  color: "text.primary",
                  "&:hover": { bgcolor: "action.hover", borderColor: "primary.main" },
                }}
              >
                <Box sx={{ color: "primary.main", display: "flex" }}>{link.icon}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {link.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {link.description}
                  </Typography>
                </Box>
                <ChevronRight sx={{ color: "text.secondary" }} />
              </Paper>
            );
          })}
        </Stack>
      </Container>
    </Box>
  );
}
