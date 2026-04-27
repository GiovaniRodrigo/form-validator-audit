(() => {
  const FIELD_SELECTOR = [
    "input",
    "select",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "[role='combobox']",
    "[role='spinbutton']",
    "[role='checkbox']",
    "[role='radio']"
  ].join(",");

  const NAV_SELECTOR = [
    "a[href]",
    "area[href]",
    "button",
    "input[type='button']",
    "input[type='submit']",
    "input[type='image']",
    "[role='button']",
    "[role='link']",
    "[onclick]",
    "[data-href]",
    "[data-url]",
    "[data-route]",
    "[wire\\:click]",
    "[wire\\:submit]",
    "[x-on\\:click]",
    "[ng-click]",
    "[hx-get]",
    "[hx-post]",
    "[formaction]"
  ].join(",");

  const now = () => new Date().toISOString();

  const textOf = (node) =>
    (!node ? "" : node.innerText || node.textContent || node.value || node.getAttribute("aria-label") || node.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim();

  const queryAll = (selector, root = document) => {
    const found = [];
    const visit = (scope) => {
      const nodes = [...scope.querySelectorAll(selector)];
      nodes.forEach((node) => {
        found.push(node);
        if (node.shadowRoot) visit(node.shadowRoot);
      });
    };
    visit(root);
    return found;
  };

  const cssPath = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return "";
    const parts = [];
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.localName;
      if (current.id) {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const className = [...current.classList].slice(0, 2).map((item) => `.${CSS.escape(item)}`).join("");
      if (className) part += className;
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((item) => item.localName === current.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };

  const isHidden = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return Boolean(
      node.hidden ||
      node.type === "hidden" ||
      node.getAttribute("aria-hidden") === "true" ||
      node.closest("[hidden], [aria-hidden='true'], [inert]") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      rect.width === 0 ||
      rect.height === 0
    );
  };

  const normalizeUrl = (value, base = location.href) => {
    if (!value || /^(javascript:|mailto:|tel:|sms:|#)/i.test(value.trim())) return null;
    try {
      const url = new URL(value, base);
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };

  const extractUrlsFromText = (value) => {
    if (!value) return [];
    const matches = value.match(/(?:https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/g) || [];
    return matches.map((item) => normalizeUrl(item)).filter(Boolean);
  };

  const sameDomain = (url, origin) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };

  const frameworkHints = () => {
    const hints = new Set();
    const html = document.documentElement.outerHTML.slice(0, 300000);
    const checks = [
      ["Filament", /filament|fi-form|fi-input|wire:model/i],
      ["Livewire", /wire:|livewire/i],
      ["Laravel", /csrf-token|laravel/i],
      ["React", /__REACT_DEVTOOLS_GLOBAL_HOOK__|data-reactroot|react/i],
      ["Vue", /__VUE__|data-v-|v-model|vue/i],
      ["Angular", /ng-version|ng-|angular/i],
      ["Alpine.js", /x-data|x-on:|alpine/i],
      ["HTMX", /hx-get|hx-post|htmx/i]
    ];
    checks.forEach(([name, pattern]) => {
      if (pattern.test(html) || window[name]) hints.add(name);
    });
    if (window.React || window.ReactDOM) hints.add("React");
    if (window.Vue) hints.add("Vue");
    if (window.Alpine) hints.add("Alpine.js");
    if (window.Livewire) hints.add("Livewire");
    return [...hints];
  };

  const fieldLabel = (field) => {
    const id = field.id;
    const aria = field.getAttribute("aria-label") || field.getAttribute("aria-labelledby");
    const placeholder = field.getAttribute("placeholder");
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const implicit = field.closest("label");
    return textOf(explicit) || textOf(implicit) || aria || placeholder || field.name || field.id || field.getAttribute("role") || field.localName;
  };

  const describeField = (field, index) => ({
    index,
    selector: cssPath(field),
    label: fieldLabel(field),
    tag: field.localName,
    type: field.getAttribute("type") || field.getAttribute("role") || field.localName,
    name: field.getAttribute("name") || "",
    id: field.id || "",
    required: field.required || field.getAttribute("aria-required") === "true",
    disabled: field.disabled || field.getAttribute("aria-disabled") === "true",
    readonly: field.readOnly || field.getAttribute("aria-readonly") === "true",
    hidden: isHidden(field),
    autocomplete: field.getAttribute("autocomplete") || "",
    minlength: field.getAttribute("minlength") || "",
    maxlength: field.getAttribute("maxlength") || "",
    min: field.getAttribute("min") || "",
    max: field.getAttribute("max") || "",
    step: field.getAttribute("step") || "",
    pattern: field.getAttribute("pattern") || "",
    options: field.localName === "select" ? [...field.options].map((option) => option.value || textOf(option)).slice(0, 30) : []
  });

  const candidateValues = (field) => {
    const type = (field.getAttribute("type") || field.getAttribute("role") || field.localName).toLowerCase();
    const required = field.required || field.getAttribute("aria-required") === "true";
    const values = [];

    if (required) values.push({ name: "vazio obrigatório", value: "", expected: "invalid" });
    if (type === "email") values.push({ name: "email inválido", value: "email-invalido", expected: "invalid" }, { name: "email válido", value: "tester@example.com", expected: "valid" });
    else if (type === "url") values.push({ name: "url inválida", value: "site-invalido", expected: "invalid" }, { name: "url válida", value: "https://example.com", expected: "valid" });
    else if (["number", "range", "spinbutton"].includes(type)) {
      const min = Number(field.getAttribute("min"));
      const max = Number(field.getAttribute("max"));
      if (Number.isFinite(min)) values.push({ name: "menor que mínimo", value: String(min - 1), expected: "invalid" });
      if (Number.isFinite(max)) values.push({ name: "maior que máximo", value: String(max + 1), expected: "invalid" });
      values.push({ name: "não numérico", value: "abc", expected: "invalid" }, { name: "número comum", value: String(Number.isFinite(min) ? min : 1), expected: "valid" });
    } else if (type === "date") values.push({ name: "data inválida", value: "0001-01-01", expected: "invalid" }, { name: "data válida", value: "2026-04-27", expected: "valid" });
    else if (type === "time") values.push({ name: "hora inválida", value: "25:99", expected: "invalid" }, { name: "hora válida", value: "12:30", expected: "valid" });
    else if (type === "checkbox" || type === "radio") values.push({ name: "desmarcado", checked: false, expected: required ? "invalid" : "valid" }, { name: "marcado", checked: true, expected: "valid" });
    else if (field.localName === "select") values.push({ name: "sem seleção", value: "", expected: required ? "invalid" : "valid" });
    else {
      const minLength = Number(field.getAttribute("minlength"));
      const maxLength = Number(field.getAttribute("maxlength"));
      const pattern = field.getAttribute("pattern");
      if (Number.isFinite(minLength) && minLength > 1) values.push({ name: "menor que minlength", value: "a".repeat(minLength - 1), expected: "invalid" });
      if (Number.isFinite(maxLength) && maxLength > 0) values.push({ name: "maior que maxlength", value: "a".repeat(maxLength + 1), expected: "invalid" });
      if (pattern) values.push({ name: "fora do pattern", value: "valor-fora-do-padrao", expected: "invalid" });
      values.push({ name: "texto comum", value: "Valor de teste", expected: "valid" });
    }

    return values.slice(0, 8);
  };

  const setNativeValue = (field, testCase) => {
    if ("checked" in testCase) {
      field.checked = testCase.checked;
    } else if (field.isContentEditable) {
      field.textContent = testCase.value;
    } else if ("value" in field) {
      field.value = testCase.value;
    } else {
      field.setAttribute("aria-valuetext", testCase.value);
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  const readValidity = (field) => {
    if (typeof field.checkValidity !== "function") {
      return { valid: true, message: "", validity: {} };
    }
    const validity = {};
    Object.keys(ValidityState.prototype).forEach((key) => {
      if (typeof field.validity[key] === "boolean") validity[key] = field.validity[key];
    });
    return {
      valid: field.checkValidity(),
      message: field.validationMessage || "",
      validity
    };
  };

  const testField = (field) => {
    if (field.disabled || field.readOnly || isHidden(field)) return [];
    const original = {
      value: field.value,
      checked: field.checked,
      text: field.textContent
    };
    const cases = candidateValues(field);
    const results = cases.map((testCase) => {
      try {
        setNativeValue(field, testCase);
        const validity = readValidity(field);
        return {
          case: testCase.name,
          value: "value" in testCase ? testCase.value : undefined,
          checked: "checked" in testCase ? testCase.checked : undefined,
          expected: testCase.expected,
          actual: validity.valid ? "valid" : "invalid",
          passed: testCase.expected === (validity.valid ? "valid" : "invalid"),
          message: validity.message,
          validity: validity.validity
        };
      } catch (error) {
        return {
          case: testCase.name,
          expected: testCase.expected,
          actual: "error",
          passed: false,
          message: error.message
        };
      }
    });

    if ("checked" in field) field.checked = original.checked;
    if ("value" in field) field.value = original.value;
    if (field.isContentEditable) field.textContent = original.text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return results;
  };

  const findNavigationTargets = (origin) => {
    const targets = [];
    queryAll(NAV_SELECTOR).forEach((node) => {
      const attributes = ["href", "formaction", "data-href", "data-url", "data-route", "hx-get", "hx-post"];
      const urls = attributes.map((attr) => normalizeUrl(node.getAttribute(attr))).filter(Boolean);
      extractUrlsFromText(node.getAttribute("onclick")).forEach((url) => urls.push(url));
      extractUrlsFromText(node.getAttribute("wire:click")).forEach((url) => urls.push(url));
      extractUrlsFromText(node.getAttribute("x-on:click")).forEach((url) => urls.push(url));
      extractUrlsFromText(node.getAttribute("ng-click")).forEach((url) => urls.push(url));
      const form = node.closest("form");
      if (form) {
        const action = normalizeUrl(form.getAttribute("action") || location.href);
        if (action) urls.push(action);
      }
      urls.filter((url) => sameDomain(url, origin)).forEach((url) => {
        targets.push({
          url,
          selector: cssPath(node),
          text: textOf(node).slice(0, 120),
          tag: node.localName,
          type: node.getAttribute("type") || node.getAttribute("role") || ""
        });
      });
    });
    return targets;
  };

  const findDirectoryTargets = (origin) => {
    const urls = new Set([location.origin, location.href]);
    queryAll("a[href], link[href], script[src], img[src], form[action]").forEach((node) => {
      const raw = node.getAttribute("href") || node.getAttribute("src") || node.getAttribute("action");
      const url = normalizeUrl(raw);
      if (url && sameDomain(url, origin)) {
        const parsed = new URL(url);
        urls.add(parsed.href);
        const parts = parsed.pathname.split("/").filter(Boolean);
        let path = "";
        parts.forEach((part) => {
          path += `/${part}`;
          urls.add(`${parsed.origin}${path}/`);
        });
      }
    });
    return [...urls];
  };

  const inspectForms = () => {
    const allFields = queryAll(FIELD_SELECTOR);
    const formFieldSet = new Set();
    const forms = queryAll("form").map((form, formIndex) => {
      const formFields = queryAll(FIELD_SELECTOR, form);
      formFields.forEach((field) => formFieldSet.add(field));
      const fields = formFields.map(describeField);
      return {
        index: formIndex,
        selector: cssPath(form),
        id: form.id || "",
        name: form.getAttribute("name") || "",
        method: (form.getAttribute("method") || "get").toUpperCase(),
        action: normalizeUrl(form.getAttribute("action") || location.href),
        hidden: isHidden(form),
        fields,
        tests: fields.map((field) => {
          const node = formFields[field.index];
          return {
            field: field.label,
            selector: field.selector,
            cases: node ? testField(node) : []
          };
        })
      };
    });

    const orphanFields = allFields
      .filter((field) => !formFieldSet.has(field))
      .map(describeField)
      .map((field) => ({
        ...field,
        tests: testField(allFields.find((node) => cssPath(node) === field.selector))
      }));

    return { forms, orphanFields };
  };

  const origin = location.origin;
  const formData = inspectForms();
  const hiddenComponents = queryAll("body *")
    .filter(isHidden)
    .slice(0, 250)
    .map((node) => ({
      selector: cssPath(node),
      tag: node.localName,
      text: textOf(node).slice(0, 100),
      type: node.getAttribute("type") || "",
      name: node.getAttribute("name") || "",
      reason: node.hidden ? "hidden attribute" : node.getAttribute("aria-hidden") === "true" ? "aria-hidden" : window.getComputedStyle(node).display === "none" ? "display none" : "not visible"
    }));

  return {
    auditedAt: now(),
    url: location.href,
    title: document.title,
    origin,
    frameworkHints: frameworkHints(),
    directories: findDirectoryTargets(origin),
    navigationTargets: findNavigationTargets(origin),
    hiddenComponents,
    ...formData
  };
})();
