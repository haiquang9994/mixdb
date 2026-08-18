import { useEffect, useMemo, useRef, useState } from "react";
import Splitter, { clampRatio, clampSize } from "../../components/Splitter";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import BodyEditor from "./components/BodyEditor";
import KeyValueTable from "./components/KeyValueTable";
import RequestList from "./components/RequestList";
import RequestTabs from "./components/RequestTabs";
import UrlBar from "./components/UrlBar";
import { shortUrl } from "./format";
import { findRequest } from "./requests";
import {
  addRequest,
  createRequest,
  deleteRequest,
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
function RestTab({ onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const lists = useRequestLists();
  const workspace = useWorkspace();

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [requestTabs, setRequestTabs] = useState<Record<string, RequestTabKey>>({});

  const [width, setWidth] = useState(workspace.sidebarWidth);
  const [ratio, setRatio] = useState(workspace.splitRatio);
  const dragFrom = useRef(0);
  const panesRef = useRef<HTMLDivElement>(null);

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
  const activeRequest = activeId === null ? undefined : findRequest(lists, activeId);

  // The shell's tab is named after whatever is open in it.
  useEffect(() => {
    onTitleChange(activeRequest ? label(activeRequest) : t("rest.newTabTitle"));
  }, [activeRequest, onTitleChange, t]);

  // A tab whose request is gone stops being open, and the keyboard lands on the one beside it.
  useEffect(() => {
    setOpenIds((prev) => prev.filter((id) => findRequest(lists, id) !== undefined));
  }, [lists]);
  useEffect(() => {
    if (activeId !== null && !openIds.includes(activeId)) {
      setActiveId(openIds[openIds.length - 1] ?? null);
    }
  }, [openIds, activeId]);

  function open(id: string) {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }

  function close(id: string) {
    setOpenIds((prev) => prev.filter((openId) => openId !== id));
  }

  function makeRequest() {
    open(createRequest().id);
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
      params: paramsFromUrl(url, activeRequest.params, crypto.randomUUID),
    });
  }

  /** The Params table changed: the URL is rewritten from it. */
  function editParams(params: RestRequest["params"]) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, params, url: urlWithParams(activeRequest.url, params) });
  }

  const requestTab = activeId === null ? "params" : (requestTabs[activeId] ?? "params");

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
          activeId={activeId}
          onOpen={open}
          onNew={makeRequest}
          onSave={saveRequest}
          onDuplicate={duplicate}
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
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          label={label}
        />

        {activeRequest === undefined ? (
          <p className="rest-empty muted">{t("rest.emptyMain")}</p>
        ) : (
          <div className="rest-panes" ref={panesRef}>
            <section className="rest-request-pane" style={{ flex: `0 0 ${ratio * 100}%` }}>
              <UrlBar
                method={activeRequest.method}
                url={activeRequest.url}
                sending={false}
                onMethodChange={(method) => edit({ method })}
                onUrlChange={editUrl}
                onSend={() => {}}
                onCancel={() => {}}
              />
              <div className="rest-pane-tabs" role="tablist">
                {paneTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={requestTab === tab.key}
                    className={`rest-pane-tab${requestTab === tab.key ? " rest-pane-tab-active" : ""}`}
                    onClick={() => setRequestTabs((prev) => ({ ...prev, [activeRequest.id]: tab.key }))}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
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
              <p className="rest-empty muted">{t("rest.responseEmpty")}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default RestTab;
