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
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tempo excedido ao carregar a página"));
    }, 30000);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

const auditPage = async (url) => {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/auditor.js"]
    });
    return result?.result;
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
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
      await chrome.storage.local.set({ latestAudit: publicState(state) });
    }
    state.status = "completed";
    state.finishedAt = new Date().toISOString();
    await chrome.storage.local.set({ latestAudit: publicState(state) });
  } finally {
    state.workerActive = false;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AUDIT") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.url || !/^https?:/.test(tab.url)) {
        sendResponse({ ok: false, error: "Abra uma página HTTP/HTTPS para iniciar a auditoria." });
        return;
      }
      sendResponse({ ok: true, audit: createAudit(tab, message.options) });
    });
    return true;
  }

  if (message.type === "GET_AUDIT") {
    const current = message.id ? audits.get(message.id) : [...audits.values()].at(-1);
    if (current) {
      sendResponse({ ok: true, audit: publicState(current) });
      return false;
    }
    chrome.storage.local.get("latestAudit").then(({ latestAudit }) => {
      sendResponse({ ok: true, audit: latestAudit || null });
    });
    return true;
  }

  if (message.type === "EXPORT_AUDIT") {
    const current = message.id ? audits.get(message.id) : [...audits.values()].at(-1);
    sendResponse({ ok: Boolean(current), audit: current ? publicState(current) : null });
    return false;
  }

  return false;
});
