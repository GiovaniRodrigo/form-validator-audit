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
  printFilter: document.querySelector("#printFilter"),
  clearFilters: document.querySelector("#clearFilters"),
  downloadJson: document.querySelector("#downloadJson"),
  printReport: document.querySelector("#printReport"),
  printLayout: document.querySelector("#printLayout"),
  printModal: document.querySelector("#printModal"),
  printModalImage: document.querySelector("#printModalImage"),
  printModalMeta: document.querySelector("#printModalMeta"),
  closePrintModal: document.querySelector("#closePrintModal")
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
  const print = els.printFilter.value;
  const hasPrint = Boolean(page.validationPrint?.image);

  if (!pageMatches(page, els.filter.value.trim())) return false;
  if (status === "failed" && stats.failures === 0) return false;
  if (status === "passed" && stats.failures > 0) return false;
  if (framework !== "all" && !page.frameworkHints.includes(framework)) return false;
  if (hidden === "withHidden" && stats.hidden === 0) return false;
  if (hidden === "withoutHidden" && stats.hidden > 0) return false;
  if (print === "withPrint" && !hasPrint) return false;
  if (print === "withoutPrint" && hasPrint) return false;
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

const filteredSortedPages = () => sortedPages((audit.pages || []).filter(pagePassesFilters));

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

const validationPrint = (page) => {
  if (!page.validationPrint) return `<p class="muted">Nenhum print gerado para esta página.</p>`;
  if (page.validationPrint.image) {
    return `
      <button class="printThumb" type="button" data-print-url="${text(page.url)}">
        <img src="${page.validationPrint.image}" alt="Print dos erros de validação">
      </button>
      <p class="muted">Capturado em ${formatDate(page.validationPrint.capturedAt)}.</p>
    `;
  }
  return `<p class="muted">Print não capturado: ${text(page.validationPrint.error || "erro desconhecido")}.</p>`;
};

const renderPageRow = (page) => {
  const stats = pageStats(page);
  const failureKind = stats.failures ? "fail" : "ok";
  const title = page.title || "Página sem título";
  const frameworks = page.frameworkHints.length ? page.frameworkHints.map((item) => badge(item)).join("") : badge("nenhum");
  const printBadge = page.validationPrint?.image ? badge("print", "warn") : "";

  return `
    <tr>
      <td class="urlCell">
        <strong>${text(title)}</strong>
        <a href="${safeUrl(page.url)}" target="_blank" rel="noreferrer">${text(page.url)}</a>
      </td>
      <td>${page.forms.length}</td>
      <td>${stats.fields}</td>
      <td><div class="chipLine">${badge(stats.failures, failureKind)}${printBadge}</div></td>
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
            <section>
              <h3>Print de validação</h3>
              ${validationPrint(page)}
            </section>
          </div>
        </details>
      </td>
    </tr>
  `;
};

