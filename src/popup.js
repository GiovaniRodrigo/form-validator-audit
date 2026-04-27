const els = {
  origin: document.querySelector("#origin"),
  status: document.querySelector("#status"),
  start: document.querySelector("#start"),
  download: document.querySelector("#download"),
  openReport: document.querySelector("#openReport"),
  maxPages: document.querySelector("#maxPages"),
  maxDepth: document.querySelector("#maxDepth"),
  pages: document.querySelector("#pages"),
  forms: document.querySelector("#forms"),
  fields: document.querySelector("#fields"),
  failed: document.querySelector("#failed"),
  details: document.querySelector("#details")
};

let currentAuditId = null;
let pollTimer = null;
let latestAudit = null;

const send = (message) => chrome.runtime.sendMessage(message);

const setStatus = (status) => {
  els.status.textContent = status === "running" ? "Rodando" : status === "completed" ? "Concluído" : "Pronto";
  els.status.className = `status ${status || ""}`.trim();
  els.start.disabled = status === "running";
};

const render = (audit) => {
  latestAudit = audit;
  if (!audit) return;
  currentAuditId = audit.id;
  els.origin.textContent = audit.origin || audit.rootUrl;
  setStatus(audit.status);
  els.download.disabled = !audit.pages?.length;
  els.openReport.disabled = !audit.pages?.length;

  const summary = audit.summary || {};
  els.pages.textContent = summary.pages || 0;
  els.forms.textContent = summary.forms || 0;
  els.fields.textContent = summary.fields || 0;
  els.failed.textContent = summary.failedTests || 0;

  if (!audit.pages?.length && audit.status === "running") {
    els.details.textContent = `Visitadas: ${audit.visited || 0}. Fila: ${audit.queued || 0}.`;
    return;
  }

  const pages = (audit.pages || []).slice(-12).reverse();
  els.details.innerHTML = "";
  pages.forEach((page) => {
    const failed = [
      ...page.forms.flatMap((form) => form.tests.flatMap((test) => test.cases)),
      ...page.orphanFields.flatMap((field) => field.tests || [])
    ].filter((test) => !test.passed).length;

    const item = document.createElement("article");
    item.className = "page";
    item.innerHTML = `
      <h3></h3>
      <p></p>
      <div class="badgeRow">
        <span class="badge">${page.forms.length} forms</span>
        <span class="badge">${page.navigationTargets.length} botões/links</span>
        <span class="badge">${page.hiddenComponents.length} ocultos</span>
        <span class="badge fail">${failed} falhas</span>
      </div>
    `;
    item.querySelector("h3").textContent = page.title || page.url;
    item.querySelector("p").textContent = page.url;
    els.details.appendChild(item);
  });

  if (audit.errors?.length) {
    const error = document.createElement("div");
    error.className = "error";
    error.textContent = `${audit.errors.length} página(s) não puderam ser auditadas.`;
    els.details.appendChild(error);
  }
};

const poll = async () => {
  const response = await send({ type: "GET_AUDIT", id: currentAuditId });
  if (response.ok) render(response.audit);
  if (response.audit?.status !== "running" && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

els.start.addEventListener("click", async () => {
  setStatus("running");
  els.details.textContent = "Preparando rastreamento do domínio...";
  const response = await send({
    type: "START_AUDIT",
    options: {
      maxPages: Number(els.maxPages.value),
      maxDepth: Number(els.maxDepth.value)
    }
  });
  if (!response.ok) {
    setStatus("");
    els.details.textContent = response.error;
    return;
  }
  render(response.audit);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 1200);
});

els.download.addEventListener("click", () => {
  if (!latestAudit) return;
  const blob = new Blob([JSON.stringify(latestAudit, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `form-audit-${new URL(latestAudit.origin).hostname}-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.openReport.addEventListener("click", async () => {
  if (!latestAudit) return;
  await chrome.storage.local.set({ latestAudit });
  const url = chrome.runtime.getURL(`src/report.html#audit=${encodeURIComponent(latestAudit.id || "")}`);
  await chrome.tabs.create({ url });
});

send({ type: "GET_AUDIT" }).then((response) => {
  if (response.ok && response.audit) render(response.audit);
});
