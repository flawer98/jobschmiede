<script>
/* ========= Konfiguration ========= */
const WH_SAVE            = "https://hook.eu2.make.com/krje3ftzgbomitzs8ca8a5f5mc5c5bhf";
const WH_UPLOAD          = "https://hook.integromat.com/yyyyy";
const WH_UPLOAD_LAST     = "https://hook.integromat.com/zzzzz";
const WH_LIST            = "https://hook.eu2.make.com/1thp5v89ydmjmr6oaz9zfea0h5alnpky";
const WH_UPLOAD_SELECTED = "https://hook.integromat.com/BBBBB";

// BA-Berufsliste (raw JSON)
const JSON_URL = "https://raw.githubusercontent.com/flawer98/jobschmiede/main/ba_jobs.json";

/* ========= Hilfsfunktionen ========= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setNotice(text, type = "info") {
  const box = $("#notice");
  box.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  box.classList.remove("ba-notice--ok","ba-notice--warn","ba-notice--error");
  if (type === "ok") box.classList.add("ba-notice--ok");
  if (type === "warn") box.classList.add("ba-notice--warn");
  if (type === "error") box.classList.add("ba-notice--error");
}

function serializeForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  // Checkboxen: auf "true"/"false" normalisieren
  data.transfer_flag = $("#transfer_flag").checked;
  // Nummernfelder (falls als string) optional in integer wandeln
  if (data.working_hours) data.working_hours = Number(data.working_hours);
  return data;
}

async function postHook(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

function toggleDisabled(disabled) {
  ["save","upload-now","batch-10","batch-20"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function requireEitherEmailOrUrl(data) {
  const hasEmail = data.application_email && isValidEmail(data.application_email);
  const hasUrl   = data.application_url && /^https?:\/\//i.test(data.application_url);
  return hasEmail || hasUrl;
}

function padPartnerId10(v) {
  // Erwartet v/p/k + 7 Ziffern + "00". Wir lassen alles zu, aber trimmen & uppern.
  return String(v || "").trim();
}

function formatTimestampForBA(d = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function buildBAFilename(partnerId) {
  // A="D" (Standarddatei), B="S" (Stellenangebote)
  // DS<PartnerId10>_<yyyy-MM-dd_HH-mm-ss>.xml
  const pid = padPartnerId10(partnerId);
  const ts = formatTimestampForBA();
  if (!pid || pid.length !== 10) return "— Partner-ID ungültig —";
  return `DS${pid}_${ts}.xml`;
}

function updateFilenamePreview() {
  const pid = $("#supplier_id").value;
  $("#filename_preview").textContent = buildBAFilename(pid);
}

/* ========= Autocomplete (BA Beruf) ========= */
let jobIndex = [];
let debounceTimer = null;
const MAX_RESULTS = 15;

const $search = document.getElementById('ba-search');
const $list   = document.getElementById('suggestions');
const $code   = document.getElementById('ba_title_code');
const $label  = document.getElementById('ba_title_label');
const $bkz    = document.getElementById('ba_bkz');

async function loadJobs() {
  if (jobIndex.length) return;
  try {
    const res = await fetch(JSON_URL, { cache: "force-cache" });
    jobIndex = await res.json();
  } catch (err) {
    setNotice("Konnte BA-Jobliste nicht laden.", "error");
  }
}

function searchJobs(query) {
  const q = query.toLowerCase();
  return jobIndex.filter(j =>
    (j.neutral_kurz || "").toLowerCase().includes(q) ||
    (j.bkz || "").toLowerCase().includes(q) ||
    (j.title_code || "").toLowerCase().includes(q)
  ).slice(0, MAX_RESULTS);
}

function renderSuggestions(results) {
  if (!results.length) {
    $list.innerHTML = '';
    $list.classList.add('hidden');
    return;
  }
  $list.innerHTML = results.map(r => `
    <li class="ba-suggestion" data-code="${r.title_code}" data-label="${r.neutral_kurz}" data-bkz="${r.bkz}">
      <span>${r.neutral_kurz}</span>
      <small>${r.bkz}</small>
    </li>`).join('');
  $list.classList.remove('hidden');
}

