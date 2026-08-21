/**
 * What the terminal module calls things.
 *
 * Plain data, importing nothing from `src/i18n/`: `dicts.ts` imports this file, so anything
 * imported back out of there would close the circle.
 */
const terminalEn = {
  terminal: {
    newTabTitle: "New terminal",
    localTitle: "Local shell",
    shell: "Shell",
    startIn: "Start in",
    startInPlaceholder: "Home directory",
    browse: "Browse\u2026",
    open: "Open",
    noShells: "No shell was found on this machine.",
    screen: "Terminal screen",
    badgeLocal: "Local shell",
    badgeSsh: "SSH session",
    badgeEnded: "Session ended",
    sessionEnded: "The session has ended.",
    sessionEndedCode: "The session has ended (exit code {{code}}).",
    reconnect: "Reconnect",
  },
  error: {
    terminalSpawnFailed: "Could not start the shell: {{message}}",
    terminalShellNotFound: "There is no shell at {{path}}.",
    terminalUnknownSession: "That terminal session is no longer open.",
  },
};

export default terminalEn;
