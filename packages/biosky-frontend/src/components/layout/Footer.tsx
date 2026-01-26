import { Box, Typography, Link } from "@mui/material";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <Box
      component="footer"
      sx={{
        py: 1,
        px: 2,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 2,
        bgcolor: "background.paper",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        © {currentYear} BioSky
      </Typography>
      <Link
        href="https://github.com/frewsxcv/biosky"
        target="_blank"
        rel="noopener noreferrer"
        variant="caption"
        color="text.secondary"
        sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
      >
        Source Code
      </Link>
      <Link
        href="/api/docs"
        variant="caption"
        color="text.secondary"
        sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
      >
        API Docs
      </Link>
    </Box>
  );
}
