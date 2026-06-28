import { createTheme, type Theme, type PaletteMode } from "@mui/material/styles";

// Custom palette token for the warm neutral used by empty/loading placeholder
// surfaces (the "No image" tile and the loading skeleton), so the color lives
// in one place instead of being duplicated as raw hex in components.
declare module "@mui/material/styles" {
  interface Palette {
    placeholder: string;
    iucn: Record<string, string>;
  }
  interface PaletteOptions {
    placeholder?: string;
    iucn?: Record<string, string>;
  }
}

// Official IUCN Red List category colors — standardized by the IUCN,
// so they are mode-invariant and shared across light and dark themes.
const iucnColors: Record<string, string> = {
  EX: "#000000",
  EW: "#542344",
  CR: "#d81e05",
  EN: "#fc7f3f",
  VU: "#f9e814",
  NT: "#cce226",
  LC: "#60c659",
  DD: "#d1d1c6",
  NE: "#ffffff",
};

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
    // Muted mid-green accent. Toned down from the brighter #8ab87a so the mark
    // sits at the same visual weight as the lightened light-mode mark (#3a7d44)
    // rather than reading much lighter — while still holding enough contrast
    // against the dark background and the off-white text.
    main: "#5e9d5a",
    dark: "#4d8449",
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
  iucn: iucnColors,
};

const lightPalette = {
  mode: "light" as const,
  primary: {
    // Forest green — more ownable than the previous Material Design green.
    // Using the palette's lighter tone (#3a7d44) for the mark so it converges
    // in visual weight with the muted dark-mode accent (#5e9d5a), instead of
    // reading much darker. The deeper #1e5631 becomes the hover/pressed shade.
    main: "#3a7d44",
    dark: "#1e5631",
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
  iucn: iucnColors,
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
