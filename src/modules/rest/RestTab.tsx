import { useEffect, useMemo, useRef, useState } from "react";
import Splitter, { clampRatio, clampSize } from "../../components/Splitter";
import { Tab, TabStrip, tabKeyDown } from "../../components/TabStrip";
import { errorMessage } from "../../core/errors";
import { modalDepth, useShortcut } from "../../core/shortcuts";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import { CANCELLED, decodeBase64, restCancel, restSend } from "./api";
import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";
import { detectBody, type ViewMode } from "./contentType";
import BodyEditor from "./components/BodyEditor";
import ResponsePane, { IDLE_SEND, type SendState } from "./components/ResponsePane";
import KeyValueTable from "./components/KeyValueTable";
import RequestList from "./components/RequestList";
import RequestTabs from "./components/RequestTabs";
import UrlBar from "./components/UrlBar";
import { shortUrl } from "./format";
import { parsePaste } from "./parsePaste";
import { findRequest, isBlank } from "./requests";
import {
  addRequest,
  createRequest,
  currentLists,
  deleteRequest,
  pasteOverBlank,
  pasteRequest,
  pinRequest,
  saveRequest,
  useRequestLists,
} from "./requestsStore";
import { paramsFromUrl, urlWithParams } from "./syncUrlParams";
import type { RestRequest } from "./types";
import {
  MAX_SIDEBAR_WIDTH,
  MAX_SPLIT_RATIO,
  MIN_SIDEBAR_WIDTH,
  MIN_SPLIT_RATIO,
  setSidebarWidth,
  setSplitRatio,
  useWorkspace,
} from "./workspace";
import "./rest.css";

type RequestTabKey = "params" | "body" | "headers";

/**
 * The REST client's workspace: the request list, the requests open on it, and the pane each one
 * is edited and answered in.
 *
 * **Nothing here is a draft.** Every edit is written straight through to the request in the shared
 * store, so closing a tab loses nothing, two REST tabs cannot overwrite each other, and there is
 * no Save button, no dirty mark and no dialog asking whether to keep anything. Which requests are
 * open is the only state that lives in this component, and it is the only state the app does not
 * remember — the shell keeps no tabs either.
 */
