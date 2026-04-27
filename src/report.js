const els = {
  subtitle: document.querySelector("#subtitle"),
  statusBadge: document.querySelector("#statusBadge"),
  pages: document.querySelector("#pages"),
  forms: document.querySelector("#forms"),
  fields: document.querySelector("#fields"),
  failed: document.querySelector("#failed"),
  hidden: document.querySelector("#hidden"),
  overview: document.querySelector("#overview"),
  testChart: document.querySelector("#testChart"),
  testChartLabel: document.querySelector("#testChartLabel"),
  pageBars: document.querySelector("#pageBars"),
  pagesList: document.querySelector("#pagesList"),
  errors: document.querySelector("#errors"),
  resultCount: document.querySelector("#resultCount"),
  filter: document.querySelector("#filter"),
  statusFilter: document.querySelector("#statusFilter"),
  frameworkFilter: document.querySelector("#frameworkFilter"),
  hiddenFilter: document.querySelector("#hiddenFilter"),
  clearFilters: document.querySelector("#clearFilters"),
  downloadJson: document.querySelector("#downloadJson"),
  printReport: document.querySelector("#printReport")
};

let audit = null;
let sortState = {
  key: "failures",
  direction: "desc"
};

const send = (message) => chrome.runtime.sendMessage(message);
const rawText = (value) => String(value ?? "");

const text = (value) =>
  rawText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? text(url.href) : "#";
  } catch {
    return "#";
  }
};

const pageLabel = (page) => {
  if (page.title) return page.title;
  try {
    const path = new URL(page.url).pathname;
    return path === "/" ? page.url : path;
  } catch {
    return page.url || "Página";
  }
};

const formatDate = (value) => {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
};

const allFields = (page) => [
  ...page.forms.flatMap((form) => form.fields),
  ...page.orphanFields
];

const allTests = (page) => [
  ...page.forms.flatMap((form) => form.tests.flatMap((test) => test.cases.map((item) => ({ ...item, field: test.field })))),
  ...page.orphanFields.flatMap((field) => (field.tests || []).map((item) => ({ ...item, field: field.label })))
];

const pageStats = (page) => {
  const fields = allFields(page);
  const tests = allTests(page);
  return {
    fields: fields.length,
    failures: tests.filter((test) => !test.passed).length,
    hidden: fields.filter((field) => field.hidden).length + page.hiddenComponents.length,
    links: page.navigationTargets.length
  };
};

const sortValue = (page, key) => {
  const stats = pageStats(page);
  const values = {
    title: pageLabel(page).toLowerCase(),
    forms: page.forms.length,
    fields: stats.fields,
    failures: stats.failures,
    hidden: stats.hidden,
    frameworks: page.frameworkHints.join(", ").toLowerCase()
  };
  return values[key] ?? "";
};

const pageMatches = (page, term) => {
  if (!term) return true;
  const haystack = [
    page.title,
    page.url,
    ...page.frameworkHints,
    ...allFields(page).flatMap((field) => [field.label, field.name, field.type, field.selector]),
    ...allTests(page).flatMap((test) => [test.field, test.case, test.message, test.actual])
  ]
    .map(rawText)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
};

const pagePassesFilters = (page) => {
  const stats = pageStats(page);
  const status = els.statusFilter.value;
  const framework = els.frameworkFilter.value;
  const hidden = els.hiddenFilter.value;

  if (!pageMatches(page, els.filter.value.trim())) return false;
  if (status === "failed" && stats.failures === 0) return false;
  if (status === "passed" && stats.failures > 0) return false;
  if (framework !== "all" && !page.frameworkHints.includes(framework)) return false;
  if (hidden === "withHidden" && stats.hidden === 0) return false;
  if (hidden === "withoutHidden" && stats.hidden > 0) return false;
  return true;
};

const sortedPages = (pages) => {
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...pages].sort((a, b) => {
    const aValue = sortValue(a, sortState.key);
    const bValue = sortValue(b, sortState.key);
    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * direction;
    }
    return String(aValue).localeCompare(String(bValue), "pt-BR", { numeric: true }) * direction;
  });
};

const badge = (label, kind = "") => `<span class="badge ${kind}">${text(label)}</span>`;

