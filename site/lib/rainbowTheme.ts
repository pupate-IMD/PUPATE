import { darkTheme, type Theme } from "@rainbow-me/rainbowkit";

// RainbowKit's modal in Pupate's own language. The colours point at the page's CSS variables, so the
// modal follows the light/dark switch without a second theme object.
export function pupateTheme(): Theme {
  const base = darkTheme({ borderRadius: "none", fontStack: "system" });
  return {
    ...base,
    fonts: { body: "var(--mono)" },
    radii: { ...base.radii, actionButton: "0", connectButton: "0", menuButton: "0", modal: "0", modalMobile: "0" },
    shadows: { ...base.shadows, connectButton: "none", dialog: "none", profileDetailsAction: "none", selectedOption: "none", selectedWallet: "none", walletLogo: "none" },
    colors: {
      ...base.colors,
      accentColor: "var(--jade)",
      accentColorForeground: "#06130e",
      actionButtonBorder: "var(--hair)",
      actionButtonBorderMobile: "var(--hair)",
      actionButtonSecondaryBackground: "var(--paper-2)",
      closeButton: "var(--dim)",
      closeButtonBackground: "var(--paper-2)",
      connectButtonBackground: "var(--paper)",
      connectButtonBackgroundError: "var(--alarm)",
      connectButtonInnerBackground: "var(--paper-2)",
      connectButtonText: "var(--ink)",
      connectButtonTextError: "var(--paper)",
      connectionIndicator: "var(--jade)",
      downloadBottomCardBackground: "var(--paper-2)",
      downloadTopCardBackground: "var(--paper)",
      error: "var(--alarm)",
      generalBorder: "var(--hair)",
      generalBorderDim: "var(--hair)",
      menuItemBackground: "var(--paper-2)",
      modalBackdrop: "rgba(0, 0, 0, 0.55)",
      modalBackground: "var(--paper)",
      modalBorder: "var(--hair)",
      modalText: "var(--ink)",
      modalTextDim: "var(--faint)",
      modalTextSecondary: "var(--dim)",
      profileAction: "var(--paper-2)",
      profileActionHover: "var(--hair)",
      profileForeground: "var(--paper)",
      selectedOptionBorder: "var(--jade)",
      standby: "var(--gold)",
    },
  };
}