$search.addEventListener('focus', loadJobs);

$search.addEventListener('input', e => {
  clearTimeout(debounceTimer);
  const val = e.target.value.trim();
  if (val.length < 2) { $list.classList.add('hidden'); return; }
  debounceTimer = setTimeout(() => {
    const hits = searchJobs(val);
    renderSuggestions(hits);
  }, 150);
});

$list.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  $code.value = li.dataset.code;
  $label.value = li.dataset.label;
  $bkz.value = li.dataset.bkz;
  $search.value = `${li.dataset.label} (${li.dataset.bkz})`;
  $list.classList.add('hidden');
});

/* ========= Formular-Validierung ========= */
function validate(formData) {
  // native required checks
  const form = $("#job-form");
  if (!form.checkValidity()) {
    form.reportValidity();
    return { ok: false, msg: "Bitte Pflichtfelder prüfen." };
  }

  // BA-Felder gesetzt?
  if (!formData.ba_title_code || !formData.ba_bkz || !formData.ba_title_label) {
    return { ok: false, msg: "Bitte BA-Beruf über die Suche auswählen." };
  }

  // E-Mail oder URL erforderlich
  if (!requireEitherEmailOrUrl(formData)) {
    return { ok: false, msg: "Bitte E-Mail ODER Bewerbungs-URL angeben." };
  }

  // Partner-ID 10-stellig
  if (!formData.supplier_id || String(formData.supplier_id).trim().length !== 10) {
    return { ok: false, msg: "Partner-/Supplier-ID muss 10-stellig sein (z. B. v000000100)." };
  }

  return { ok: true };
}

/* ========= Events ========= */
document.getElementById("supplier_id").addEventListener("input", updateFilenamePreview);
updateFilenamePreview();

$("#job-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = serializeForm(e.currentTarget);
  const v = validate(data);
  if (!v.ok) { setNotice(v.msg, "warn"); return; }

  setNotice("Speichern …");
  toggleDisabled(true);
  try {
    const resp = await postHook(WH_SAVE, { item: data });
    setNotice(resp, "ok");
    // ggf. external_id aus Response zurückschreiben:
    if (resp && resp.itemId && !$("#external_id").value) $("#external_id").value = resp.itemId;
  } catch (err) {
    setNotice("Fehler beim Speichern.", "error");
  } finally {
    toggleDisabled(false);
    updateFilenamePreview();
  }
});

$("#upload-now").addEventListener("click", async () => {
  const data = serializeForm($("#job-form"));
  const v = validate(data);
  if (!v.ok) { setNotice(v.msg, "warn"); return; }

  const filename = buildBAFilename(data.supplier_id);
  setNotice(`Übertrage an BA …\n${filename}`);
  toggleDisabled(true);
  try {
    const resp = await postHook(WH_UPLOAD, { item: data, filename_hint: filename });
    // Erwartet: { status: "OK"|"ERROR", message: "...", ba_filename: "..." }
    if (resp && (resp.status === "OK" || resp.ok === true)) {
      setNotice(resp, "ok");
    } else {
      setNotice(resp, "error");
    }
  } catch (err) {
    setNotice("Fehler beim Upload an BA.", "error");
  } finally {
    toggleDisabled(false);
  }
});

$("#batch-10").addEventListener("click", () => batchUpload(10));
$("#batch-20").addEventListener("click", () => batchUpload(20));

async function batchUpload(n) {
  setNotice(`Batch-Upload (${n}) gestartet …`);
  toggleDisabled(true);
  try {
    const resp = await postHook(WH_UPLOAD_LAST, { limit: n });
    setNotice(resp, "ok");
  } catch (err) {
    setNotice("Fehler beim Batch-Upload.", "error");
  } finally {
    toggleDisabled(false);
  }
}





/* ========= CMS-Listenlogik ========= */

// interne Zustände
let cmsItems = [];
let selectedIds = new Set();

const $cmsBody = document.getElementById("cms-tbody");
const $selectAll = document.getElementById("select-all");
const $uploadSelected = document.getElementById("btn-upload-selected");
const $clearSelection = document.getElementById("btn-clear-selection");
const $loadMore = document.getElementById("btn-load-more");
const $refresh = document.getElementById("btn-refresh");

