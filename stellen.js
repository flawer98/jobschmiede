
(function () {
  "use strict";

  /* ========= Konfiguration ========= */
  const WEBHOOKS = {
    save: "https://hook.eu2.make.com/krje3ftzgbomitzs8ca8a5f5mc5c5bhf",
    update: "https://hook.eu2.make.com/update-cms-item",
    uploadSingle: "https://hook.integromat.com/yyyyy",
    uploadBatch: "https://hook.integromat.com/zzzzz",
    list: "https://hook.eu2.make.com/1thp5v89ydmjmr6oaz9zfea0h5alnpky",
    uploadSelected: "https://hook.integromat.com/BBBBB",
    deleteSelected: "https://hook.integromat.com/DDDDD"
  };

  const JSON_URL = "https://raw.githubusercontent.com/flawer98/jobschmiede/main/ba_jobs.json";
  const BA_STATUS_DRAFT = "Noch nicht an BA übertragen";

  /* ========= DOM Helpers ========= */
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const dom = {
    notice: $("#notice"),
    form: $("#job-form"),
    supplierId: $("#supplier_id"),
    filenamePreview: $("#filename_preview"),
    cmsItemId: $("#cms_item_id"),
    externalId: $("#external_id"),
    transferFlag: $("#transfer_flag"),
    save: $("#save"),
    update: $("#update"),
    cancelEdit: $("#cancel-edit"),
    uploadNow: $("#upload-now"),
    batch10: $("#batch-10"),
    batch20: $("#batch-20"),
    uploadSelected: $("#btn-upload-selected"),
    deleteSelected: $("#btn-delete-selected"),
    clearSelection: $("#btn-clear-selection"),
    refresh: $("#btn-refresh"),
    selectAll: $("#select-all"),
    generateXml: $("#btn-generate-xml"),
    loadMore: $("#btn-load-more"),
    cmsBody: $("#cms-tbody"),
    searchInput: $("#list-search"),
    statusFilter: $("#list-filter-status"),
    flagFilter: $("#list-only-flag"),
    jobSearch: $("#ba-search"),
    jobSuggestions: $("#suggestions"),
    baTitleCode: $("#ba_title_code"),
    baTitleLabel: $("#ba_title_label"),
    baBkz: $("#ba_bkz")
  };

  /* ========= State ========= */
  const state = {
    cmsItems: [],
    filteredItems: [],
    jobIndex: [],
    selection: new Set(),
    cmsIdIndex: new Map(),
    cmsKeyIndex: new Map(),
    listLoadingPromise: null,
    isSaving: false,
    editingId: ""
  };

  /* ========= Utility Funktionen ========= */
  function logError(context, error) {
    console.error(`[${context}]`, error);
  }

  const FORM_FIELD_NAMES = [
    "job_title",
    "employment_type",
    "working_hours",
    "valid_from",
    "valid_to",
    "description_rich",
    "location_street",
    "location_postcode",
    "location_city",
    "location_country",
    "application_email",
    "application_url",
    "contact_name",
    "contact_email",
    "contact_phone",
    "ba_title_label",
    "ba_bkz",
    "ba_title_code",
    "company_name",
    "company_website",
    "supplier_id"
  ];

  function formatDateForInput(value) {
    if (!value) return "";
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return "";
      return value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (!text) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (text.includes("T")) {
      const [datePart] = text.split("T");
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return text;
  }

  function fillFormFromItem(item = {}) {
    if (!dom.form) return;
    FORM_FIELD_NAMES.forEach(name => {
      const field = dom.form.elements.namedItem(name);
      if (!field) return;
      const value = item[name];
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        if (field.type === "checkbox") {
          field.checked = normalizeTransferFlag(value);
        } else if (field.type === "number") {
          field.value = value ?? "";
        } else if (field.type === "date") {
          field.value = formatDateForInput(value);
        } else {
          field.value = value ?? "";
        }
      }
    });
    if (dom.transferFlag) dom.transferFlag.checked = normalizeTransferFlag(item.transfer_flag);
    const cmsId = normalizeId(item.id);
    if (dom.cmsItemId) dom.cmsItemId.value = cmsId;
    const externalId = normalizeId(item.external_id ?? item.id);
    if (dom.externalId) dom.externalId.value = externalId;
    if (dom.jobSearch) {
      const label = item.ba_title_label ?? "";
      const bkz = item.ba_bkz ?? "";
      dom.jobSearch.value = label && bkz ? `${label} (${bkz})` : label || bkz || "";
    }
    updateFilenamePreview({ preferValue: item.supplier_id });
  }

  function setFormMode(mode) {
    if (!dom.form) return;
    if (mode === "edit") {
      dom.form.dataset.mode = "edit";
      state.editingId = normalizeId(dom.cmsItemId?.value);
      dom.save?.classList.add("is-hidden");
      dom.update?.classList.remove("is-hidden");
      dom.cancelEdit?.classList.remove("is-hidden");
    } else {
      delete dom.form.dataset.mode;
      state.editingId = "";
      dom.save?.classList.remove("is-hidden");
      dom.update?.classList.add("is-hidden");
      dom.cancelEdit?.classList.add("is-hidden");
    }
  }

  function enterEditMode(item) {
    if (!item || !dom.form) return;
    fillFormFromItem(item);
    setFormMode("edit");
    const focusTarget = dom.form.elements.namedItem("job_title");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
    if (typeof dom.form.scrollIntoView === "function") {
      dom.form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setNotice(`Bearbeite "${item.job_title ?? "Eintrag"}". Änderungen mit "Aktualisieren" speichern.`, "warn");
  }

  function resetFormValues() {
    if (!dom.form) return;
    dom.form.reset();
    if (dom.jobSearch) dom.jobSearch.value = "";
    if (dom.cmsItemId) dom.cmsItemId.value = "";
    if (dom.externalId) dom.externalId.value = "";
    if (dom.transferFlag) dom.transferFlag.checked = false;
  }

  function exitEditMode({ resetForm = false } = {}) {
    setFormMode("create");
    if (resetForm) {
      resetFormValues();
      updateFilenamePreview();
    }
  }

  function normalizeId(value) {
    return String(value ?? "").trim();
  }

  function normalizeWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeComparable(value) {
    return normalizeWhitespace(value).toLowerCase();
  }

  function normalizePartnerId(value) {
    const raw = String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw) return "";
    if (/^[VPK]\d{9}$/.test(raw)) return raw;
    const match = raw.match(/^([VPK])(\d{1,9})$/);
    if (!match) return "";
    const [, prefix, digits] = match;
    return `${prefix}${digits.padEnd(9, "0")}`;
  }

  function normalizeTransferFlag(value) {
    if (value === true || value === false) return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return false;
      if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    }
    if (typeof value === "number") return value === 1;
    if (value == null) return false;
    return Boolean(value);
  }

  function coalesceText(...values) {
    for (const value of values) {
      if (value == null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  function coalesceDate(...values) {
    for (const value of values) {
      if (!value) continue;
      const date = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return (
      date.toLocaleDateString("de-DE") +
      " " +
      date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    );
  }

  function normalizeBaStatus(value) {
    const trimmed = normalizeWhitespace(value);
    if (!trimmed) return BA_STATUS_DRAFT;
    const key = normalizeComparable(trimmed);
    if (["pending", "neu", "new", "waiting", "wartend", "draft"].includes(key)) {
      return BA_STATUS_DRAFT;
    }
    if (["ok", "success", "done", "sent"].includes(key)) return "OK";
    if (["error", "failed", "fail"].includes(key)) return "ERROR";
    return trimmed;
  }

  function statusKey(value) {
    return normalizeComparable(normalizeBaStatus(value));
  }

  function isStatusOk(value) {
    return statusKey(value) === "ok";
  }

  function isStatusError(value) {
    return statusKey(value) === "error";
  }

  function normalizeCmsItem(item = {}) {
    const normalized = { ...item };
    const id = normalizeId(item.id ?? item.cms_item_id ?? item._id);
    if (id) normalized.id = id;
    else delete normalized.id;
    const title = coalesceText(item.job_title, item.Name, item.name, item.title);
    normalized.job_title = title;
    const city = coalesceText(item.location_city, item.city, item.location_city_name);
    if (city) normalized.location_city = city;
    const postcode = coalesceText(item.location_postcode, item.postcode, item.zip, item.plz);
    if (postcode) normalized.location_postcode = postcode;
    normalized.transfer_flag = normalizeTransferFlag(item.transfer_flag);
    const rawStatus = normalizeWhitespace(item.ba_status);
    if (rawStatus) normalized.ba_status_raw = rawStatus;
    normalized.ba_status = normalizeBaStatus(item.ba_status);
    const validFrom = coalesceText(item.valid_from, item.validFrom);
    if (validFrom) normalized.valid_from = validFrom;
    const validTo = coalesceText(item.valid_to, item.validTo);
    if (validTo) normalized.valid_to = validTo;
    return normalized;
  }

  function formatTimestampForBA(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
    ].join("_");
  }

  function buildBAFilename(partnerId) {
    const normalized = normalizePartnerId(partnerId);
    if (!normalized) {
      return "DSXXXXXXXXXX_0000-00-00_00-00-00.xml";
    }
    return `DS${normalized}_${formatTimestampForBA()}.xml`;
  }

  function escapeXML(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  const NOTICE_TIMEOUT_DEFAULT = 6000;
  const NOTICE_TIMEOUT_ERROR = 9000;
  let noticeHideTimer = null;

  function setNotice(text, type = "info") {
    if (!dom.notice) return;
    const message =
      typeof text === "string"
        ? text
        : text != null
        ? JSON.stringify(text, null, 2)
        : "";

    dom.notice.textContent = message || "\u00a0";
    dom.notice.className = "ba-toast";
    if (type === "ok") dom.notice.classList.add("ba-toast--ok");
    if (type === "warn") dom.notice.classList.add("ba-toast--warn");
    if (type === "error") dom.notice.classList.add("ba-toast--error");

    const role = type === "error" ? "alert" : "status";
    if (dom.notice.getAttribute("role") !== role) {
      dom.notice.setAttribute("role", role);
    }

    dom.notice.classList.remove("is-visible");
    dom.notice.removeAttribute("aria-hidden");

    requestAnimationFrame(() => {
      dom.notice.classList.add("is-visible");
    });

    clearTimeout(noticeHideTimer);
    const timeout = type === "error" ? NOTICE_TIMEOUT_ERROR : NOTICE_TIMEOUT_DEFAULT;
    noticeHideTimer = window.setTimeout(() => {
      dom.notice.classList.remove("is-visible");
      dom.notice.setAttribute("aria-hidden", "true");
    }, timeout);
  }

  function toggleDisabled(disabled) {
    ["save", "update", "upload-now", "batch-10", "batch-20", "btn-upload-selected", "btn-delete-selected"].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.disabled = disabled;
    });
    if (dom.generateXml) {
      if (disabled) {
        dom.generateXml.dataset.locked = "1";
        dom.generateXml.disabled = true;
      } else {
        if (dom.generateXml.dataset.locked) delete dom.generateXml.dataset.locked;
        dom.generateXml.disabled = state.selection.size === 0;
      }
    }
    if (!disabled) updateSelectionButtons();
  }

  async function postHook(url, payload) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        error.body = text;
        throw error;
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (parseError) {
        return { raw: text };
      }
    } catch (error) {
      logError("postHook", error);
      throw error;
    }
  }

  function extractItemId(response) {
    if (!response) return "";
    if (typeof response === "string") {
      try {
        return extractItemId(JSON.parse(response));
      } catch (error) {
        const match = response.match(/(?:item[_-]?id|external[_-]?id|id)["']?[:=]\s*"?([\w-]{6,})"?/i);
        return match ? match[1] : "";
      }
    }
    if (typeof response !== "object") return "";
    const candidate = response.itemId ?? response.item_id ?? response.external_id ?? response.id ?? null;
    if (candidate) return String(candidate);
    const containers = [response.items, response.item, response.data, response.raw];
    for (const container of containers) {
      const nested = extractItemId(container);
      if (nested) return nested;
    }
    return "";
  }

  function buildCmsKey(item) {
    if (!item) return "";
    const title = normalizeComparable(item.job_title);
    const city = normalizeComparable(item.location_city);
    const supplier = normalizeComparable(item.supplier_id ?? item.partner_id);
    if (!title || !city) return "";
    return `${title}|${supplier}|${city}`;
  }

  function rebuildCmsIndexes(items = state.cmsItems) {
    state.cmsIdIndex = new Map();
    state.cmsKeyIndex = new Map();
    items.forEach(item => {
      const id = normalizeId(item?.id);
      if (id) state.cmsIdIndex.set(id, item);
      const key = buildCmsKey(item);
      if (key) state.cmsKeyIndex.set(key, item);
    });
  }

  function registerCmsItem(item) {
    if (!item) return;
    const normalized = normalizeCmsItem(item);
    const id = normalizeId(normalized.id);
    if (id) state.cmsIdIndex.set(id, normalized);
    const key = buildCmsKey(normalized);
    if (key) state.cmsKeyIndex.set(key, normalized);
  }

  function findCmsItemMatchByName(data, { excludeId } = {}) {
    if (!state.cmsItems.length || !data) return null;
    const key = buildCmsKey(data);
    if (!key) return null;
    const match = state.cmsKeyIndex.get(key) ?? null;
    if (!match) return null;
    if (excludeId && normalizeId(match.id) === normalizeId(excludeId)) return null;
    return match;
  }

  function requireEitherEmailOrUrl(data) {
    const hasEmail = isValidEmail(data.application_email);
    const hasUrl = /^https?:\/\//i.test(String(data.application_url ?? ""));
    return hasEmail || hasUrl;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ""));
  }

  function serializeForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    Object.keys(data).forEach(key => {
      if (typeof data[key] === "string") data[key] = data[key].trim();
    });
    data.transfer_flag = dom.transferFlag?.checked ?? false;
    if (data.working_hours) data.working_hours = Number(data.working_hours);
    const cmsId = normalizeId(data.cms_item_id);
    if (cmsId) data.cms_item_id = cmsId;
    else delete data.cms_item_id;
    const externalId = normalizeId(data.external_id);
    if (externalId) data.external_id = externalId;
    else delete data.external_id;
    return data;
  }

  function validate(data) {
    if (!dom.form) return { ok: false, msg: "Formular nicht gefunden." };
    if (!dom.form.checkValidity()) {
      dom.form.reportValidity();
      return { ok: false, msg: "Bitte Pflichtfelder prüfen." };
    }
    if (!data.ba_title_code || !data.ba_bkz || !data.ba_title_label) {
      return { ok: false, msg: "Bitte BA-Beruf auswählen." };
    }
    if (!requireEitherEmailOrUrl(data)) {
      return { ok: false, msg: "Bitte E-Mail ODER Bewerbungs-URL angeben." };
    }
    const supplierId = normalizePartnerId(data.supplier_id);
    if (!supplierId) {
      return {
        ok: false,
        msg: "Partner-ID muss mit V, P oder K beginnen und insgesamt 10 Zeichen (1 Buchstabe + 9 Ziffern) haben."
      };
    }
    data.supplier_id = supplierId;
    return { ok: true };
  }

  function applyExistingIds(data) {
    const externalFromForm = normalizeId(dom.externalId?.value);
    const cmsFromForm = normalizeId(dom.cmsItemId?.value);
    const external = normalizeId(data.external_id || externalFromForm);
    const cmsId = normalizeId(data.cms_item_id || data.id || cmsFromForm);
    if (external) {
      data.external_id = external;
      if (dom.externalId) dom.externalId.value = external;
    } else {
      delete data.external_id;
    }
    if (cmsId) {
      data.id = cmsId;
      if (dom.cmsItemId) dom.cmsItemId.value = cmsId;
    } else if (external) {
      data.id = external;
    } else {
      delete data.id;
    }
  }

  function resolvePartnerIdFromJobsOrForm(jobs = [], { silent = false } = {}) {
    const ids = new Set();
    jobs.forEach(job => {
      const id = normalizePartnerId(job?.supplier_id ?? job?.partner_id);
      if (id) ids.add(id);
    });
    if (ids.size > 1) {
      if (!silent) setNotice("Die ausgewählten Stellen enthalten unterschiedliche Partner-IDs. Bitte Auswahl anpassen.", "error");
      return "";
    }
    if (ids.size === 1) return Array.from(ids)[0];
    return normalizePartnerId(dom.supplierId?.value);
  }

  function updateFilenamePreview({ preferValue } = {}) {
    if (!dom.filenamePreview) return;
    let partnerId = normalizePartnerId(preferValue ?? dom.supplierId?.value ?? "");
    if (!partnerId) {
      const jobs = getSelectedJobs();
      partnerId = resolvePartnerIdFromJobsOrForm(jobs, { silent: true });
    }
    dom.filenamePreview.textContent = buildBAFilename(partnerId);
  }

  function ensurePartnerIdMatchesSelection() {
    if (state.editingId) {
      updateFilenamePreview();
      return;
    }
    const jobs = getSelectedJobs();
    if (!jobs.length) {
      updateFilenamePreview();
      return;
    }
    const partnerId = resolvePartnerIdFromJobsOrForm(jobs, { silent: true });
    if (partnerId && dom.supplierId) {
      const current = normalizePartnerId(dom.supplierId.value);
      if (current !== partnerId) dom.supplierId.value = partnerId;
    }
    updateFilenamePreview({ preferValue: partnerId });
  }

  /* ========= Autocomplete ========= */
  let debounceTimer = null;
  const MAX_RESULTS = 15;

  async function loadJobs() {
    if (state.jobIndex.length) return;
    try {
      const response = await fetch(JSON_URL, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Ungültiges JSON-Format");
      state.jobIndex = data;
    } catch (error) {
      logError("loadJobs", error);
      setNotice("Konnte BA-Jobliste nicht laden.", "error");
    }
  }

  function searchJobs(query) {
    const q = query.toLowerCase();
    return state.jobIndex
      .filter(job =>
        (job.neutral_kurz ?? "").toLowerCase().includes(q) ||
        (job.bkz ?? "").toLowerCase().includes(q) ||
        (job.title_code ?? "").toLowerCase().includes(q)
      )
      .slice(0, MAX_RESULTS);
  }

  function renderSuggestions(results) {
    if (!dom.jobSuggestions) return;
    if (!results.length) {
      dom.jobSuggestions.innerHTML = "";
      dom.jobSuggestions.classList.add("hidden");
      return;
    }
    dom.jobSuggestions.innerHTML = results
      .map(result =>
        `<li class=\"ba-suggestion\" data-code=\"${escapeXML(result.title_code)}\" data-label=\"${escapeXML(result.neutral_kurz)}\" data-bkz=\"${escapeXML(result.bkz)}\">` +
        `<span>${escapeXML(result.neutral_kurz)}</span><small>${escapeXML(result.bkz)}</small>` +
        "</li>"
      )
      .join("");
    dom.jobSuggestions.classList.remove("hidden");
  }

  function setupAutocomplete() {
    if (!dom.jobSearch) return;
    dom.jobSearch.addEventListener("focus", loadJobs);
    dom.jobSearch.addEventListener("input", event => {
      clearTimeout(debounceTimer);
      const value = event.target.value.trim();
      if (value.length < 2) {
        dom.jobSuggestions?.classList.add("hidden");
        return;
      }
      debounceTimer = setTimeout(() => renderSuggestions(searchJobs(value)), 150);
    });
    dom.jobSuggestions?.addEventListener("click", event => {
      const listItem = event.target.closest("li");
      if (!listItem) return;
      const { code, label, bkz } = listItem.dataset;
      if (dom.baTitleCode) dom.baTitleCode.value = code ?? "";
      if (dom.baTitleLabel) dom.baTitleLabel.value = label ?? "";
      if (dom.baBkz) dom.baBkz.value = bkz ?? "";
      dom.jobSearch.value = `${label ?? ""} (${bkz ?? ""})`;
      dom.jobSuggestions.classList.add("hidden");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") dom.jobSuggestions?.classList.add("hidden");
    });
  }

  /* ========= CMS-Liste ========= */
  function getRenderableList() {
    const hasFilters = Boolean(
      normalizeComparable(dom.searchInput?.value ?? "") ||
        normalizeComparable(dom.statusFilter?.value ?? "") ||
        dom.flagFilter?.checked
    );
    return hasFilters ? state.filteredItems : state.cmsItems;
  }

  function renderCmsTable(items) {
    if (!dom.cmsBody) return;
    if (!items.length) {
      dom.cmsBody.innerHTML = "<tr><td colspan='8'>Keine Einträge gefunden.</td></tr>";
      syncSelectionUI();
      return;
    }
    const selection = state.selection;
    dom.cmsBody.innerHTML = items
      .map(item => {
        const normalized = normalizeCmsItem(item);
        const id = normalizeId(normalized.id);
        const checked = selection.has(id) ? "checked" : "";
        const statusForChip = normalizeBaStatus(normalized.ba_status_raw ?? normalized.ba_status);
        const sent = isStatusOk(statusForChip);
        const checkboxDisabled = !id || sent ? "disabled" : "";
        const uploadDisabled = !id || sent ? "disabled" : "";
        const actionDisabled = id ? "" : "disabled";
        const statusLabel = coalesceText(normalized.ba_status_raw, statusForChip) || "-";
        const statusClass = sent
          ? "ba-chip--ok"
          : isStatusError(statusForChip)
          ? "ba-chip--error"
          : "ba-chip--wait";
        const updatedDate = coalesceDate(
          normalized.last_updated,
          normalized.updated_on,
          normalized.updatedAt,
          normalized.updated_at,
          normalized.last_published,
          normalized.created_on,
          normalized.createdAt
        );
        const updated = updatedDate ? formatDateTime(updatedDate) : "-";
        const idMarkup = id ? `<code>${escapeXML(id)}</code>` : "-";
        const title = normalizeWhitespace(normalized.job_title) || "-";
        const postcode = coalesceText(
          normalized.location_postcode,
          normalized.postcode,
          normalized.zip,
          normalized.plz
        );
        const city = coalesceText(
          normalized.location_city,
          normalized.city,
          normalized.location_city_name
        );
        const location = [postcode, city].filter(Boolean).join(" ") || "-";
        const transferLabel = normalized.transfer_flag ? "Ja" : "Nein";
        return (
          `<tr>` +
          `<td><input type=\"checkbox\" class=\"row-check\" data-id=\"${escapeXML(id)}\" ${checked} ${checkboxDisabled}></td>` +
          `<td class=\"ba-table__id\">${idMarkup}</td>` +
          `<td>${escapeXML(title)}</td>` +
          `<td>${escapeXML(location)}</td>` +
          `<td class=\"ba-table__when\">${escapeXML(updated)}</td>` +
          `<td><span class='ba-chip'>${escapeXML(transferLabel)}</span></td>` +
          `<td><span class=\"ba-chip ${statusClass}\">${escapeXML(statusLabel)}</span></td>` +
          `<td class=\"ba-table__actions\">` +
          `<div class=\"ba-table__action-group\">` +
          `<button type=\"button\" class=\"ba-btn ba-btn--ghost js-edit-item\" data-id=\"${escapeXML(id)}\" ${actionDisabled}>Bearbeiten</button>` +
          `<button type=\"button\" class=\"ba-btn ba-btn--ghost js-delete-item\" data-id=\"${escapeXML(id)}\" ${actionDisabled}>Löschen</button>` +
          `<button type=\"button\" class=\"ba-btn ba-btn--ghost js-upload-single\" data-id=\"${escapeXML(id)}\" ${uploadDisabled}>Upload</button>` +
          `</div>` +
          `</td>` +
          `</tr>`
        );
      })
      .join("");
    syncSelectionUI();
  }

  function applyCmsFilters() {
    if (!state.cmsItems.length) {
      renderCmsTable([]);
      return;
    }
    const query = normalizeComparable(dom.searchInput?.value ?? "");
    const status = normalizeComparable(dom.statusFilter?.value ?? "");
    const requireFlag = dom.flagFilter?.checked ?? false;

    let items = [...state.cmsItems];
    if (query) {
      items = items.filter(item =>
        normalizeComparable(item.job_title).includes(query) ||
        normalizeComparable(item.location_city).includes(query)
      );
    }
    if (status) {
      items = items.filter(item => normalizeComparable(item.ba_status) === status);
    }
    if (requireFlag) {
      items = items.filter(item => item.transfer_flag === true);
    }
    state.filteredItems = items;
    renderCmsTable(items);
  }

  function updateSelectionButtons() {
    const count = state.selection.size;
    if (dom.uploadSelected) {
      dom.uploadSelected.disabled = count === 0;
      dom.uploadSelected.textContent = `Ausgewählte direkt übertragen (${count})`;
    }
    if (dom.deleteSelected) {
      dom.deleteSelected.disabled = count === 0;
      dom.deleteSelected.textContent = `In BA löschen (${count})`;
    }
    if (dom.clearSelection) dom.clearSelection.disabled = count === 0;
    if (dom.generateXml && !dom.generateXml.dataset.locked) dom.generateXml.disabled = count === 0;
  }

  function syncSelectAllCheckbox() {
    if (!dom.selectAll) return;
    const items = getRenderableList();
    if (!items.length) {
      dom.selectAll.checked = false;
      dom.selectAll.indeterminate = false;
      return;
    }
    let selectable = 0;
    let checked = 0;
    items.forEach(item => {
      if (isStatusOk(item.ba_status)) return;
      selectable += 1;
      if (state.selection.has(normalizeId(item.id))) checked += 1;
    });
    dom.selectAll.checked = selectable > 0 && checked === selectable;
    dom.selectAll.indeterminate = checked > 0 && checked < selectable;
  }

  function syncSelectionUI() {
    updateSelectionButtons();
    syncSelectAllCheckbox();
    ensurePartnerIdMatchesSelection();
  }

  function getSelectedJobs(predicate) {
    const ids = state.selection;
    let jobs = state.cmsItems.filter(item => ids.has(normalizeId(item.id)));
    if (typeof predicate === "function") jobs = jobs.filter(predicate);
    return jobs;
  }

  async function loadList(options = {}) {
    if (typeof Event !== "undefined" && options instanceof Event) options = {};
    const { silent = false, preserveNotice = false } = options;
    if (state.listLoadingPromise) return state.listLoadingPromise;

    const task = (async () => {
      if (!silent && !preserveNotice) setNotice("Lade CMS-Einträge …");
      try {
        const response = await fetch(WEBHOOKS.list, { method: "POST" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.items)) throw new Error("Ungültige Antwort vom Server");
        state.cmsItems = payload.items.map(item => normalizeCmsItem(item));
        rebuildCmsIndexes();
        if (state.editingId && !state.cmsIdIndex.has(state.editingId)) {
          exitEditMode({ resetForm: true });
        }
        const validIds = new Set(state.cmsItems.map(item => normalizeId(item.id)));
        state.selection = new Set(
          Array.from(state.selection).filter(id => {
            if (!validIds.has(id)) return false;
            const entry = state.cmsIdIndex.get(id);
            return entry ? !isStatusOk(entry.ba_status) : true;
          })
        );
        applyCmsFilters();
        if (!silent && !preserveNotice) setNotice(`Es wurden ${state.cmsItems.length} Einträge geladen.`, "ok");
      } catch (error) {
        logError("loadList", error);
        state.cmsItems = [];
        state.filteredItems = [];
        rebuildCmsIndexes();
        renderCmsTable([]);
        updateSelectionButtons();
        setNotice(error?.message ? `Fehler beim Laden der Liste (${error.message}).` : "Fehler beim Laden der Liste.", "error");
        throw error;
      }
    })();

    state.listLoadingPromise = task;
    try {
      await task;
    } finally {
      state.listLoadingPromise = null;
    }
    return task;
  }

  async function ensureCmsListLoaded() {
    if (state.cmsItems.length) return;
    if (state.listLoadingPromise) {
      try {
        await state.listLoadingPromise;
      } catch (error) {
        logError("ensureCmsListLoaded", error);
      }
      return;
    }
    try {
      await loadList({ silent: true, preserveNotice: true });
    } catch (error) {
      logError("ensureCmsListLoaded", error);
    }
  }

  /* ========= XML ========= */
  function buildSingleJobXML(job, action) {
    const supplierId = normalizePartnerId(job?.supplier_id ?? job?.partner_id);
    const fields = {
      ExternalId: normalizeId(job?.external_id ?? job?.id),
      Title: job?.job_title,
      EmploymentType: job?.employment_type,
      WorkingHours: job?.working_hours,
      ValidFrom: job?.valid_from,
      ValidTo: job?.valid_to,
      Description: job?.description_rich,
      LocationStreet: job?.location_street,
      LocationPostcode: job?.location_postcode,
      LocationCity: job?.location_city,
      LocationCountry: job?.location_country,
      ApplicationEmail: job?.application_email,
      ApplicationUrl: job?.application_url,
      ContactName: job?.contact_name,
      ContactEmail: job?.contact_email,
      ContactPhone: job?.contact_phone,
      BAJobLabel: job?.ba_title_label,
      BAJobCode: job?.ba_title_code,
      BABKZ: job?.ba_bkz,
      SupplierId: supplierId,
      TransferFlag: job?.transfer_flag === true ? "true" : job?.transfer_flag === false ? "false" : undefined
    };
    const body = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `    <${key}>${escapeXML(value)}</${key}>`)
      .join("\n");
    return [`  <Job action=\"${escapeXML(action)}\">`, body || "    <Empty />", "  </Job>"].join("\n");
  }

  function buildMultiJobXML(jobs, action = "INSERT") {
    if (!Array.isArray(jobs) || !jobs.length) return "";
    const jobXml = jobs.map(job => buildSingleJobXML(job, action)).join("\n");
    return [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      `<BAJobCollection action=\"${escapeXML(action)}\">`,
      jobXml,
      "</BAJobCollection>"
    ].join("\n");
  }

  /* ========= Aktionen ========= */
  async function sendToMake(action, jobs) {
    if (!jobs.length) return;
    const partnerId = resolvePartnerIdFromJobsOrForm(jobs);
    if (!partnerId) {
      setNotice("Ungültige oder fehlende Partner-ID. Upload abgebrochen.", "error");
      return;
    }
    const filename = buildBAFilename(partnerId);
    const xml = buildMultiJobXML(jobs, action);
    if (!xml) {
      setNotice("Konnte XML nicht erzeugen.", "error");
      return;
    }
    const hook = action === "DELETE" ? WEBHOOKS.deleteSelected : WEBHOOKS.uploadSelected;
    setNotice(`${action === "DELETE" ? "Lösche" : "Übertrage"} ${jobs.length} Einträge …`);
    toggleDisabled(true);
    try {
      const response = await postHook(hook, {
        filename,
        supplier_id: partnerId,
        typeOfLoad: action,
        ids: jobs.map(job => job.id),
        xml_content: xml
      });
      if (response?.status === "OK" || response?.ok === true) {
        setNotice(response, "ok");
      } else {
        setNotice(response ?? "Unbekannte Antwort", "error");
      }
    } catch (error) {
      setNotice(error?.message ? `Fehler beim Senden an Make (${error.message}).` : "Fehler beim Senden an Make.", "error");
    } finally {
      toggleDisabled(false);
    }
  }

  async function batchUpload(limit) {
    setNotice(`Batch-Upload (${limit}) gestartet …`);
    toggleDisabled(true);
    try {
      const response = await postHook(WEBHOOKS.uploadBatch, { limit });
      setNotice(response, "ok");
    } catch (error) {
      setNotice(error?.message ? `Fehler beim Batch-Upload (${error.message}).` : "Fehler beim Batch-Upload.", "error");
    } finally {
      toggleDisabled(false);
    }
  }

  /* ========= Event Handler ========= */
  function setupFormHandlers() {
    if (!dom.form) return;
    dom.form.addEventListener("submit", async event => {
      event.preventDefault();
      if (state.isSaving) return;
      const submitterId = event.submitter?.id ?? "";
      const isUpdate = submitterId === "update" || dom.form.dataset.mode === "edit";
      await ensureCmsListLoaded();
      const data = serializeForm(dom.form);
      const currentId = normalizeId(data.cms_item_id || state.editingId);
      if (!isUpdate) {
        const duplicate = findCmsItemMatchByName(data);
        if (duplicate) {
          setNotice(
            `Ein Job mit dem Titel "${data.job_title}" in "${data.location_city}" existiert bereits. Bitte Titel oder Ort anpassen.`,
            "error"
          );
          return;
        }
      }
      const validation = validate(data);
      if (!validation.ok) {
        setNotice(validation.msg, "warn");
        return;
      }
      let previousStatus = "";
      let previousStatusRaw = "";
      if (currentId) {
        const existing = state.cmsIdIndex.get(currentId);
        previousStatus = existing?.ba_status ?? "";
        previousStatusRaw = existing?.ba_status_raw ?? "";
      }
      if (isUpdate) {
        if (!currentId) {
          setNotice("Kein CMS-Item zum Aktualisieren ausgewählt.", "warn");
          return;
        }
        data.id = currentId;
        applyExistingIds(data);
        const statusToPreserve = previousStatusRaw || previousStatus;
        data.ba_status = statusToPreserve || BA_STATUS_DRAFT;
      } else {
        delete data.cms_item_id;
        data.ba_status = normalizeBaStatus(data.ba_status || previousStatus || BA_STATUS_DRAFT);
      }
      const hook = isUpdate ? WEBHOOKS.update : WEBHOOKS.save;
      if (!hook) {
        setNotice("Kein passender Hook konfiguriert.", "error");
        return;
      }
      setNotice(isUpdate ? "Aktualisiere …" : "Speichern …");
      toggleDisabled(true);
      try {
        state.isSaving = true;
        const response = await postHook(hook, { item: data });
        const successPayload = response ?? (isUpdate ? "Aktualisiert" : "Gespeichert");
        setNotice(successPayload, "ok");
        let resultingId = extractItemId(response);
        if (!resultingId && isUpdate) resultingId = currentId;
        if (resultingId) {
          if (isUpdate) {
            if (dom.externalId && !dom.externalId.value) dom.externalId.value = resultingId;
          } else {
            if (dom.externalId) dom.externalId.value = resultingId;
            if (dom.cmsItemId) dom.cmsItemId.value = resultingId;
            data.external_id = resultingId;
            data.id = resultingId;
          }
        }
        await loadList({ silent: true, preserveNotice: true });
        if (!isUpdate && resultingId) {
          const refreshed = state.cmsIdIndex.get(resultingId) ?? data;
          registerCmsItem(refreshed);
        }
        if (isUpdate) {
          exitEditMode({ resetForm: true });
        }
      } catch (error) {
        const action = isUpdate ? "Aktualisieren" : "Speichern";
        setNotice(error?.message ? `Fehler beim ${action} (${error.message}).` : `Fehler beim ${action}.`, "error");
      } finally {
        state.isSaving = false;
        toggleDisabled(false);
        updateFilenamePreview();
      }
    });

    dom.cancelEdit?.addEventListener("click", () => {
      if (!state.editingId) return;
      const confirmCancel = window.confirm("Bearbeitung verwerfen und neues CMS-Item anlegen?");
      if (!confirmCancel) return;
      exitEditMode({ resetForm: true });
      setNotice("Bearbeitungsmodus verlassen.");
    });

    dom.uploadNow?.addEventListener("click", async () => {
      await ensureCmsListLoaded();
      const data = serializeForm(dom.form);
      applyExistingIds(data);
      const validation = validate(data);
      if (!validation.ok) {
        setNotice(validation.msg, "warn");
        return;
      }
      const filename = buildBAFilename(data.supplier_id);
      setNotice(`Übertrage an BA … ${filename}`);
      toggleDisabled(true);
      try {
        const response = await postHook(WEBHOOKS.uploadSingle, { item: data, filename_hint: filename });
        if (response?.status === "OK" || response?.ok === true) {
          setNotice(response, "ok");
        } else {
          setNotice(response ?? "Unbekannte Antwort", "error");
        }
      } catch (error) {
        setNotice(error?.message ? `Fehler beim Upload (${error.message}).` : "Fehler beim Upload.", "error");
      } finally {
        toggleDisabled(false);
      }
    });

    dom.batch10?.addEventListener("click", () => batchUpload(10));
    dom.batch20?.addEventListener("click", () => batchUpload(20));

    dom.supplierId?.addEventListener("input", () => updateFilenamePreview());
    setFormMode("create");
    if (dom.cmsItemId) dom.cmsItemId.value = "";
    updateFilenamePreview();
  }

  function setupListHandlers() {
    dom.searchInput?.addEventListener("input", applyCmsFilters);
    dom.statusFilter?.addEventListener("change", applyCmsFilters);
    dom.flagFilter?.addEventListener("change", applyCmsFilters);

    dom.cmsBody?.addEventListener("change", event => {
      const checkbox = event.target.closest(".row-check");
      if (!checkbox) return;
      const id = normalizeId(checkbox.dataset.id);
      if (!id) return;
      if (checkbox.checked) state.selection.add(id);
      else state.selection.delete(id);
      syncSelectionUI();
    });

    dom.cmsBody?.addEventListener("click", async event => {
      const editButton = event.target.closest(".js-edit-item");
      if (editButton) {
        const id = normalizeId(editButton.dataset.id);
        if (!id) return;
        const job = state.cmsItems.find(item => normalizeId(item.id) === id);
        if (job) enterEditMode(job);
        return;
      }

      const deleteButton = event.target.closest(".js-delete-item");
      if (deleteButton) {
        const id = normalizeId(deleteButton.dataset.id);
        if (!id) return;
        const job = state.cmsItems.find(item => normalizeId(item.id) === id);
        if (!job) return;
        const confirmDelete = window.confirm(
          `Soll die Stelle "${job.job_title ?? id}" wirklich im BA-CMS gelöscht werden?`
        );
        if (!confirmDelete) return;
        state.selection.delete(id);
        if (state.editingId && state.editingId === id) exitEditMode({ resetForm: true });
        await sendToMake("DELETE", [job]);
        await loadList({ silent: true, preserveNotice: true });
        return;
      }

      const button = event.target.closest(".js-upload-single");
      if (!button) return;
      const id = normalizeId(button.dataset.id);
      if (!id) return;
      const job = state.cmsItems.find(item => normalizeId(item.id) === id);
      if (!job) return;
      if (isStatusOk(job.ba_status)) {
        setNotice("Bereits gesendet – übersprungen", "warn");
        return;
      }
      await sendToMake("INSERT", [job]);
    });

    dom.uploadSelected?.addEventListener("click", async () => {
      const jobs = getSelectedJobs(job => !isStatusOk(job.ba_status));
      if (!jobs.length) {
        setNotice("Alle ausgewählten Stellen wurden bereits gesendet.", "warn");
        return;
      }
      await sendToMake("INSERT", jobs);
    });

    dom.deleteSelected?.addEventListener("click", async () => {
      const jobs = getSelectedJobs();
      if (!jobs.length) {
        setNotice("Keine Auswahl.", "warn");
        return;
      }
      await sendToMake("DELETE", jobs);
    });

    dom.clearSelection?.addEventListener("click", () => {
      state.selection.clear();
      applyCmsFilters();
      syncSelectionUI();
    });

    dom.selectAll?.addEventListener("change", event => {
      const items = getRenderableList();
      if (event.target.checked) {
        items.forEach(item => {
          if (!isStatusOk(item.ba_status)) state.selection.add(normalizeId(item.id));
        });
      } else {
        state.selection.clear();
      }
      applyCmsFilters();
      syncSelectionUI();
    });

    dom.refresh?.addEventListener("click", () => loadList());

    dom.generateXml?.addEventListener("click", async () => {
      const jobs = getSelectedJobs();
      if (!jobs.length) {
        setNotice("Bitte mindestens eine Stelle auswählen.", "warn");
        return;
      }
      const partnerId = resolvePartnerIdFromJobsOrForm(jobs);
      if (!partnerId) {
        setNotice("Ungültige oder fehlende Partner-ID. Bitte Auswahl prüfen.", "error");
        return;
      }
      const xml = buildMultiJobXML(jobs, "INSERT");
      if (!xml) {
        setNotice("Konnte XML nicht erzeugen.", "error");
        return;
      }
      const filename = buildBAFilename(partnerId);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`XML-Datei \"${filename}\" mit ${jobs.length} Stellen erzeugt.`, "ok");
    });
  }

  /* ========= Init ========= */
  function init() {
    setupAutocomplete();
    setupFormHandlers();
    setupListHandlers();
    loadList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
