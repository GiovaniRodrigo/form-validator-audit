import browser from "./browser-api.js";

const DEFAULT_LIMITS = {
  maxPages: 50,
  maxDepth: 4
};

const audits = new Map();

const createAudit = (tab, options = {}) => {
  const rootUrl = new URL(tab.url);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const limits = {
    maxPages: Number(options.maxPages) || DEFAULT_LIMITS.maxPages,
    maxDepth: Number(options.maxDepth) || DEFAULT_LIMITS.maxDepth
  };
  const state = {
    id,
    rootUrl: rootUrl.href,
    origin: rootUrl.origin,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    limits,
    queue: [{ url: rootUrl.href, depth: 0, source: "initial" }],
    visited: [],
    seen: new Set([rootUrl.href]),
    pages: [],
    errors: []
  };
  audits.set(id, state);
  runQueue(id);
  return publicState(state);
};

const publicState = (state) => ({
  id: state.id,
  rootUrl: state.rootUrl,
  origin: state.origin,
  status: state.status,
  startedAt: state.startedAt,
  finishedAt: state.finishedAt,
  limits: state.limits,
  queued: state.queue.length,
  visited: state.visited.length,
  pages: state.pages,
  errors: state.errors,
  summary: summarize(state)
});

const summarize = (state) => {
  const fields = state.pages.flatMap((page) => [
    ...page.forms.flatMap((form) => form.fields),
    ...page.orphanFields
  ]);
  const tests = state.pages.flatMap((page) => [
    ...page.forms.flatMap((form) => form.tests.flatMap((test) => test.cases)),
    ...page.orphanFields.flatMap((field) => field.tests || [])
  ]);
  return {
    pages: state.pages.length,
    forms: state.pages.reduce((count, page) => count + page.forms.length, 0),
    fields: fields.length,
    hiddenFields: fields.filter((field) => field.hidden).length,
    hiddenComponents: state.pages.reduce((count, page) => count + page.hiddenComponents.length, 0),
    linksAndButtons: state.pages.reduce((count, page) => count + page.navigationTargets.length, 0),
    tests: tests.length,
    failedTests: tests.filter((test) => !test.passed).length,
    frameworks: [...new Set(state.pages.flatMap((page) => page.frameworkHints))]
  };
};

const normalizeUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
};

const enqueue = (state, url, depth, source) => {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  const parsed = new URL(normalized);
  if (parsed.origin !== state.origin) return;
  if (state.seen.has(normalized)) return;
  if (state.seen.size >= state.limits.maxPages) return;
  state.seen.add(normalized);
  state.queue.push({ url: normalized, depth, source });
};

const parseUrls = (text, baseUrl) => {
  const urls = new Set();
  const urlMatches = text.match(/https?:\/\/[^\s<>"']+/g) || [];
  urlMatches.forEach((url) => urls.add(url));

  const locMatches = text.match(/<loc>\s*([^<]+)\s*<\/loc>/gi) || [];
  locMatches.forEach((item) => {
    const value = item.replace(/<\/?loc>/gi, "").trim();
    if (value) urls.add(value);
  });

  const pathMatches = text.match(/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g) || [];
  pathMatches.forEach((path) => urls.add(new URL(path, baseUrl).href));

  return [...urls];
};

const discoverPublishedUrls = async (state) => {
  const candidates = [`${state.origin}/sitemap.xml`, `${state.origin}/robots.txt`];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) continue;
      const text = await response.text();
      parseUrls(text, url).forEach((found) => enqueue(state, found, 1, url));
    } catch (error) {
      state.errors.push({
        url,
        message: `Não foi possível ler mapa público: ${error.message}`,
        at: new Date().toISOString()
      });
    }
  }
};

const waitForTab = (tabId) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tempo excedido ao carregar a página"));
    }, 30000);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);
  });

const validationFailures = (page) => [
  ...page.forms.flatMap((form) => form.tests.flatMap((test) =>
    test.cases
      .filter((item) => !item.passed)
      .map((item) => ({
        field: test.field,
        case: item.case,
        expected: item.expected,
        actual: item.actual,
        message: item.message
      }))
  )),
  ...page.orphanFields.flatMap((field) =>
    (field.tests || [])
      .filter((item) => !item.passed)
      .map((item) => ({
        field: field.label,
        case: item.case,
        expected: item.expected,
        actual: item.actual,
        message: item.message
      }))
  )
];

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const debuggerApi = browser.debugger || globalThis.chrome?.debugger;

