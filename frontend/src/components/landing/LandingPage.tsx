import { Link } from "react-router-dom";
import { Box, Button, Card, CardContent, Container, Typography } from "@mui/material";
import { Explore, GitHub, Schema } from "@mui/icons-material";
import { useAppDispatch } from "../../store";
import { openLoginModal } from "../../store/uiSlice";
import logoSvg from "../../assets/logo.svg";

const features = [
  {
    title: "Built on AT Protocol",
    description:
      "Your observations live in your personal data server. Switch apps anytime without losing anything.",
  },
  {
    title: "Open Source",
    description:
      "Every line of code is public. Audit it, fork it, improve it.",
  },
  {
    title: "Data Portability",
    description:
      "Export your observations in standard formats. No lock-in, no walled gardens.",
  },
  {
    title: "Contribute to Science",
    description:
      "Observations mapped to Darwin Core standards, contributing to global biodiversity knowledge.",
  },
];

export function LandingPage() {
  const dispatch = useAppDispatch();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        overflow: "auto",
      }}
    >
      {/* Hero */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          px: 3,
          py: { xs: 8, md: 12 },
          animation: "fadeInUp 0.6s ease-out",
        }}
      >
        <Container maxWidth="sm">
          <Box sx={{ mb: 3 }}>
            <img src={logoSvg} alt="" width={64} height={64} />
          </Box>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: "2rem", md: "2.75rem" },
              fontWeight: 800,
              letterSpacing: "-0.03em",
              mb: 2,
            }}
          >
            Observe nature.{" "}
            <Box component="span" sx={{ color: "primary.main" }}>
              Own your data.
            </Box>
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ fontSize: { xs: "1rem", md: "1.15rem" }, mb: 4, lineHeight: 1.6 }}
          >
            A decentralized platform for biodiversity observations, built on the
            AT Protocol. Record what you see, keep what you create.
          </Typography>
          <Box sx={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
            <Button
              component={Link}
              to="/explore"
              variant="outlined"
              size="large"
              startIcon={<Explore />}
            >
              Explore
            </Button>
            <Button
              variant="contained"
              size="large"
              onClick={() => dispatch(openLoginModal())}
            >
              Log in
            </Button>
          </Box>
        </Container>
      </Box>

      {/* Feature cards */}
      <Container maxWidth="md" sx={{ pb: 8 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          {features.map((feature, i) => (
            <Card
              key={feature.title}
              variant="outlined"
              sx={{
                animation: `fadeInUp 0.5s ease-out ${0.1 + i * 0.08}s both`,
              }}
            >
              <CardContent>
                <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 700 }}>
                  {feature.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {feature.description}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      {/* Footer links */}
      <Box
        sx={{
          borderTop: 1,
          borderColor: "divider",
          py: 3,
          textAlign: "center",
          display: "flex",
          justifyContent: "center",
          gap: 3,
        }}
      >
        <Button
          component="a"
          href="https://github.com/observ-ing/core"
          target="_blank"
          rel="noopener noreferrer"
          size="small"
          color="inherit"
          startIcon={<GitHub />}
          sx={{ color: "text.secondary" }}
        >
          Source Code
        </Button>
        <Button
          component={Link}
          to="/lexicons"
          size="small"
          color="inherit"
          startIcon={<Schema />}
          sx={{ color: "text.secondary" }}
        >
          Lexicons
        </Button>
      </Box>
    </Box>
  );
}
