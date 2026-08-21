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
    targetLocal: "This machine",
    targetSsh: "SSH",
    savedHosts: "Hosts",
    noHosts: "No host saved yet.",
    newHost: "New host",
    hostName: "Name",
    hostNamePlaceholder: "Production web server",
    host: "Host",
    port: "Port",
    username: "User",
    authMethod: "Authenticate with",
    authPassword: "Password",
    authPrivateKey: "Private key",
    password: "Password",
    privateKeyFile: "Private key file",
    keyPassphrase: "Key passphrase",
    saveHost: "Save host",
    updateHost: "Update host",
    deleteHost: "Delete",
    deleteHostTitle: "Delete host",
    deleteHostMessage:
      "Delete \u201c{{name}}\u201d? Its password is removed from the credential store too.",
    connect: "Connect",
    connecting: "Connecting\u2026",
  },
  error: {
    terminalSpawnFailed: "Could not start the shell: {{message}}",
    terminalShellNotFound: "There is no shell at {{path}}.",
    terminalUnknownSession: "That terminal session is no longer open.",
  },
};

export default terminalEn;