const renderPages = () => {
  const pages = filteredSortedPages();
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

const openPrintModal = (page) => {
  if (!page?.validationPrint?.image) return;
  els.printModalImage.src = page.validationPrint.image;
  els.printModalMeta.textContent = `${pageLabel(page)} · ${formatDate(page.validationPrint.capturedAt)}`;
  els.printModal.hidden = false;
  document.body.classList.add("modalOpen");
};

const closePrintModal = () => {
  els.printModal.hidden = true;
  els.printModalImage.removeAttribute("src");
  els.printModalMeta.textContent = "";
  document.body.classList.remove("modalOpen");
};

const filterSummaryText = () => {
  const filters = [
    els.filter.value.trim() ? `Texto: ${els.filter.value.trim()}` : "",
    els.statusFilter.value !== "all" ? `Status: ${els.statusFilter.options[els.statusFilter.selectedIndex].text}` : "",
    els.frameworkFilter.value !== "all" ? `Framework: ${els.frameworkFilter.value}` : "",
    els.hiddenFilter.value !== "all" ? `Ocultos: ${els.hiddenFilter.options[els.hiddenFilter.selectedIndex].text}` : "",
    els.printFilter.value !== "all" ? `Print: ${els.printFilter.options[els.printFilter.selectedIndex].text}` : ""
  ].filter(Boolean);
  return filters.length ? filters.join(" | ") : "Sem filtros aplicados";
};

const fieldRowsForPrint = (fields) => {
  if (!fields.length) return `<p class="printMuted">Nenhum campo encontrado.</p>`;
  return `
    <table class="printTable">
      <thead>
        <tr><th>Campo</th><th>Tipo</th><th>Nome/ID</th><th>Regras</th></tr>
      </thead>
      <tbody>
        ${fields.map((field) => {
          const rules = [
            field.required ? "obrigatório" : "",
            field.hidden ? "oculto" : "",
            field.readonly ? "somente leitura" : "",
            field.disabled ? "desabilitado" : "",
            field.minlength ? `minlength ${field.minlength}` : "",
            field.maxlength ? `maxlength ${field.maxlength}` : "",
            field.pattern ? `pattern ${field.pattern}` : "",
            field.min ? `min ${field.min}` : "",
            field.max ? `max ${field.max}` : ""
          ].filter(Boolean);
          return `
            <tr>
              <td>${text(field.label)}</td>
              <td>${text(field.type)}</td>
              <td>${text(field.name || field.id || field.selector)}</td>
              <td>${text(rules.join(", ") || "sem regra")}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
};

const failureRowsForPrint = (page) => {
  const failures = allTests(page).filter((test) => !test.passed);
  if (!failures.length) return `<p class="printMuted">Sem falhas de validação client-side.</p>`;
  return `
    <table class="printTable">
      <thead>
        <tr><th>Campo</th><th>Caso</th><th>Esperado</th><th>Obtido</th><th>Mensagem</th></tr>
      </thead>
      <tbody>
        ${failures.map((failure) => `
          <tr>
            <td>${text(failure.field)}</td>
            <td>${text(failure.case)}</td>
            <td>${text(failure.expected)}</td>
            <td>${text(failure.actual)}</td>
            <td>${text(failure.message || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
};

const hiddenListForPrint = (page) => {
  if (!page.hiddenComponents.length) return `<p class="printMuted">Nenhum componente oculto registrado.</p>`;
  return `
    <ul class="printList">
      ${page.hiddenComponents.map((item) => `<li>${text(item.tag)} | ${text(item.name || item.type || item.selector)} | ${text(item.reason)}</li>`).join("")}
    </ul>
  `;
};

const navigationListForPrint = (page) => {
  if (!page.navigationTargets.length) return `<p class="printMuted">Nenhum botão/link interno registrado.</p>`;
  return `
    <ul class="printList">
      ${page.navigationTargets.map((item) => `<li>${text(item.text || item.tag)} | ${text(item.url)}</li>`).join("")}
    </ul>
  `;
};

const printImageForPage = (page) => {
  if (!page.validationPrint?.image) return `<p class="printMuted">Sem print anexado.</p>`;
  return `
    <figure class="printFigure">
      <img src="${page.validationPrint.image}" alt="Print dos erros de validação">
      <figcaption>Capturado em ${formatDate(page.validationPrint.capturedAt)}</figcaption>
    </figure>
  `;
};

const renderPrintLayout = () => {
  const pages = filteredSortedPages();
  const summary = audit.summary || {};
  els.printLayout.innerHTML = `
    <header class="printHeader">
      <p>Form Test Auditor</p>
      <h1>Relatório de Formulários</h1>
      <div>${text(audit.origin || audit.rootUrl)}</div>
      <div>Gerado em ${formatDate(new Date().toISOString())}</div>
      <div>Filtros: ${text(filterSummaryText())}</div>
      <div>Ordenação: ${text(sortState.key)} ${text(sortState.direction)}</div>
    </header>

    <section class="printSection">
      <h2>Resumo</h2>
      <table class="printTable printSummaryTable">
        <tbody>
          <tr><th>Páginas filtradas</th><td>${pages.length}</td><th>Páginas auditadas</th><td>${summary.pages || 0}</td></tr>
          <tr><th>Formulários</th><td>${summary.forms || 0}</td><th>Campos</th><td>${summary.fields || 0}</td></tr>
          <tr><th>Testes</th><td>${summary.tests || 0}</td><th>Falhas</th><td>${summary.failedTests || 0}</td></tr>
          <tr><th>Ocultos</th><td>${(summary.hiddenFields || 0) + (summary.hiddenComponents || 0)}</td><th>Frameworks</th><td>${text((summary.frameworks || []).join(", ") || "Não identificado")}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="printSection">
      <h2>Páginas do filtro</h2>
      <table class="printTable">
        <thead>
          <tr><th>Página</th><th>Forms</th><th>Campos</th><th>Falhas</th><th>Ocultos</th><th>Print</th><th>Frameworks</th></tr>
        </thead>
        <tbody>
          ${pages.map((page) => {
            const stats = pageStats(page);
            return `
              <tr>
                <td>${text(pageLabel(page))}<br><span>${text(page.url)}</span></td>
                <td>${page.forms.length}</td>
                <td>${stats.fields}</td>
                <td>${stats.failures}</td>
                <td>${stats.hidden}</td>
                <td>${page.validationPrint?.image ? "sim" : "não"}</td>
                <td>${text(page.frameworkHints.join(", ") || "nenhum")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>

    ${pages.map((page, index) => {
      const stats = pageStats(page);
      return `
        <article class="printPage">
          <h2>${index + 1}. ${text(pageLabel(page))}</h2>
          <p class="printUrl">${text(page.url)}</p>
          <table class="printTable printSummaryTable">
            <tbody>
              <tr><th>Formulários</th><td>${page.forms.length}</td><th>Campos</th><td>${stats.fields}</td></tr>
              <tr><th>Falhas</th><td>${stats.failures}</td><th>Ocultos</th><td>${stats.hidden}</td></tr>
              <tr><th>Links/Botões</th><td>${stats.links}</td><th>Frameworks</th><td>${text(page.frameworkHints.join(", ") || "nenhum")}</td></tr>
            </tbody>
          </table>

          <section class="printSubsection">
            <h3>Formulários e campos</h3>
            ${page.forms.map((form) => `
              <h4>${text(form.name || form.id || `Formulário ${form.index + 1}`)} | ${text(form.method)} | ${text(form.action)}</h4>
              ${fieldRowsForPrint(form.fields)}
            `).join("") || `<p class="printMuted">Nenhum formulário encontrado.</p>`}
            ${page.orphanFields.length ? `<h4>Campos fora de formulário</h4>${fieldRowsForPrint(page.orphanFields)}` : ""}
          </section>

          <section class="printSubsection">
            <h3>Falhas de validação</h3>
            ${failureRowsForPrint(page)}
          </section>

          <section class="printSubsection">
            <h3>Componentes ocultos</h3>
            ${hiddenListForPrint(page)}
          </section>

          <section class="printSubsection">
            <h3>Botões e links internos</h3>
            ${navigationListForPrint(page)}
          </section>

          <section class="printSubsection">
            <h3>Print de validação</h3>
            ${printImageForPage(page)}
          </section>
        </article>
      `;
    }).join("")}
  `;
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
  els.printFilter.value = "all";
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
els.printFilter.addEventListener("change", renderPages);
els.clearFilters.addEventListener("click", resetFilters);
els.downloadJson.addEventListener("click", downloadJson);
els.printReport.addEventListener("click", () => {
  renderPrintLayout();
  window.print();
});
els.closePrintModal.addEventListener("click", closePrintModal);
els.printModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closePrintModal();
});
els.pagesList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-print-url]");
  if (!button) return;
  const page = (audit.pages || []).find((item) => item.url === button.dataset.printUrl);
  openPrintModal(page);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.printModal.hidden) closePrintModal();
});

loadAudit();
