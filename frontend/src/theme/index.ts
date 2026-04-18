import { createTheme, type Theme, type PaletteMode } from "@mui/material/styles";

export const fontStacks = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  serif: '"Newsreader", Georgia, serif',
  display: '"Fraunces", "Newsreader", Georgia, serif',
};

const sharedConfig = {
  typography: {
    fontFamily: fontStacks.sans,
    h1: {
      fontFamily: fontStacks.display,
      fontSize: "1.75rem",
      fontWeight: 500,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: fontStacks.display,
      fontSize: "1.375rem",
      fontWeight: 500,
      letterSpacing: "-0.01em",
    },
    h3: { fontFamily: fontStacks.display, fontSize: "1.125rem", fontWeight: 500 },
    h4: { fontSize: "1rem", fontWeight: 600 },
    h5: { fontSize: "0.95rem", fontWeight: 600 },
    h6: { fontSize: "0.875rem", fontWeight: 600 },
    body1: { fontSize: "0.95rem" },
    body2: { fontSize: "0.875rem" },
    caption: { fontSize: "0.75rem", fontFamily: fontStacks.mono },
    overline: {
      fontFamily: fontStacks.mono,
      fontSize: "0.66rem",
      letterSpacing: "0.12em",
      textTransform: "uppercase" as const,
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 4,
  },
};

// Herbarium tokens — bone paper / warm dark, hunter green accent
const darkPalette = {
  mode: "dark" as const,
  primary: {
    main: "#8ab87a",
    dark: "#b5d6a4",
    light: "#2c3a28",
    contrastText: "#0a0a0a",
  },
  background: {
    default: "#1a1814",
    paper: "#211f1a",
  },
  text: {
    primary: "#efe8d6",
    secondary: "#a39c86",
    disabled: "#746c59",
  },
  warning: {
    main: "#d9a23c",
  },
  error: {
    main: "#e06a56",
  },
  divider: "#332f27",
};

const lightPalette = {
  mode: "light" as const,
  primary: {
    main: "#355e3b",
    dark: "#24422a",
    light: "#d6ddc4",
    contrastText: "#ffffff",
  },
  background: {
    default: "#f4efe6",
    paper: "#fbf8f1",
  },
  text: {
    primary: "#1c1a15",
    secondary: "#5b5445",
    disabled: "#8c836d",
  },
  warning: {
    main: "#8a5a00",
  },
  error: {
    main: "#b33a2a",
  },
  divider: "#d9d0bb",
};

const createAppTheme = (mode: PaletteMode): Theme => {
  const isDark = mode === "dark";
  const palette = isDark ? darkPalette : lightPalette;
  const borderStrong = isDark ? "#4a463c" : "#b9ae93";
  const sunken = isDark ? "#13110e" : "#ebe4d2";
  const fg3 = isDark ? "#746c59" : "#8c836d";
  const warningBg = isDark ? "#2c261a" : "#efe5cf";

  return createTheme({
    palette,
    ...sharedConfig,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            "--ov-bg": palette.background.default,
            "--ov-bg-elev": palette.background.paper,
            "--ov-bg-sunken": sunken,
            "--ov-fg": palette.text.primary,
            "--ov-fg-2": palette.text.secondary,
            "--ov-fg-3": fg3,
            "--ov-border": palette.divider,
            "--ov-border-strong": borderStrong,
            "--ov-accent": palette.primary.main,
            "--ov-accent-strong": palette.primary.dark,
            "--ov-accent-soft": palette.primary.light,
            "--ov-warning": palette.warning.main,
            "--ov-warning-bg": warningBg,
            "--ov-heart": palette.error.main,
            "--ov-sans": fontStacks.sans,
            "--ov-mono": fontStacks.mono,
            "--ov-serif": fontStacks.serif,
            "--ov-display": fontStacks.display,
          },
          body: {
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
            fontFamily: fontStacks.sans,
            WebkitFontSmoothing: "antialiased",
          },
          "#root": {
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
          },
          "::selection": {
            background: palette.primary.light,
            color: palette.primary.dark,
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

export default darkTheme;
