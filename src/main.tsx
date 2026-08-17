import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import App from "./shell/App";
import { I18nProvider } from "./i18n";
import { blockNativeContextMenu } from "./nativeContextMenu";

blockNativeContextMenu();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
