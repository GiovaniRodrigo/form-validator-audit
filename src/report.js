const els = {
  subtitle: document.querySelector("#subtitle"),
  statusBadge: document.querySelector("#statusBadge"),
  pages: document.querySelector("#pages"),
  forms: document.querySelector("#forms"),
  fields: document.querySelector("#fields"),
  failed: document.querySelector("#failed"),
  hidden: document.querySelector("#hidden"),
  overview: document.querySelector("#overview"),
  pagesList: document.querySelector("#pagesList"),
  errors: document.querySelector("#errors"),
  filter: document.querySelector("#filter"),
  downloadJson: document.querySelector("#downloadJson"),
  printReport: document.querySelector("#printReport")
};

let audit = null;

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

const formatDate = (value) => {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
};

const allTests = (page) => [
  ...page.forms.flatMap((form) => form.tests.flatMap((test) => test.cases.map((item) => ({ ...item, field: test.field })))),
  ...page.orphanFields.flatMap((field) => (field.tests || []).map((item) => ({ ...item, field: field.label })))
];

const pageMatches = (page, term) => {
  if (!term) return true;
  const haystack = [
    page.title,
    page.url,
    ...page.frameworkHints,
    ...page.forms.flatMap((form) => form.fields.flatMap((field) => [field.label, field.name, field.type, field.selector])),
    ...allTests(page).flatMap((test) => [test.field, test.case, test.message, test.actual])
  ]
    .map(rawText)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
};

const badge = (label, kind = "") => `<span class="badge ${kind}">${label}</span>`;

const renderSummary = () => {
  const summary = audit.summary || {};
  els.pages.textContent = summary.pages || 0;
  els.forms.textContent = summary.forms || 0;
  els.fields.textContent = summary.fields || 0;
  els.failed.textContent = summary.failedTests || 0;
  els.hidden.textContent = (summary.hiddenFields || 0) + (summary.hiddenComponents || 0);

  els.subtitle.textContent = `${audit.origin || audit.rootUrl} · iniciado em ${formatDate(audit.startedAt)} · finalizado em ${formatDate(audit.finishedAt)}`;
  els.statusBadge.textContent = audit.status === "completed" ? "Concluído" : audit.status === "running" ? "Em execução" : "Pronto";
  els.statusBadge.className = `badge ${audit.status === "completed" ? "ok" : audit.status === "running" ? "warn" : ""}`.trim();

  const frameworks = summary.frameworks?.length ? summary.frameworks.join(", ") : "Nenhum framework identificado por heurística";
  const failedText = summary.failedTests ? `${summary.failedTests} teste(s) divergiram do esperado` : "Nenhum teste com falha detectado";
  els.overview.innerHTML = `
    <div class="overviewItem"><strong>Domínio</strong><span>${text(audit.origin || audit.rootUrl)}</span></div>
    <div class="overviewItem"><strong>Frameworks prováveis</strong><span>${frameworks}</span></div>
    <div class="overviewItem"><strong>Resultado dos testes</strong><span>${failedText}</span></div>
    <div class="overviewItem"><strong>Limites usados</strong><span>${audit.limits?.maxPages || 0} páginas, profundidade ${audit.limits?.maxDepth || 0}</span></div>
  `;
};

