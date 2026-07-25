import { Link } from "react-router-dom";
import { Typography, Button } from "@mui/material";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { FullPageStatus } from "./FullPageStatus";

export function NotFound() {
  return (
    <FullPageStatus
      icon={<SearchOffIcon sx={{ fontSize: 60, color: "text.disabled" }} />}
      eyebrow={
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
      }
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved."
      descriptionMaxWidth={300}
      actions={
        <>
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
        </>
      }
    />
  );
}
