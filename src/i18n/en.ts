const en = {
  common: {
    host: "Host",
    port: "Port",
    user: "User",
    password: "Password",
    database: "Database",
    connect: "Connect",
    disconnect: "Disconnect",
    save: "Save",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    duplicate: "Duplicate",
    browse: "Browse...",
    close: "Close",
    loading: "Loading...",
    // Why anything that would write is greyed out, wherever in the workspace it is. One sentence
    // rather than one per panel: it is the same fact, and it names where to undo it.
    readOnlyConnection: "This connection is marked read-only. Change it from the connection's right-click menu.",
    // The same fact in the space a badge has: beside the name in the sidebar, and in the tab of a
    // connection that is already open.
    readOnly: "Read-only",
  },
  app: {
    settings: "Settings",
    closeTab: "Close tab",
    newConnectionTab: "New connection tab",
    newConnectionTitle: "New Connection",
    /* What each module is called in the `[+]` menu — see `shell/registry.ts`, which is the list
       the menu is built from. */
    moduleDatabase: "Database",
    moduleRest: "REST",
    moduleTerminal: "Terminal",
  },
  pagination: {
    previousPage: "Previous page",
    nextPage: "Next page",
    status: "Page {{page}} of {{pageCount}} \u00b7 {{total}} rows",
    perPage: "{{n}} / page",
  },
  select: {
    placeholder: "Select...",
    noOptions: "No options",
    noMatches: "No matches",
    searchPlaceholder: "Search...",
  },
  errorBanner: {
    dismiss: "Dismiss error",
  },
  settings: {
    title: "Settings",
    close: "Close",
    appearance: "Appearance",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    accent: "Accent colour",
    accentBlue: "Blue",
    accentIndigo: "Indigo",
    accentViolet: "Violet",
    accentMagenta: "Magenta",
    accentOrange: "Orange",
    accentAmber: "Amber",
    accentGreen: "Green",
    accentTeal: "Teal",
    accentCyan: "Cyan",
    accentSlate: "Slate",
    glass: "Liquid glass",
    glassOff: "Off",
    glassOn: "On",
    glassHint: "Frosts and bends what is behind the layers that float over your data — menus, dropdowns, tooltips, the update toast and the loading pill. Dialogs become a frosted sheet over the window rather than a solid card, a grid's pinned header frosts the rows sliding under it, and the page and its controls take the same material. Off by default; it leans on the graphics card, so turn it off again if anything stutters.",
    language: "Language",
    languageEnglish: "English",
    languageVietnamese: "Ti\u1ebfng Vi\u1ec7t",
  },
  // The Ctrl/Cmd chords the app answers, as Settings lists them. A module's own chords are named in
  // that module's dictionary, beside the rest of its words — see `src/i18n/dicts.ts`, which will
  // not let two dictionaries claim the same group.
  shortcuts: {
    title: "Shortcuts",
    scope: {
      app: "App",
    },
    newTab: "New tab",
    // One row per module, filled from the module's own name — see `shell/shortcuts.ts`.
    newModuleTab: "New {{module}} tab",
    closeTab: "Close tab",
    reload: "Reload the pane on screen",
  },
  // Finding, fetching and installing a newer MixDB. The download runs in the background; the
  // install closes the app, so it never happens without the user pressing the button for it.
  update: {
    title: "Updates",
    available: "MixDB {{version}} is out",
    runningNow: "You are running {{version}}",
    updateNow: "Update now",
    downloading: "Downloading\u2026 {{percent}}%",
    downloadingUnknown: "Downloading\u2026",
    downloaded: "MixDB {{version}} is ready to install.",
    restartNow: "Install and restart",
    installing: "Installing\u2026",
    restartHint: "MixDB will close for a moment and reopen on the new version.",
    later: "Later",
    skip: "Skip this one",
    skipped: "{{version}} is being skipped.",
    unskip: "Tell me again",
    checkNow: "Check now",
    checking: "Checking...",
    upToDate: "This is the newest version.",
    notCheckedYet: "Not checked yet.",
    checkFailed: "The check failed: {{message}}",
    failed: "The update failed: {{message}}",
    lastChecked: "Last checked {{at}}.",
    openPage: "Open the download page",
    moreChanges: "and {{count}} more",
    autoHint:
      "MixDB updates itself. Each update is checked against MixDB's signing key before it is installed, so nothing unsigned by this project can reach you this way.",
  },
  // What a failed backend command says. The keys here are the `code` an `AppError` carries \u2014 see
  // src-tauri/src/error.rs \u2014 and `{{message}}` is where a driver's own words go, untranslated
  // because they are the server talking and the part worth searching for.
  error: {
    // SSH
    sshTimeout:
      "The SSH connection to {{host}}:{{port}} timed out after {{seconds}}s \u2014 check the host, the port and the firewall.",
    sshConnectFailed: "Cannot reach the SSH server: {{message}}",
    sshAuthFailed: "SSH authentication failed: {{message}}",
    sshShellFailed: "Could not open a shell on the SSH server: {{message}}",
    sshAuthRejected:
      "The SSH server rejected the login (partial success: {{partialSuccess}}). It accepts: {{methods}}.",
    sshHostKeyChanged:
      "The SSH server at {{endpoint}} is offering a different key than the one MixDB saw before ({{fingerprint}} now, {{known}} before). Either the server was rebuilt, or something is standing between you and it. If the change was expected, remove its entry from {{file}} and connect again.",
    cannotReadPrivateKey: "Cannot read the private key file: {{message}}",
    invalidPrivateKey: "That is not a private key MixDB can read: {{message}}",
    cannotBindTunnelPort: "Cannot open a local port for the tunnel: {{message}}",
    cannotSaveKnownHost: "Cannot remember the server's key: {{message}}",
    sshUnavailable:
      "The SSH tunnel is not open at the moment \u2014 MixDB is trying to open it again.",
    // Saved passwords
    credentialStoreUnreachable: "Cannot reach the system credential store: {{message}}",
    cannotSavePassword: "Cannot save the password: {{message}}",
    cannotReadPassword: "Cannot read the saved password back: {{message}}",
    cannotRemovePassword: "Cannot remove the saved password: {{message}}",

    // The two both layers raise: a directory the app makes for itself, and work handed to a
    // background thread. The database module emits these as well, and reads them from here.
    cannotCreateDirectory: "Cannot create {{path}}: {{message}}",
    backgroundTaskFailed: "The task did not finish: {{message}}",
    // The one error in here the webview raises rather than the backend. Said out loud because the
    // alternative is a copy that did nothing and a paste, somewhere else, of what was there before.
    clipboard: "Nothing was copied — the clipboard refused: {{message}}",
    clipboardRead: "Nothing was pasted — the clipboard refused: {{message}}",
    /** An error shape MixDB doesn't recognise \u2014 shown as-is rather than swallowed. */
    unknown: "{{message}}",
  },
};

/** The half of the dictionary no module owns. `src/i18n/dicts.ts` merges it with each module's. */
export type SharedDict = typeof en;

export default en;