const renderFieldRows = (fields, testsBySelector) => {
  if (!fields.length) return `<p class="empty">Nenhum campo encontrado neste bloco.</p>`;
  const rows = fields.map((field) => {
    const cases = testsBySelector.get(field.selector) || [];
    const failed = cases.filter((item) => !item.passed);
    const result = failed.length ? badge(`${failed.length} falha(s)`, "fail") : badge("ok", "ok");
    const rules = [
      field.required ? "obrigatório" : "",
      field.hidden ? "oculto" : "",
      field.readonly ? "somente leitura" : "",
      field.disabled ? "desabilitado" : "",
      field.minlength ? `min ${field.minlength}` : "",
      field.maxlength ? `max ${field.maxlength}` : "",
      field.pattern ? "pattern" : ""
    ].filter(Boolean);
    return `
      <tr>
        <td><strong>${text(field.label)}</strong><br><span>${text(field.name || field.id || field.selector)}</span></td>
        <td>${text(field.type)}</td>
        <td>${rules.length ? rules.map((item) => badge(item)).join(" ") : badge("sem regra")}</td>
        <td>${result}</td>
      </tr>
    `;
  });
  return `
    <table class="fieldTable">
      <thead><tr><th>Campo</th><th>Tipo</th><th>Regras</th><th>Testes</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
};

const renderFailures = (page) => {
  const failures = allTests(page).filter((test) => !test.passed);
  if (!failures.length) return "";
  return `
    <div class="formBlock">
      <p class="blockTitle">Falhas encontradas</p>
      <ul class="smallList">
        ${failures.slice(0, 30).map((test) => `
          <li><strong>${text(test.field)}:</strong> ${text(test.case)} esperava ${text(test.expected)}, recebeu ${text(test.actual)}. ${text(test.message)}</li>
        `).join("")}
      </ul>
    </div>
  `;
};

const renderPage = (page) => {
  const testsBySelector = new Map();
  page.forms.forEach((form) => form.tests.forEach((test) => testsBySelector.set(test.selector, test.cases)));
  page.orphanFields.forEach((field) => testsBySelector.set(field.selector, field.tests || []));
  const failures = allTests(page).filter((test) => !test.passed).length;

  const forms = page.forms.map((form) => `
    <div class="formBlock">
      <p class="blockTitle">Formulário ${form.name || form.id || form.index + 1} · ${form.method} · ${text(form.action)}</p>
      ${renderFieldRows(form.fields, testsBySelector)}
    </div>
  `).join("");

  const orphan = page.orphanFields.length ? `
    <div class="formBlock">
      <p class="blockTitle">Campos fora de formulário</p>
      ${renderFieldRows(page.orphanFields, testsBySelector)}
    </div>
  ` : "";

  const hidden = page.hiddenComponents.length ? `
    <div class="hiddenBlock">
      <p class="blockTitle">Componentes ocultos mais relevantes</p>
      <ul class="smallList">
        ${page.hiddenComponents.slice(0, 12).map((item) => `<li>${text(item.tag)} · ${text(item.name || item.type || item.selector)} · ${text(item.reason)}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  const links = page.navigationTargets.length ? `
    <div class="linkBlock">
      <p class="blockTitle">Botões e links que podem levar a formulários</p>
      <ul class="smallList">
        ${page.navigationTargets.slice(0, 12).map((item) => `<li>${text(item.text || item.tag)} · ${text(item.url)}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  return `
    <article class="pageCard">
      <div class="pageHead">
        <h3>${text(page.title || "Página sem título")}</h3>
        <a href="${safeUrl(page.url)}" target="_blank" rel="noreferrer">${text(page.url)}</a>
        <div class="meta">
          ${badge(`${page.forms.length} forms`)}
          ${badge(`${page.orphanFields.length} campos soltos`)}
          ${badge(`${page.hiddenComponents.length} ocultos`, page.hiddenComponents.length ? "warn" : "")}
          ${badge(`${failures} falhas`, failures ? "fail" : "ok")}
          ${page.frameworkHints.map((item) => badge(item)).join("")}
        </div>
      </div>
      ${renderFailures(page)}
      ${forms || ""}
      ${orphan}
      ${hidden}
      ${links}
    </article>
  `;
};

const renderPages = () => {
  const term = els.filter.value.trim();
  const pages = (audit.pages || []).filter((page) => pageMatches(page, term));
  els.pagesList.innerHTML = pages.length ? pages.map(renderPage).join("") : `<p class="empty">Nenhuma página corresponde ao filtro.</p>`;
};

const renderErrors = () => {
  const errors = audit.errors || [];
  els.errors.innerHTML = errors.length
    ? errors.map((item) => `<div class="errorItem"><strong>${text(item.url)}</strong><span>${text(item.message)} · ${formatDate(item.at)}</span></div>`).join("")
    : `<p class="empty">Nenhum erro de rastreamento registrado.</p>`;
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
    els.pagesList.innerHTML = `<p class="empty">Nenhum dado disponível.</p>`;
    return;
  }

  renderSummary();
  renderPages();
  renderErrors();
};

els.filter.addEventListener("input", renderPages);
els.downloadJson.addEventListener("click", downloadJson);
els.printReport.addEventListener("click", () => window.print());

loadAudit();
