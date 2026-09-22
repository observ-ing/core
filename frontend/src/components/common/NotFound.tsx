import { Link } from "react-router-dom";
import { Typography, Button } from "@mui/material";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { FullPageStatus } from "./FullPageStatus";
import { fullPageStatusPrimaryActionSx, fullPageStatusSecondaryActionSx } from "./layoutSx";

export function NotFound() {
  return (
    <FullPageStatus
      icon={<SearchOffIcon />}
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
            sx={fullPageStatusPrimaryActionSx}
          >
            Go home
          </Button>
          <Button
            onClick={() => window.history.back()}
            variant="outlined"
            color="inherit"
            sx={fullPageStatusSecondaryActionSx}
          >
            Go back
          </Button>
        </>
      }
    />
  );
}
