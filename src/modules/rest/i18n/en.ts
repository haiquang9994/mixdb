/**
 * What the REST module calls things.
 *
 * Plain data, importing nothing from `src/i18n/`: `dicts.ts` imports this file, so anything
 * imported back out of there would close the circle. Groups stay flat at the top level, which is
 * what keeps every `t("rest.send")` resolving through the merged dictionary unchanged.
 */
const restEn = {
  rest: {
    newTabTitle: "New request",
    newRequest: "New request",
    untitled: "Untitled request",
    saved: "Saved",
    recent: "Recent ({{n}}/{{max}})",
    filterPlaceholder: "Filter requests",
    noSaved: "Nothing saved yet.",
    noRecent: "Requests you paste land here.",
    emptyMain: "Paste a cURL command here, or press New request.",
    resizeSidebar: "Drag to resize the sidebar",
    resizePanes: "Drag to resize the request and response panes",
    // Request pane
    method: "Method",
    methodSearch: "Search methods",
    urlPlaceholder: "https://example.com/path",
    send: "Send",
    cancel: "Cancel",
    sending: "Sending\u2026",
    paramsTab: "Params",
    bodyTab: "Body",
    requestHeadersTab: "Headers",
    keyColumn: "Key",
    valueColumn: "Value",
    rowEnabled: "Include this row",
    addRow: "Add row",
    removeRow: "Remove row",
    noRows: "Nothing here yet \u2014 type in the last row to add one.",
    bodyKind: "Body type",
    bodyNone: "None",
    bodyForm: "Form",
    bodyMultipart: "Multipart form",
    bodyBinary: "File",
    bodyNotEditable: "Sent as it stands \u2014 there is no editor for this kind of body yet.",
    langJson: "JSON",
    langXml: "XML",
    langYaml: "YAML",
    langText: "Plain text",
    bodyPlaceholder: "Request body",
    // Response pane
    responseEmpty: "Nothing sent yet.",
    cancelled: "Cancelled",
    previewTab: "Preview",
    sourceTab: "Source",
    rawTab: "Raw",
    responseHeadersTab: "Headers ({{n}})",
    totalTimeHint: "Total time, from the first byte sent to the last byte read",
    sizeHint: "Size of the response body",
    realSizeHint: "Cut for display \u2014 the body is really {{size}}",
    redirected: "Redirected",
    finalUrlHint: "Ended at {{url}}",
    wrapLines: "Wrap lines",
    loadExternal: "Load external resources",
    loadExternalHint:
      "Off by default: turning it on lets the page fetch images, styles and tracking pixels from the server it came from.",
    truncatedNotice: "Showing the first {{shown}} of {{total}}.",
    sourceTooBig:
      "The body is over {{limit}} \u2014 the tree is off so the app stays responsive. Raw still works.",
    binaryBody: "{{mime}} \u00b7 {{size}}",
    binaryHint: "Nothing to render for this type.",
    copyValue: "Copy value",
    copyPath: "Copy path",
    expandAll: "Expand",
    collapseAll: "Collapse",
    // Sidebar menu
    rename: "Rename",
    renameTitle: "Rename request",
    nameLabel: "Name",
    nameEmpty: "A request needs a name.",
    renameSubmit: "Rename",
    renameSaving: "Renaming\u2026",
    duplicate: "Duplicate",
    copyAsCurl: "Copy as cURL",
    pin: "Pin",
    pinHint: "Keep this request in Saved",
    delete: "Delete",
    deleteKeyHint: "Backspace or Delete removes the request the keyboard is on.",
    deleteTitle: "Delete this request?",
    deleteMessage: "\u201c{{name}}\u201d will be gone for good.",
    copySuffix: "{{name}} copy",
    // Shortcuts
    shortcutScope: "REST",
    shortcutSend: "Send the request",
    shortcutNewRequest: "New request",
    shortcutCloseRequest: "Close the request tab",
  },
  error: {
    restTimeout: "The request timed out. {{message}}",
    restConnect: "Could not reach the server. {{message}}",
    restRedirectLoop: "Too many redirects. {{message}}",
    restInvalidUrl: "That is not a URL the client can send to. {{message}}",
    restFileUnreadable: "Could not read {{path}}. {{message}}",
    restBuildFailed: "The request could not be built. {{message}}",
    /* Never shown as a banner \u2014 the status bar says "Cancelled" instead. It is a code rather
       than a flag on the response because a cancelled send has no response to put a flag on. */
    restCancelled: "The request was cancelled.",
  },
};

export type RestDict = typeof restEn;

export default restEn;