const renderSummary = () => {
  const summary = audit.summary || {};
  const hiddenTotal = (summary.hiddenFields || 0) + (summary.hiddenComponents || 0);

  els.pages.textContent = summary.pages || 0;
  els.forms.textContent = summary.forms || 0;
  els.fields.textContent = summary.fields || 0;
  els.failed.textContent = summary.failedTests || 0;
  els.hidden.textContent = hiddenTotal;

  els.subtitle.textContent = `${audit.origin || audit.rootUrl} · iniciado em ${formatDate(audit.startedAt)} · finalizado em ${formatDate(audit.finishedAt)}`;
  els.statusBadge.textContent = audit.status === "completed" ? "Concluído" : audit.status === "running" ? "Em execução" : "Pronto";
  els.statusBadge.className = `badge ${audit.status === "completed" ? "ok" : audit.status === "running" ? "warn" : ""}`.trim();

  const frameworks = summary.frameworks?.length ? summary.frameworks.join(", ") : "Não identificado";
  els.overview.innerHTML = `
    <div class="overviewLine"><span>Domínio</span><strong>${text(audit.origin || audit.rootUrl)}</strong></div>
    <div class="overviewLine"><span>Frameworks</span><strong>${text(frameworks)}</strong></div>
    <div class="overviewLine"><span>Botões/links</span><strong>${summary.linksAndButtons || 0}</strong></div>
    <div class="overviewLine"><span>Limite</span><strong>${audit.limits?.maxPages || 0} páginas · profundidade ${audit.limits?.maxDepth || 0}</strong></div>
  `;
};

