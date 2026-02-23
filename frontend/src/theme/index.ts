import { createTheme, Theme, PaletteMode } from "@mui/material/styles";

const sharedConfig = {
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
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
  const borderColor = isDark ? "#333" : "#e5e5e5";
  const surfaceColor = isDark ? "#1a1a1a" : "#ffffff";
  const skeletonColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const cardShadow = isDark
    ? "0 1px 3px rgba(0, 0, 0, 0.24), 0 1px 2px rgba(0, 0, 0, 0.16)"
    : "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)";

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
          // Focus-visible accessibility styles using theme colors
          "*:focus-visible": {
            outline: `2px solid ${palette.primary.main}`,
            outlineOffset: "2px",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            transition: "all 0.2s ease",
            "&:active": {
              transform: "scale(0.98)",
            },
          },
          contained: {
            boxShadow: isDark
              ? "0 2px 8px rgba(34, 197, 94, 0.25)"
              : "0 2px 8px rgba(21, 128, 61, 0.2)",
            "&:hover": {
              boxShadow: isDark
                ? "0 4px 12px rgba(34, 197, 94, 0.35)"
                : "0 4px 12px rgba(21, 128, 61, 0.3)",
            },
          },
          outlined: {
            "&:hover": {
              backgroundColor: isDark ? "rgba(34, 197, 94, 0.08)" : "rgba(21, 128, 61, 0.04)",
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: surfaceColor,
            borderBottom: `1px solid ${borderColor}`,
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: {
          root: {
            backgroundColor: surfaceColor,
            borderTop: `1px solid ${borderColor}`,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: surfaceColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 16,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: cardShadow,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              "& fieldset": { borderColor },
              "&:hover fieldset": { borderColor },
              "&.Mui-focused fieldset": { borderColor: palette.primary.main },
            },
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            boxShadow: isDark
              ? "0 4px 12px rgba(34, 197, 94, 0.3)"
              : "0 4px 12px rgba(22, 163, 74, 0.25)",
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            backgroundColor: palette.primary.main,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            color: palette.text.secondary,
            "&.Mui-selected": {
              color: palette.primary.main,
            },
          },
        },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            color: palette.text.secondary,
            "&.Mui-selected": {
              color: palette.primary.main,
            },
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor: skeletonColor,
          },
        },
        defaultProps: {
          animation: "wave",
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            transition: "box-shadow 0.2s ease, transform 0.2s ease",
          },
          elevation1: {
            boxShadow: cardShadow,
          },
        },
      },
      MuiCardMedia: {
        styleOverrides: {
          root: {
            borderRadius: 0,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 500,
            transition: "all 0.15s ease",
          },
          outlined: {
            "&:hover": {
              borderColor: palette.primary.main,
              backgroundColor: isDark ? "rgba(34, 197, 94, 0.08)" : "rgba(21, 128, 61, 0.04)",
            },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
          standardSuccess: {
            backgroundColor: isDark ? "rgba(34, 197, 94, 0.12)" : "rgba(21, 128, 61, 0.08)",
            color: palette.primary.main,
            "& .MuiAlert-icon": {
              color: palette.primary.main,
            },
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            transition: "transform 0.2s ease, box-shadow 0.2s ease",
            "&:hover": {
              transform: "scale(1.05)",
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: "all 0.15s ease",
            "&:hover": {
              transform: "scale(1.1)",
            },
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