function RestTab({ active, onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const lists = useRequestLists();
  const workspace = useWorkspace();

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [requestTabs, setRequestTabs] = useState<Record<string, RequestTabKey>>({});
  const [sends, setSends] = useState<Record<string, SendState>>({});
  const [preferredModes, setPreferredModes] = useState<Record<string, ViewMode>>({});
  const [headersOpen, setHeadersOpen] = useState<Record<string, boolean>>({});

  const [width, setWidth] = useState(workspace.sidebarWidth);
  const [ratio, setRatio] = useState(workspace.splitRatio);
  const dragFrom = useRef(0);
  const panesRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  /** The request whose URL box is still owed the keyboard — set by New, cleared once given. */
  const [focusUrlFor, setFocusUrlFor] = useState<string | null>(null);

  // The workspace file is read once, after the first render — so the furniture starts at its
  // defaults and moves to what was saved when it arrives.
  useEffect(() => setWidth(workspace.sidebarWidth), [workspace.sidebarWidth]);
  useEffect(() => setRatio(workspace.splitRatio), [workspace.splitRatio]);

  const label = (request: RestRequest) =>
    request.name !== "" ? request.name : shortUrl(request.url) || t("rest.untitled");

  /* The open tabs, resolved afresh from the store: a request edited anywhere shows its new name
     here, and one deleted from the sidebar takes its tab with it. */
  const tabs = useMemo(
    () => openIds.map((id) => findRequest(lists, id)).filter((r): r is RestRequest => r !== undefined),
    [openIds, lists],
  );
  /**
   * The request actually on screen, and its id.
   *
   * `activeId` is what was last *chosen*, and it can name a tab that has just been closed or a
   * request that has just been deleted — for the one render before the effects below catch up.
   * Resolving through `tabs` and falling back to the last of them means that in-between state is
   * never drawn: without it, closing one of two untitled tabs shows the shell's tab renamed to
   * "New request" for a frame before it settles on the neighbour.
   */
  const activeRequest = tabs.find((r) => r.id === activeId) ?? tabs[tabs.length - 1];
  const currentId = activeRequest?.id ?? null;

  /* The shell's tab is named after whatever is open in it. Keyed on the name rather than on the
     request, because every keystroke replaces the request with an equal one. */
  const title = activeRequest ? label(activeRequest) : t("rest.newTabTitle");
  useEffect(() => {
    onTitleChange(title);
  }, [title, onTitleChange]);

  // A tab whose request is gone stops being open, and the keyboard lands on the one beside it.
  useEffect(() => {
    setOpenIds((prev) => {
      const next = prev.filter((id) => findRequest(lists, id) !== undefined);
      // `filter` always allocates; returning that would re-render the workspace on every keystroke,
      // since every edit publishes a new list.
      return next.length === prev.length ? prev : next;
    });
  }, [lists]);
  useEffect(() => {
    if (activeId !== null && !openIds.includes(activeId)) {
      setActiveId(openIds[openIds.length - 1] ?? null);
    }
  }, [openIds, activeId]);

  useEffect(() => {
    if (focusUrlFor === null || activeRequest?.id !== focusUrlFor) return;
    urlRef.current?.focus();
    setFocusUrlFor(null);
  }, [focusUrlFor, activeRequest]);

  function open(id: string) {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }

  /**
   * Closing a tab, and taking the request with it when there is nothing in it.
   *
   * Where the keyboard lands next is decided here rather than left to the effect above, so both
   * pieces of state change in the same commit: the effect would run a render later, and that render
   * is one whose active tab has already gone.
   *
   * The request is read from the store rather than from `lists`: this may run from a shortcut whose
   * handler was made several keystrokes ago, and what matters is the request as it stands now.
   */
  function close(id: string) {
    const next = openIds.filter((openId) => openId !== id);
    setOpenIds(next);
    if (activeId === id) setActiveId(next[next.length - 1] ?? null);
    const request = findRequest(currentLists(), id);
    if (request !== undefined && isBlank(request)) deleteRequest(id);
  }

  function makeRequest() {
    const request = createRequest();
    open(request.id);
    // The URL is the only thing a new request needs, so that is where the keyboard goes. Asked for
    // by id and not done here: the box does not exist until the tab this just opened has rendered.
    setFocusUrlFor(request.id);
  }

  function duplicate(request: RestRequest) {
    const copy: RestRequest = {
      ...structuredClone(request),
      id: crypto.randomUUID(),
      name: t("rest.copySuffix", { name: label(request) }),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      // A copy is something someone chose to have, whatever the original was.
      origin: "manual",
    };
    addRequest(copy);
    open(copy.id);
  }

  /** An edit to the request on screen. Everything in the request pane goes through this. */
  function edit(patch: Partial<RestRequest>) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, ...patch });
  }

  /** The URL box changed: the Params table is rewritten from it. */
  function editUrl(url: string) {
    if (!activeRequest) return;
    saveRequest({
      ...activeRequest,
      url,
      params: paramsFromUrl(url, activeRequest.params, () => crypto.randomUUID()),
    });
  }

  /** The Params table changed: the URL is rewritten from it. */
  function editParams(params: RestRequest["params"]) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, params, url: urlWithParams(activeRequest.url, params) });
  }

  /**
   * A paste in the URL box that turned out to be a cURL command.
   *
   * A tab nobody has put anything into is filled where it stands, and the request moves to Recent
   * with it — pressing New to have somewhere to paste into is not a decision to keep the result. A
   * tab with anything in it is left alone and the paste opens a tab of its own, which destroys
   * nothing and so needs no undo.
   *
   * Returns whether the paste was taken, which is what stops the box also receiving it.
   */
  function pasteInto(text: string): boolean {
    const parsed = parsePaste(text, () => crypto.randomUUID());
    if (parsed === null) return false;
    const filled =
      activeRequest !== undefined && isBlank(activeRequest)
        ? pasteOverBlank(activeRequest, parsed)
        : pasteRequest(parsed);
    // The same id when the husk was filled in place; a different one when a duplicate was found in
    // Recent, and then it is that row's tab which comes forward.
    open(filled.id);
    return true;
  }

  /**
   * Sends the request on screen.
   *
   * `lastUsedAt` is stamped here and nowhere else — opening a tab to look at a request does not
   * count as using it, which is what keeps Recent's ceiling honest from Phase 2 on.
   */
  async function send() {
    if (!activeRequest) return;
    const request = activeRequest;
    const sendId = crypto.randomUUID();
    const wire = buildRequest(request, sendId, PHASE_ONE_SETTINGS);

    setSends((prev) => ({
      ...prev,
      [request.id]: {
        ...(prev[request.id] ?? IDLE_SEND),
        phase: "sending",
        sendId,
        sentUrl: wire.url,
        error: null,
      },
    }));
    saveRequest({ ...request, lastUsedAt: Date.now() });

    try {
      const response = await restSend(wire);
      const bytes = decodeBase64(response.body_base64);
      setSends((prev) => ({
        ...prev,
        [request.id]: {
          phase: "done",
          sendId: null,
          sentUrl: wire.url,
          response,
          bytes,
          detected: detectBody(response.headers, bytes),
          error: null,
        },
      }));
    } catch (e) {
      // Cancelling is not a failure, and a failure leaves the previous response where it was —
      // the banner says what happened, and the pane still holds what is being compared against.
      const cancelled =
        typeof e === "object" && e !== null && (e as { code?: string }).code === CANCELLED;
      setSends((prev) => ({
        ...prev,
        [request.id]: {
          ...(prev[request.id] ?? IDLE_SEND),
          phase: cancelled ? "cancelled" : "failed",
          sendId: null,
          error: cancelled ? null : errorMessage(t, e),
        },
      }));
    }
  }

  function cancel() {
    const sendId = currentId === null ? null : sends[currentId]?.sendId;
    if (sendId) void restCancel(sendId);
  }

  /**
   * The other way in: pasting a command with no request open at all.
   *
   * Without this the only paste target is a URL box, so a command could not be pasted without
   * pressing New first — and since a blank request is filled where it stands, that first paste
   * would never reach Recent. The empty screen says both ways in; this is the one it names first.
   *
   * Listened for on the document because nothing in an empty workspace holds the keyboard, so the
   * event has no element of ours to fire on. Which is also why the guards are needed: a paste aimed
   * at a text box is that box's, and a dialog or menu that is up holds the keyboard the same way it
   * holds every shortcut.
   */
  useEffect(() => {
    if (!active || activeRequest !== undefined) return;
    function onPaste(event: ClipboardEvent) {
      if (modalDepth() !== 0) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea") !== null)
      ) {
        return;
      }
      if (pasteInto(event.clipboardData?.getData("text") ?? "")) event.preventDefault();
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // `pasteInto` is remade every render but reads only `activeRequest`, which is in the list, so
    // the handler this subscribed is never one render behind what it decides from.
  }, [active, activeRequest]);

  const requestTab = currentId === null ? "params" : (requestTabs[currentId] ?? "params");
  const sendState = currentId === null ? IDLE_SEND : (sends[currentId] ?? IDLE_SEND);

  /* `active` — the prop, not the open request — is what keeps the REST tabs behind this one
     quiet: all of them stay mounted, and all of them would otherwise answer the same keystroke. */
  useShortcut(
    "rest.send",
    () => void send(),
    active && activeRequest !== undefined && sendState.phase !== "sending",
  );
  useShortcut("rest.newRequest", makeRequest, active);
  // Only while there is a request tab to close — otherwise the chord is the shell's, as before.
  useShortcut(
    "rest.closeRequest",
    () => currentId !== null && close(currentId),
    active && currentId !== null,
  );

  const paneTabs: { key: RequestTabKey; label: string }[] = [
    { key: "params", label: t("rest.paramsTab") },
    { key: "body", label: t("rest.bodyTab") },
    { key: "headers", label: t("rest.requestHeadersTab") },
  ];

  return (
    <div className="rest-tab">
      <aside className="rest-sidebar" style={{ width }}>
        <RequestList
          lists={lists}
          activeId={currentId}
          onOpen={open}
          onNew={makeRequest}
          onSave={saveRequest}
          onDuplicate={duplicate}
          onPin={pinRequest}
          onDelete={deleteRequest}
        />
      </aside>

      <Splitter
        orientation="vertical"
        ariaLabel={t("rest.resizeSidebar")}
        title={t("rest.resizeSidebar")}
        onDragStart={() => {
          dragFrom.current = width;
        }}
        onDrag={(delta) =>
          setWidth(clampSize(dragFrom.current, delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
        }
        onDragEnd={(delta) =>
          setSidebarWidth(clampSize(dragFrom.current, delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
        }
      />

      <div className="rest-main">
        <RequestTabs
          tabs={tabs}
          activeId={currentId}
          onSelect={setActiveId}
          onClose={close}
          onNew={makeRequest}
          label={label}
        />

        {activeRequest === undefined ? (
          <p className="rest-empty muted">{t("rest.emptyMain")}</p>
        ) : (
          <div className="rest-panes" ref={panesRef}>
            <section className="rest-request-pane" style={{ flex: `0 0 ${ratio * 100}%` }}>
              <UrlBar
                inputRef={urlRef}
                method={activeRequest.method}
                url={activeRequest.url}
                sending={sendState.phase === "sending"}
                onMethodChange={(method) => edit({ method })}
                onUrlChange={editUrl}
                onPasteText={pasteInto}
                onSend={() => void send()}
                onCancel={cancel}
              />
              <TabStrip size="small" role="tablist">
                {paneTabs.map((tab) => {
                  const pick = () =>
                    setRequestTabs((prev) => ({ ...prev, [activeRequest.id]: tab.key }));
                  return (
                    <Tab
                      key={tab.key}
                      active={requestTab === tab.key}
                      role="tab"
                      aria-selected={requestTab === tab.key}
                      tabIndex={0}
                      onClick={pick}
                      onKeyDown={tabKeyDown(pick)}
                    >
                      {tab.label}
                    </Tab>
                  );
                })}
              </TabStrip>
              <div className="rest-pane-body">
                {requestTab === "params" && (
                  <KeyValueTable rows={activeRequest.params} onChange={editParams} />
                )}
                {requestTab === "body" && (
                  <BodyEditor body={activeRequest.body} onChange={(body) => edit({ body })} />
                )}
                {requestTab === "headers" && (
                  <KeyValueTable rows={activeRequest.headers} onChange={(headers) => edit({ headers })} />
                )}
              </div>
            </section>

            <Splitter
              orientation="vertical"
              ariaLabel={t("rest.resizePanes")}
              title={t("rest.resizePanes")}
              onDragStart={() => {
                dragFrom.current = ratio;
              }}
              onDrag={(delta) =>
                setRatio(
                  clampRatio(
                    dragFrom.current,
                    delta,
                    panesRef.current?.clientWidth ?? 0,
                    MIN_SPLIT_RATIO,
                    MAX_SPLIT_RATIO,
                  ),
                )
              }
              onDragEnd={(delta) =>
                setSplitRatio(
                  clampRatio(
                    dragFrom.current,
                    delta,
                    panesRef.current?.clientWidth ?? 0,
                    MIN_SPLIT_RATIO,
                    MAX_SPLIT_RATIO,
                  ),
                )
              }
            />

            <section className="rest-response-pane">
              <ResponsePane
                state={sendState}
                preferred={currentId === null ? "preview" : (preferredModes[currentId] ?? "preview")}
                onPreferredChange={(mode) =>
                  setPreferredModes((prev) => ({ ...prev, [activeRequest.id]: mode }))
                }
                headersOpen={headersOpen[activeRequest.id] ?? false}
                onHeadersOpenChange={(open) =>
                  setHeadersOpen((prev) => ({ ...prev, [activeRequest.id]: open }))
                }
                onDismissError={() =>
                  setSends((prev) => ({
                    ...prev,
                    [activeRequest.id]: { ...(prev[activeRequest.id] ?? IDLE_SEND), error: null },
                  }))
                }
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default RestTab;
