import { createTheme, type Theme, type PaletteMode } from "@mui/material/styles";

// Custom palette token for the warm neutral used by empty/loading placeholder
// surfaces (the "No image" tile and the loading skeleton), so the color lives
// in one place instead of being duplicated as raw hex in components.
declare module "@mui/material/styles" {
  interface Palette {
    placeholder: string;
  }
  interface PaletteOptions {
    placeholder?: string;
  }
}

// Brand type stack: DM Sans for UI (geometric, friendly, reads well at every
// size), JetBrains Mono for data/numerals. System fonts remain as fallbacks.
const sansStack =
  '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif';
export const monoStack = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const sharedConfig = {
  typography: {
    fontFamily: sansStack,
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
    // Brighter accent green for legibility against the dark background —
    // the old #22c55e didn't hold enough contrast next to the off-white text.
    main: "#8ab87a",
    dark: "#6fa05f",
    contrastText: "#0e0e0d",
  },
  background: {
    default: "#0e0e0d",
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
  placeholder: "#211f1b",
};

const lightPalette = {
  mode: "light" as const,
  primary: {
    // Forest green — more ownable than the previous Material Design green.
    main: "#1e5631",
    dark: "#143d22",
    contrastText: "#ffffff",
  },
  background: {
    // Warm bone paper, in keeping with the naturalist / field-guide feel.
    default: "#faf6ec",
    paper: "#ffffff",
  },
  text: {
    primary: "#1a1a18",
    secondary: "#5b5445",
    disabled: "#8c836d",
  },
  warning: {
    main: "#b45309",
  },
  error: {
    main: "#b91c1c",
  },
  divider: "#e2dbca",
  placeholder: "#efe7d4",
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
          // JetBrains Mono is the brand's data/numerals typeface.
          "code, pre, kbd, samp": {
            fontFamily: monoStack,
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
      // Warm the loading shimmer to the bone palette (the default is a cool
      // black-alpha grey that clashes with the warm background).
      MuiSkeleton: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.placeholder,
          }),
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
