import { Link } from "react-router-dom";
import { Box, Typography, Button, Stack } from "@mui/material";
import SearchOffIcon from "@mui/icons-material/SearchOff";

export function NotFound() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        p: 4,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          width: 120,
          height: 120,
          borderRadius: "50%",
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mb: 3,
        }}
      >
        <SearchOffIcon sx={{ fontSize: 60, color: "text.disabled" }} />
      </Box>
      <Typography
        variant="h1"
        sx={{
          fontSize: "4rem",
          fontWeight: 700,
          background: (theme) =>
            `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          mb: 1,
        }}
      >
        404
      </Typography>
      <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
        Page not found
      </Typography>
      <Typography variant="body2" color="text.disabled" sx={{ mb: 4, maxWidth: 300 }}>
        The page you're looking for doesn't exist or has been moved.
      </Typography>
      <Stack direction="row" spacing={2}>
        <Button
          component={Link}
          to="/"
          variant="contained"
          color="primary"
          sx={{
            px: 4,
            py: 1,
            fontWeight: 600,
          }}
        >
          Go home
        </Button>
        <Button
          onClick={() => window.history.back()}
          variant="outlined"
          color="inherit"
          sx={{ px: 3 }}
        >
          Go back
        </Button>
      </Stack>
    </Box>
  );
}
