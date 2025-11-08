
(function () {
  "use strict";

  /* ========= Konfiguration ========= */
  const WEBHOOKS = {
    save: "https://hook.eu2.make.com/krje3ftzgbomitzs8ca8a5f5mc5c5bhf",
    uploadSingle: "https://hook.integromat.com/yyyyy",
    uploadBatch: "https://hook.integromat.com/zzzzz",
    list: "https://hook.eu2.make.com/1thp5v89ydmjmr6oaz9zfea0h5alnpky",
    uploadSelected: "https://hook.integromat.com/BBBBB",
    deleteSelected: "https://hook.integromat.com/DDDDD"
  };

  const JSON_URL = "https://raw.githubusercontent.com/flawer98/jobschmiede/main/ba_jobs.json";

  /* ========= DOM Helpers ========= */
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const dom = {
    notice: $("#notice"),
    form: $("#job-form"),
    supplierId: $("#supplier_id"),
    filenamePreview: $("#filename_preview"),
    externalId: $("#external_id"),
    transferFlag: $("#transfer_flag"),
    save: $("#save"),
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
    isSaving: false
  };

  /* ========= Utility Funktionen ========= */
  function logError(context, error) {
    console.error(`[${context}]`, error);
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

  function setNotice(text, type = "info") {
    if (!dom.notice) return;
    const message = typeof text === "string" ? text : text != null ? JSON.stringify(text, null, 2) : "";
    dom.notice.textContent = message;
    dom.notice.classList.remove("ba-notice--ok", "ba-notice--warn", "ba-notice--error");
    if (type === "ok") dom.notice.classList.add("ba-notice--ok");
    if (type === "warn") dom.notice.classList.add("ba-notice--warn");
    if (type === "error") dom.notice.classList.add("ba-notice--error");
  }

  function toggleDisabled(disabled) {
    ["save", "upload-now", "batch-10", "batch-20", "btn-upload-selected", "btn-delete-selected"].forEach(id => {
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
    const id = normalizeId(item.id);
    if (id) state.cmsIdIndex.set(id, item);
    const key = buildCmsKey(item);
    if (key) state.cmsKeyIndex.set(key, item);
  }

  function findCmsItemMatchByName(data) {
    if (!state.cmsItems.length || !data) return null;
    const key = buildCmsKey(data);
    if (!key) return null;
    return state.cmsKeyIndex.get(key) ?? null;
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

  function applyExistingExternalId(data) {
    const fromForm = normalizeId(dom.externalId?.value);
    const existing = normalizeId(data.external_id || data.id || fromForm);
    if (existing) {
      data.external_id = existing;
      data.id = existing;
      if (dom.externalId) dom.externalId.value = existing;
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
      dom.cmsBody.innerHTML = "<tr><td colspan='7'>Keine Einträge gefunden.</td></tr>";
      syncSelectionUI();
      return;
    }
    const selection = state.selection;
    dom.cmsBody.innerHTML = items
      .map(item => {
        const id = normalizeId(item.id);
        const checked = selection.has(id) ? "checked" : "";
        const disabled = item.ba_status === "OK" ? "disabled" : "";
        const statusClass =
          item.ba_status === "OK"
            ? "ba-chip--ok"
            : item.ba_status === "ERROR"
            ? "ba-chip--error"
            : "ba-chip--wait";
        const updated = item.updated_on
          ? new Date(item.updated_on).toLocaleDateString("de-DE") +
            " " +
            new Date(item.updated_on).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
          : "-";
        return (
          `<tr>` +
          `<td><input type=\"checkbox\" class=\"row-check\" data-id=\"${escapeXML(id)}\" ${checked} ${disabled}></td>` +
          `<td>${escapeXML(item.job_title ?? "-")}</td>` +
          `<td>${escapeXML(item.location_city ?? "-")}</td>` +
          `<td><small>${escapeXML(updated)}</small></td>` +
          `<td>${item.transfer_flag ? "<span class='ba-chip'>true</span>" : "<span class='ba-chip'>false</span>"}</td>` +
          `<td><span class=\"ba-chip ${statusClass}\">${escapeXML(item.ba_status ?? "-")}</span></td>` +
          `<td><button type=\"button\" class=\"ba-btn ba-btn--ghost js-upload-single\" data-id=\"${escapeXML(id)}\" ${disabled}>Upload</button></td>` +
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
      if (item.ba_status === "OK") return;
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
        state.cmsItems = payload.items.map(item => ({
          ...item,
          transfer_flag: normalizeTransferFlag(item?.transfer_flag)
        }));
        rebuildCmsIndexes();
        const validIds = new Set(state.cmsItems.map(item => normalizeId(item.id)));
        state.selection = new Set(Array.from(state.selection).filter(id => validIds.has(id)));
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
      await ensureCmsListLoaded();
      const data = serializeForm(dom.form);
      const duplicate = findCmsItemMatchByName(data);
      if (duplicate) {
        setNotice(
          `Ein Job mit dem Titel "${data.job_title}" in "${data.location_city}" existiert bereits. Bitte Titel oder Ort anpassen.`,
          "error"
        );
        return;
      }
      const validation = validate(data);
      if (!validation.ok) {
        setNotice(validation.msg, "warn");
        return;
      }
      setNotice("Speichern …");
      toggleDisabled(true);
      try {
        state.isSaving = true;
        const response = await postHook(WEBHOOKS.save, { item: data });
        setNotice(response ?? "Gespeichert", "ok");
        const newId = extractItemId(response);
        if (newId) {
          if (dom.externalId) dom.externalId.value = newId;
          data.external_id = newId;
          data.id = newId;
        }
        await loadList({ silent: true, preserveNotice: true });
        if (newId) {
          const refreshed = state.cmsIdIndex.get(newId) ?? data;
          registerCmsItem(refreshed);
        }
      } catch (error) {
        setNotice(error?.message ? `Fehler beim Speichern (${error.message}).` : "Fehler beim Speichern.", "error");
      } finally {
        state.isSaving = false;
        toggleDisabled(false);
        updateFilenamePreview();
      }
    });

    dom.uploadNow?.addEventListener("click", async () => {
      await ensureCmsListLoaded();
      const data = serializeForm(dom.form);
      applyExistingExternalId(data);
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
      const button = event.target.closest(".js-upload-single");
      if (!button) return;
      const id = normalizeId(button.dataset.id);
      if (!id) return;
      const job = state.cmsItems.find(item => normalizeId(item.id) === id);
      if (!job) return;
      if (job.ba_status === "OK") {
        setNotice("Bereits gesendet – übersprungen", "warn");
        return;
      }
      await sendToMake("INSERT", [job]);
    });

    dom.uploadSelected?.addEventListener("click", async () => {
      const jobs = getSelectedJobs(job => job.ba_status !== "OK");
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
          if (item.ba_status !== "OK") state.selection.add(normalizeId(item.id));
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