const renderFilterOptions = () => {
  const frameworks = [...new Set((audit.pages || []).flatMap((page) => page.frameworkHints))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  els.frameworkFilter.innerHTML = `
    <option value="all">Todos os frameworks</option>
    ${frameworks.map((item) => `<option value="${text(item)}">${text(item)}</option>`).join("")}
  `;
};

const renderCharts = () => {
  const summary = audit.summary || {};
  const totalTests = summary.tests || 0;
  const failed = summary.failedTests || 0;
  const passed = Math.max(totalTests - failed, 0);
  const failedPercent = totalTests ? Math.round((failed / totalTests) * 100) : 0;

  els.testChart.style.setProperty("--fail", `${failedPercent}%`);
  els.testChart.innerHTML = `<strong>${failedPercent}%</strong><span>falhas</span>`;
  els.testChartLabel.textContent = `${passed} corretos · ${failed} com falha · ${totalTests} testes`;

  const rows = (audit.pages || [])
    .map((page) => ({ page, stats: pageStats(page) }))
    .sort((a, b) => b.stats.failures - a.stats.failures || b.stats.fields - a.stats.fields)
    .slice(0, 8);
  const max = Math.max(...rows.map((row) => row.stats.fields + row.stats.failures + row.stats.hidden), 1);

  els.pageBars.innerHTML = rows.length
    ? rows.map(({ page, stats }) => {
      const total = stats.fields + stats.failures + stats.hidden;
      const width = Math.max((total / max) * 100, 4);
      const label = pageLabel(page);
      return `
        <div class="barRow">
          <span title="${text(page.url)}">${text(label)}</span>
          <div class="barTrack"><i style="width: ${width}%"></i></div>
          <strong>${total}</strong>
        </div>
      `;
    }).join("")
    : `<p class="empty compact">Sem páginas para exibir.</p>`;
};

const compactFailures = (page) => {
  const failures = allTests(page).filter((test) => !test.passed).slice(0, 8);
  if (!failures.length) return `<p class="muted">Sem falhas nos testes client-side.</p>`;
  return `
    <ul class="miniList">
      ${failures.map((test) => `<li><strong>${text(test.field)}:</strong> ${text(test.case)} · esperado ${text(test.expected)}, obtido ${text(test.actual)} ${test.message ? `· ${text(test.message)}` : ""}</li>`).join("")}
    </ul>
  `;
};

const compactFields = (page) => {
  const fields = allFields(page).slice(0, 16);
  if (!fields.length) return `<p class="muted">Nenhum campo encontrado.</p>`;
  return `
    <div class="fieldChips">
      ${fields.map((field) => badge(`${field.label || field.name || field.type} · ${field.type}`, field.hidden ? "warn" : "")).join("")}
    </div>
  `;
};

const renderPageRow = (page) => {
  const stats = pageStats(page);
  const failureKind = stats.failures ? "fail" : "ok";
  const title = page.title || "Página sem título";
  const frameworks = page.frameworkHints.length ? page.frameworkHints.map((item) => badge(item)).join("") : badge("nenhum");

  return `
    <tr>
      <td class="urlCell">
        <strong>${text(title)}</strong>
        <a href="${safeUrl(page.url)}" target="_blank" rel="noreferrer">${text(page.url)}</a>
      </td>
      <td>${page.forms.length}</td>
      <td>${stats.fields}</td>
      <td>${badge(stats.failures, failureKind)}</td>
      <td>${badge(stats.hidden, stats.hidden ? "warn" : "")}</td>
      <td><div class="chipLine">${frameworks}</div></td>
      <td>
        <details>
          <summary>Ver</summary>
          <div class="detailGrid">
            <section>
              <h3>Campos</h3>
              ${compactFields(page)}
            </section>
            <section>
              <h3>Falhas</h3>
              ${compactFailures(page)}
            </section>
            <section>
              <h3>Navegação</h3>
              <p class="muted">${stats.links} botão(ões)/link(s) com possível redirecionamento interno.</p>
            </section>
          </div>
        </details>
      </td>
    </tr>
  `;
};

const renderPages = () => {
  const pages = sortedPages((audit.pages || []).filter(pagePassesFilters));
  els.resultCount.textContent = `${pages.length} de ${(audit.pages || []).length} página(s)`;
  updateSortIndicators();
  els.pagesList.innerHTML = pages.length
    ? pages.map(renderPageRow).join("")
    : `<tr><td colspan="7" class="empty">Nenhuma página corresponde ao filtro.</td></tr>`;
};

const updateSortIndicators = () => {
  document.querySelectorAll("[data-sort]").forEach((button) => {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle("activeSort", active);
    button.dataset.direction = active ? sortState.direction : "";
    button.setAttribute("aria-sort", active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none");
  });
};

const renderErrors = () => {
  const errors = audit.errors || [];
  els.errors.innerHTML = errors.length
    ? errors.map((item) => `<div class="errorItem"><strong>${text(item.url)}</strong><span>${text(item.message)} · ${formatDate(item.at)}</span></div>`).join("")
    : `<p class="empty compact">Nenhum erro de rastreamento registrado.</p>`;
};

const downloadJson = () => {
  if (!audit) return;
  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const hostname = new URL(audit.origin || audit.rootUrl).hostname;
  link.download = `form-audit-${hostname}-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const loadAudit = async () => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const id = params.get("audit");
  const response = await send({ type: "GET_AUDIT", id });
  audit = response?.audit;
  if (!audit) {
    const stored = await chrome.storage.local.get("latestAudit");
    audit = stored.latestAudit;
  }

  if (!audit) {
    els.subtitle.textContent = "Nenhum relatório encontrado. Execute uma auditoria pelo popup da extensão.";
    els.pagesList.innerHTML = `<tr><td colspan="7" class="empty">Nenhum dado disponível.</td></tr>`;
    return;
  }

  renderSummary();
  renderFilterOptions();
  renderCharts();
  renderPages();
  renderErrors();
};

const resetFilters = () => {
  els.filter.value = "";
  els.statusFilter.value = "all";
  els.frameworkFilter.value = "all";
  els.hiddenFilter.value = "all";
  renderPages();
};

document.querySelectorAll("[data-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState = {
        key,
        direction: ["title", "frameworks"].includes(key) ? "asc" : "desc"
      };
    }
    renderPages();
  });
});

els.filter.addEventListener("input", renderPages);
els.statusFilter.addEventListener("change", renderPages);
els.frameworkFilter.addEventListener("change", renderPages);
els.hiddenFilter.addEventListener("change", renderPages);
els.clearFilters.addEventListener("click", resetFilters);
els.downloadJson.addEventListener("click", downloadJson);
els.printReport.addEventListener("click", () => window.print());

loadAudit();
