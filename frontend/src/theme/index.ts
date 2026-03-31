import { createTheme, type Theme, type PaletteMode } from "@mui/material/styles";

const sharedConfig = {
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
    h1: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" },
    h3: { fontSize: "1.1rem", fontWeight: 700 },
    h4: { fontSize: "1rem", fontWeight: 600 },
    h5: { fontSize: "0.95rem", fontWeight: 600 },
    h6: { fontSize: "0.875rem", fontWeight: 600 },
    body1: { fontSize: "1rem" },
    body2: { fontSize: "0.875rem" },
    caption: { fontSize: "0.75rem" },
  },
  shape: {
    borderRadius: 8,
  },
};

const darkPalette = {
  mode: "dark" as const,
  primary: {
    main: "#22c55e",
    dark: "#16a34a",
    contrastText: "#0a0a0a",
  },
  secondary: {
    main: "#333",
  },
  background: {
    default: "#0a0a0a",
    paper: "#1a1a1a",
  },
  text: {
    primary: "#fafafa",
    secondary: "#999",
    disabled: "#666",
  },
  warning: {
    main: "#f59e0b",
  },
  error: {
    main: "#ef4444",
  },
  divider: "#333",
};

const lightPalette = {
  mode: "light" as const,
  primary: {
    main: "#15803d",
    dark: "#166534",
    contrastText: "#ffffff",
  },
  secondary: {
    main: "#d4d4d4",
  },
  background: {
    default: "#f5f5f5",
    paper: "#ffffff",
  },
  text: {
    primary: "#171717",
    secondary: "#525252",
    disabled: "#737373",
  },
  warning: {
    main: "#b45309",
  },
  error: {
    main: "#b91c1c",
  },
  divider: "#d4d4d4",
};

const createAppTheme = (mode: PaletteMode): Theme => {
  const isDark = mode === "dark";
  const palette = isDark ? darkPalette : lightPalette;

  return createTheme({
    palette,
    ...sharedConfig,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          },
          "#root": {
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
          },
        },
      },
    },
  });
};

export const darkTheme = createAppTheme("dark");
export const lightTheme = createAppTheme("light");
export const getTheme = (mode: PaletteMode): Theme => createAppTheme(mode);

// Default export for backwards compatibility
export default darkTheme;
