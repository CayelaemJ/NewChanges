import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { PropsWithChildren } from "react";

const theme = createTheme({
  cssVariables: {
    cssVarPrefix: "mui",
    disableCssColorScheme: true,
  },
  palette: {
    primary: {
      main: "var(--brand-accent, #7d2fa3)",
      dark: "var(--brand-primary, #2b1b68)",
      contrastText: "#fff",
    },
    background: {
      default: "var(--white, #fff)",
      paper: "var(--white, #fff)",
    },
    text: {
      primary: "var(--ink, #0f2438)",
      secondary: "var(--grey, #425466)",
    },
  },
  typography: {
    fontFamily: "Manrope, system-ui, sans-serif",
  },
  shape: {
    borderRadius: 11,
  },
  components: {
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily: "Manrope, system-ui, sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          borderRadius: "8px",
        },
      },
    },
  },
});

export function MuiProvider({ children }: PropsWithChildren) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