// Tabelle rendern
function renderCmsTable(items) {
  if (!items?.length) {
    $cmsBody.innerHTML = `<tr><td colspan="7">Keine Einträge gefunden.</td></tr>`;
    return;
  }

  $cmsBody.innerHTML = items.map(it => `
    <tr>
      <td><input type="checkbox" class="row-check" data-id="${it.id}" ${selectedIds.has(it.id) ? "checked" : ""}></td>
      <td>${it.job_title || "-"}</td>
      <td>${it.location_city || "-"}</td>
      <td><small>${new Date(it.updated_on).toLocaleDateString("de-DE")} ${new Date(it.updated_on).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}</small></td>
      <td>${it.transfer_flag ? "<span class='ba-chip'>true</span>" : "<span class='ba-chip'>false</span>"}</td>
      <td><span class="ba-chip ${it.ba_status==="OK"?"ba-chip--ok":it.ba_status==="ERROR"?"ba-chip--error":"ba-chip--wait"}">${it.ba_status || "-"}</span></td>
      <td><button type="button" class="ba-btn ba-btn--ghost" data-id="${it.id}" data-action="upload-one">Upload</button></td>
    </tr>
  `).join("");

  // Checkbox-Events
  $cmsBody.querySelectorAll(".row-check").forEach(cb => {
    cb.addEventListener("change", e => {
      const id = e.target.dataset.id;
      e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
      updateSelectionButtons();
    });
  });

  // Einzel-Upload
  $cmsBody.querySelectorAll("button[data-action='upload-one']").forEach(btn => {
    btn.addEventListener("click", async e => {
      const id = e.currentTarget.dataset.id;
      setNotice(`Eintrag ${id} wird hochgeladen …`);
      toggleDisabled(true);
      try {
        const resp = await postHook(WH_UPLOAD_SELECTED, { ids: [id] });
        setNotice(resp, "ok");
      } catch {
        setNotice("Fehler beim Einzel-Upload.", "error");
      } finally {
        toggleDisabled(false);
      }
    });
  });
}

// Buttons aktivieren/deaktivieren
function updateSelectionButtons() {
  const n = selectedIds.size;
  $uploadSelected.disabled = n === 0;
  $clearSelection.disabled = n === 0;
  $uploadSelected.textContent = `Ausgewählte übertragen (${n})`;
  $selectAll.checked = cmsItems.length && cmsItems.every(it => selectedIds.has(it.id));
}

// Liste vom Webhook laden
async function loadList() {
  setNotice("Lade CMS-Einträge …");
  try {
    const res = await fetch(WH_LIST, { method: "POST" });
    const data = await res.json();
    cmsItems = data.items || [];
    renderCmsTable(cmsItems);
    updateSelectionButtons();
    setNotice(`Es wurden ${cmsItems.length} Einträge geladen.`, "ok");
  } catch (err) {
    setNotice("Fehler beim Laden der Liste.", "error");
  }
}

// Buttons / Events
$refresh?.addEventListener("click", loadList);
$clearSelection?.addEventListener("click", () => {
  selectedIds.clear();
  renderCmsTable(cmsItems);
  updateSelectionButtons();
});
$selectAll?.addEventListener("change", e => {
  if (e.target.checked) cmsItems.forEach(it => selectedIds.add(it.id));
  else selectedIds.clear();
  renderCmsTable(cmsItems);
  updateSelectionButtons();
});
$uploadSelected?.addEventListener("click", async () => {
  if (!selectedIds.size) return;
  const ids = Array.from(selectedIds);
  setNotice(`Übertrage ${ids.length} ausgewählte Einträge …`);
  toggleDisabled(true);
  try {
    const resp = await postHook(WH_UPLOAD_SELECTED, { ids });
    setNotice(resp, "ok");
  } catch {
    setNotice("Fehler beim Sammel-Upload.", "error");
  } finally {
    toggleDisabled(false);
  }
});

// beim Laden initial ausführen
loadList();




/* ========= Escape/UX ========= */
document.addEventListener('keydown', e => {
  if (e.key === "Escape") $list.classList.add('hidden');
});
</script>