const debuggerCommand = (target, method, params = {}) => {
  if (browser.debugger?.sendCommand) return browser.debugger.sendCommand(target, method, params);
  if (!debuggerApi) return Promise.reject(new Error("API debugger indisponível neste navegador."));

  return new Promise((resolve, reject) => {
    debuggerApi.sendCommand(target, method, params, (result) => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
};

const attachDebugger = (target) => {
  if (browser.debugger?.attach) return browser.debugger.attach(target, "1.3");
  if (!debuggerApi) return Promise.reject(new Error("API debugger indisponível neste navegador."));

  return new Promise((resolve, reject) => {
    debuggerApi.attach(target, "1.3", () => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
};

const detachDebugger = (target) => {
  if (browser.debugger?.detach) return browser.debugger.detach(target).catch(() => undefined);
  if (!debuggerApi) return Promise.resolve();

  return new Promise((resolve) => {
    debuggerApi.detach(target, () => resolve());
  });
};

const showValidationOverlay = (failures) => {
  const existing = document.querySelector("#form-test-auditor-print-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("aside");
  overlay.id = "form-test-auditor-print-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "max-width:min(520px,calc(100vw - 36px))",
    "max-height:55vh",
    "overflow:auto",
    "padding:14px",
    "border:2px solid #b42318",
    "border-radius:8px",
    "background:#fff",
    "color:#17202a",
    "box-shadow:0 18px 48px rgba(16,24,40,.22)",
    "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  ].join(";");

  const title = document.createElement("strong");
  title.textContent = `Form Test Auditor: ${failures.length} erro(s) de validação`;
  title.style.cssText = "display:block;margin-bottom:8px;color:#b42318;font-size:14px";
  overlay.appendChild(title);

  const list = document.createElement("ol");
  list.style.cssText = "display:grid;gap:6px;margin:0;padding-left:20px";
  failures.slice(0, 8).forEach((failure) => {
    const item = document.createElement("li");
    item.textContent = `${failure.field}: ${failure.case} esperava ${failure.expected}, recebeu ${failure.actual}${failure.message ? ` - ${failure.message}` : ""}`;
    list.appendChild(item);
  });
  overlay.appendChild(list);
  document.documentElement.appendChild(overlay);
};

const removeValidationOverlay = () => {
  document.querySelector("#form-test-auditor-print-overlay")?.remove();
};

const captureValidationPrint = async (tab, page) => {
  const failures = validationFailures(page);
  if (!failures.length) return null;
  const target = { tabId: tab.id };
  let attached = false;

  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: showValidationOverlay,
      args: [failures]
    });
    await wait(500);
    await attachDebugger(target);
    attached = true;
    await debuggerCommand(target, "Page.enable");
    const screenshot = await debuggerCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: removeValidationOverlay
    }).catch(() => undefined);

    return {
      capturedAt: new Date().toISOString(),
      reason: "validation-error",
      failures: failures.slice(0, 20),
      image: `data:image/png;base64,${screenshot.data}`,
      captureMode: "hidden-debugger"
    };
  } catch (error) {
    return {
      capturedAt: new Date().toISOString(),
      reason: "validation-error",
      error: error.message,
      failures: failures.slice(0, 20)
    };
  } finally {
    if (attached) await detachDebugger(target);
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: removeValidationOverlay
    }).catch(() => undefined);
  }
};

const auditPage = async (url) => {
  const tab = await browser.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/auditor.js"]
    });
    const page = result?.result;
    if (page) {
      const validationPrint = await captureValidationPrint(tab, page);
      if (validationPrint) page.validationPrint = validationPrint;
    }
    return page;
  } finally {
    if (tab.id) await browser.tabs.remove(tab.id).catch(() => undefined);
  }
};

const runQueue = async (auditId) => {
  const state = audits.get(auditId);
  if (!state || state.workerActive) return;
  state.workerActive = true;

  try {
    await discoverPublishedUrls(state);
    while (state.queue.length && state.visited.length < state.limits.maxPages) {
      const item = state.queue.shift();
      state.visited.push(item.url);
      try {
        const page = await auditPage(item.url);
        if (!page) throw new Error("Auditoria da página não retornou dados");
        state.pages.push(page);
        if (item.depth < state.limits.maxDepth) {
          page.directories.forEach((url) => enqueue(state, url, item.depth + 1, "directory"));
          page.navigationTargets.forEach((target) => enqueue(state, target.url, item.depth + 1, target.selector));
        }
      } catch (error) {
        state.errors.push({
          url: item.url,
          message: error.message,
          at: new Date().toISOString()
        });
      }
      await browser.storage.local.set({ latestAudit: publicState(state) });
    }
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    await browser.storage.local.set({ latestAudit: publicState(state) });
  } finally {
    state.workerActive = false;
  }
};

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === "START_AUDIT") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      return { ok: false, error: "Abra uma página HTTP/HTTPS para iniciar a auditoria." };
    }
    return { ok: true, audit: createAudit(tab, message.options) };
  }

  if (message.type === "GET_AUDIT") {
    const current = message.id ? audits.get(message.id) : [...audits.values()].at(-1);
    if (current) {
      return { ok: true, audit: publicState(current) };
    }
    const { latestAudit } = await browser.storage.local.get("latestAudit");
    return { ok: true, audit: latestAudit || null };
  }

  if (message.type === "EXPORT_AUDIT") {
    const current = message.id ? audits.get(message.id) : [...audits.values()].at(-1);
    return { ok: Boolean(current), audit: current ? publicState(current) : null };
  }

  return { ok: false, error: "Mensagem desconhecida." };
});
