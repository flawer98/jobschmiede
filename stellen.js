/* ========= Konfiguration ========= */
const WH_SAVE             = "https://hook.eu2.make.com/krje3ftzgbomitzs8ca8a5f5mc5c5bhf";
const WH_UPLOAD           = "https://hook.integromat.com/yyyyy";
const WH_UPLOAD_LAST      = "https://hook.integromat.com/zzzzz";
const WH_LIST             = "https://hook.eu2.make.com/1thp5v89ydmjmr6oaz9zfea0h5alnpky";
const WH_UPLOAD_SELECTED  = "https://hook.integromat.com/BBBBB";
const WH_DELETE_SELECTED  = "https://hook.integromat.com/DDDDD";

// BA-Berufsliste (raw JSON)
const JSON_URL = "https://raw.githubusercontent.com/flawer98/jobschmiede/main/ba_jobs.json";

/* ========= Hilfsfunktionen ========= */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let cmsItems = [];
let cmsIdIndex = new Map();
let cmsNameIndex = new Map();
let listLoadingPromise = null;
const selectionState = { ids: new Set() };

function getSelectionSet() {
  if (!(selectionState.ids instanceof Set)) {
    selectionState.ids = new Set();
  }
  return selectionState.ids;
}

function logError(context, error) {
  console.error(`[${context}]`, error);
}

const normalizeId = value => String(value ?? "");

const normalizeComparable = value => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function buildCmsKey(item) {
  if (!item) return "";
  const title = normalizeComparable(item.job_title);
  if (!title) return "";
  const supplier = normalizeComparable(item.supplier_id);
  const city = normalizeComparable(item.location_city);
  return `${title}|${supplier}|${city}`;
}

function rebuildCmsIndexes(items = cmsItems) {
  cmsIdIndex = new Map();
  cmsNameIndex = new Map();
  for (const item of items) {
    const normalizedId = normalizeId(item?.id);
    if (normalizedId) {
      cmsIdIndex.set(normalizedId, item);
    }
    const key = buildCmsKey(item);
    if (key) {
      cmsNameIndex.set(key, item);
    }
  }
}

function registerCmsItem(item) {
  if (!item) return;
  const normalizedId = normalizeId(item.id);
  if (normalizedId) {
    cmsIdIndex.set(normalizedId, item);
  }
  const key = buildCmsKey(item);
  if (key) {
    cmsNameIndex.set(key, item);
  }
}

function findCmsItemMatchByName(data) {
  if (!cmsItems.length || !data) return null;

  const title = normalizeComparable(data.job_title);
  const city  = normalizeComparable(data.location_city);

  if (!title || !city) return null;

  // Suche nach gleichem Titel UND Stadt
  return cmsItems.find(item => {
    if (!item) return false;
    const sameTitle = normalizeComparable(item.job_title) === title;
    const sameCity  = normalizeComparable(item.location_city) === city;
    return sameTitle && sameCity;
  }) || null;
}


function extractItemId(response) {
  if (!response) return null;
  if (typeof response === "string") {
    try { return extractItemId(JSON.parse(response)); } catch {}
    const match = response.match(/(?:item[_-]?id|external[_-]?id|id)["']?[:=]\s*"?([\w-]{6,})"?/i);
    return match ? match[1] : null;
  }
  if (typeof response === "object") {
    if (response.itemId) return String(response.itemId);
    if (response.item_id) return String(response.item_id);
    if (response.external_id) return String(response.external_id);
    if (response.id) return String(response.id);
    if (Array.isArray(response.items)) {
      for (const item of response.items) {
        const nested = extractItemId(item);
        if (nested) return nested;
      }
    }
    if (response.item) {
      const nested = extractItemId(response.item);
      if (nested) return nested;
    }
    if (response.data) {
      const nested = extractItemId(response.data);
      if (nested) return nested;
    }
    if (typeof response.raw === "string") return extractItemId(response.raw);
  }
  return null;
}

function setNotice(text, type = "info") {
  const box = $("#notice");
  if (!box) return;
  box.textContent = typeof text === "string" ? text : text != null ? JSON.stringify(text, null, 2) : "";
  box.classList.remove("ba-notice--ok","ba-notice--warn","ba-notice--error");
  if (type === "ok") box.classList.add("ba-notice--ok");
  if (type === "warn") box.classList.add("ba-notice--warn");
  if (type === "error") box.classList.add("ba-notice--error");
}

function extractErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return `${fallback} (${error.message})`;
  if (error.status) {
    const statusText = `HTTP ${error.status}`;
    if (error.body) return `${fallback} (${statusText}: ${error.body})`;
    return `${fallback} (${statusText})`;
  }
  return fallback;
}

async function postHook(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    if (!res.ok) {
      const error = new Error(`Request failed with status ${res.status}`);
      error.status = res.status;
      error.body = txt;
      throw error;
    }
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  } catch (error) {
    logError("postHook", error);
    throw error;
  }
}

function toggleDisabled(disabled) {
  ["save","upload-now","batch-10","batch-20","btn-upload-selected","btn-delete-selected"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled=disabled;
  });
  const gen=document.getElementById("btn-generate-xml");
  if(gen){
    if(disabled){
      gen.dataset.locked="1";
      gen.disabled=true;
    }else{
      if(gen.dataset.locked){
        delete gen.dataset.locked;
        gen.disabled=getSelectionSet().size===0;
      }
    }
  }
  if(!disabled) updateSelectionButtons();
}

function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"")); }
function requireEitherEmailOrUrl(data){
  const hasEmail=data.application_email&&isValidEmail(data.application_email);
  const hasUrl=data.application_url&&/^https?:\/\//i.test(String(data.application_url||""));
  return hasEmail||hasUrl;
}
function padPartnerId10(v) {
  const raw = String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "";
  // Falls bereits korrektes Format (V/P/K + 9 Ziffern)
  if (/^[VPK]\d{9}$/.test(raw)) return raw;
  // Falls 7-stellig, hänge "00" an
  if (/^[VPK]\d{7}$/.test(raw)) return raw + "00";
  // Falls zu kurz, mit Nullen auffüllen
  if (/^[VPK]\d{1,8}$/.test(raw)) {
    const prefix = raw[0];
    const num = raw.slice(1).padStart(8, "0");
    return prefix + num + "0";
  }
  return raw;
}

function formatTimestampForBA(d=new Date()){
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function buildBAFilename(partnerId){
  const pid=padPartnerId10(partnerId);
  if(!/^[VPK]\d{9}$/.test(pid)) return "DSXXXXXXXXXX_0000-00-00_00-00-00.xml";
  const ts=formatTimestampForBA();
  return `DS${pid}_${ts}.xml`;
}
function escapeXML(str){
  return String(str??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
const escapeHTML=escapeXML;
function updateFilenamePreview(){
  const pid=$("#supplier_id")?.value||"";
  $("#filename_preview").textContent=buildBAFilename(pid);
}

/* ========= Autocomplete (BA Beruf) ========= */
let jobIndex=[];
let debounceTimer=null;
const MAX_RESULTS=15;
const $search=$("#ba-search");
const $list=$("#suggestions");
const $code=$("#ba_title_code");
const $label=$("#ba_title_label");
const $bkz=$("#ba_bkz");

async function loadJobs(){
  if(jobIndex.length) return;
  try{
    const res=await fetch(JSON_URL,{cache:"force-cache"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if(!Array.isArray(data)) throw new Error("Ungültiges JSON-Format");
    jobIndex=data;
  }catch(error){
    logError("loadJobs", error);
    setNotice(extractErrorMessage(error,"Konnte BA-Jobliste nicht laden."),"error");
  }
}
function searchJobs(q){
  q=q.toLowerCase();
  return jobIndex.filter(j=>
    (j.neutral_kurz||"").toLowerCase().includes(q)||
    (j.bkz||"").toLowerCase().includes(q)||
    (j.title_code||"").toLowerCase().includes(q)
  ).slice(0,MAX_RESULTS);
}
function renderSuggestions(res){
  if(!res.length){$list.innerHTML="";$list.classList.add("hidden");return;}
  $list.innerHTML=res.map(r=>
    `<li class="ba-suggestion" data-code="${escapeHTML(r.title_code)}" data-label="${escapeHTML(r.neutral_kurz)}" data-bkz="${escapeHTML(r.bkz)}">
      <span>${escapeHTML(r.neutral_kurz)}</span><small>${escapeHTML(r.bkz)}</small>
    </li>`).join('');
  $list.classList.remove("hidden");
}
$search?.addEventListener("focus",loadJobs);
$search?.addEventListener("input",e=>{
  clearTimeout(debounceTimer);
  const v=e.target.value.trim();
  if(v.length<2){$list.classList.add("hidden");return;}
  debounceTimer=setTimeout(()=>renderSuggestions(searchJobs(v)),150);
});
$list?.addEventListener("click",e=>{
  const li=e.target.closest("li");
  if(!li)return;
  $code.value=li.dataset.code;
  $label.value=li.dataset.label;
  $bkz.value=li.dataset.bkz;
  $search.value=`${li.dataset.label} (${li.dataset.bkz})`;
  $list.classList.add("hidden");
});

/* ========= Formular ========= */
function serializeForm(form){
  const data=Object.fromEntries(new FormData(form).entries());
  for(const key of Object.keys(data)){
    if(typeof data[key]==="string") data[key]=data[key].trim();
  }
  data.transfer_flag=$("#transfer_flag")?.checked||false;
  if(data.working_hours) data.working_hours=Number(data.working_hours);
  return data;
}
function validate(data){
  const form=$("#job-form");
  if(!form.checkValidity()){form.reportValidity();return{ok:false,msg:"Bitte Pflichtfelder prüfen."};}
  if(!data.ba_title_code||!data.ba_bkz||!data.ba_title_label) return{ok:false,msg:"Bitte BA-Beruf auswählen."};
  if(!requireEitherEmailOrUrl(data)) return{ok:false,msg:"Bitte E-Mail ODER Bewerbungs-URL angeben."};
  if(!data.supplier_id||String(data.supplier_id).trim().length!==10) return{ok:false,msg:"Partner-ID muss 10-stellig sein."};
  if (!/^[VPK]\d{9}$/i.test(data.supplier_id)) return { ok: false, msg: "Partner-ID muss mit V, P oder K beginnen und insgesamt 10 Zeichen (1 Buchstabe + 9 Ziffern) haben." };
  return{ok:true};

  
}
$("#supplier_id")?.addEventListener("input",updateFilenamePreview);
updateFilenamePreview();

let isSaving=false;

$("#job-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(isSaving) return;
  await ensureCmsListLoaded();
  const data=serializeForm(e.currentTarget);
  // Dublettenprüfung: Jobtitel + Stadt
  const duplicate = findCmsItemMatchByName(data);
  if (duplicate) {
  setNotice(`Ein Job mit dem Titel "${data.job_title}" in "${data.location_city}" existiert bereits. Bitte ändere Titel oder Stadt.`, "error");
  return;
}
  const v=validate(data);
  if(!v.ok){setNotice(v.msg,"warn");return;}
  setNotice("Speichern …");toggleDisabled(true);
  try{
    isSaving=true;
    const resp=await postHook(WH_SAVE,{item:data});
    setNotice(resp||"Gespeichert","ok");
    const newId=extractItemId(resp);
    if(newId) {
      $("#external_id").value=newId;
      data.external_id=newId;
      data.id=newId;
    }
    await loadList({silent:true,preserveNotice:true});
    if(newId){
      const refreshed=cmsIdIndex.get(newId)??data;
      registerCmsItem(refreshed);
    }
  }catch(error){setNotice(extractErrorMessage(error,"Fehler beim Speichern."),"error");}
  finally{isSaving=false;toggleDisabled(false);updateFilenamePreview();}
});
$("#upload-now")?.addEventListener("click",async()=>{
  await ensureCmsListLoaded();
  const data=serializeForm($("#job-form"));
  applyExistingExternalId(data);
  const v=validate(data);
  if(!v.ok){setNotice(v.msg,"warn");return;}
  const filename=buildBAFilename(data.supplier_id);
  setNotice(`Übertrage an BA … ${filename}`);toggleDisabled(true);
  try{
    const resp=await postHook(WH_UPLOAD,{item:data,filename_hint:filename});
    if(resp?.status==="OK"||resp?.ok===true) setNotice(resp,"ok"); else setNotice(resp||"Unbekannte Antwort","error");
  }catch(error){setNotice(extractErrorMessage(error,"Fehler beim Upload."),"error");}
  finally{toggleDisabled(false);}
});
$("#batch-10")?.addEventListener("click",()=>batchUpload(10));
$("#batch-20")?.addEventListener("click",()=>batchUpload(20));
async function batchUpload(n){
  setNotice(`Batch-Upload (${n}) gestartet …`);toggleDisabled(true);
  try{setNotice(await postHook(WH_UPLOAD_LAST,{limit:n}),"ok");}
  catch(error){setNotice(extractErrorMessage(error,"Fehler beim Batch-Upload."),"error");}
  finally{toggleDisabled(false);}
}

/* ========= CMS-Listenlogik ========= */
const $cmsBody=$("#cms-tbody");
const $searchInput = $("#search-input");
const $statusFilter = $("#status-filter");
const $flagFilter = $("#filter-transfer");

const $selectAll=$("#select-all");
const $uploadSelected=$("#btn-upload-selected");
const $deleteSelected=$("#btn-delete-selected");
const $clearSelection=$("#btn-clear-selection");
const $refresh=$("#btn-refresh");
const $generateXml=$("#btn-generate-xml");

async function ensureCmsListLoaded(){
  if(cmsItems.length){return;}
  if(listLoadingPromise){
    try{await listLoadingPromise;}catch(error){logError("ensureCmsListLoaded",error);}
    return;
  }
  try{await loadList({silent:true,preserveNotice:true});}
  catch(error){logError("ensureCmsListLoaded",error);}
}

function applyCmsFilters() {
  if (!cmsItems || !cmsItems.length) return;

  let filtered = [...cmsItems];

  // 🔍 Textsuche (Titel oder Ort)
  const query = ($searchInput?.value || "").trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(item =>
      (item.job_title || "").toLowerCase().includes(query) ||
      (item.location_city || "").toLowerCase().includes(query)
    );
  }

  // 🏷️ Statusfilter
  const status = ($statusFilter?.value || "alle").toLowerCase();
  if (status !== "alle") {
    filtered = filtered.filter(item =>
      (item.ba_status || "").toLowerCase() === status
    );
  }

  // 🚩 Transfer-Flag
  if ($flagFilter?.checked) {
    filtered = filtered.filter(item => item.transfer_flag === true);
  }

  // Tabelle aktualisieren
  renderCmsTable(filtered);
  updateSelectionButtons();
}



$searchInput?.addEventListener("input", applyCmsFilters);
$statusFilter?.addEventListener("change", applyCmsFilters);
$flagFilter?.addEventListener("change", applyCmsFilters);


function renderCmsTable(items){
  if(!$cmsBody) return;
  if(!items?.length){$cmsBody.innerHTML="<tr><td colspan='7'>Keine Einträge gefunden.</td></tr>";return;}
  const selection=getSelectionSet();
  $cmsBody.innerHTML=items.map(it=>
    `<tr>
      <td><input type="checkbox" class="row-check" data-id="${escapeHTML(it.id)}" ${selection.has(normalizeId(it.id))?"checked":""} ${it.ba_status==="OK"?"disabled":""}></td>
      <td>${escapeXML(it.job_title||"-")}</td>
      <td>${escapeXML(it.location_city||"-")}</td>
      <td><small>${it.updated_on?new Date(it.updated_on).toLocaleDateString("de-DE")+" "+new Date(it.updated_on).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}):"-"}</small></td>
      <td>${it.transfer_flag?"<span class='ba-chip'>true</span>":"<span class='ba-chip'>false</span>"}</td>
      <td><span class="ba-chip ${it.ba_status==="OK"?"ba-chip--ok":it.ba_status==="ERROR"?"ba-chip--error":"ba-chip--wait"}">${escapeXML(it.ba_status||"-")}</span></td>
      <td><button type="button" class="ba-btn ba-btn--ghost" data-id="${escapeHTML(it.id)}" ${it.ba_status==="OK"?"disabled":""}>Upload</button></td>
    </tr>`).join("");

  $cmsBody.querySelectorAll(".row-check").forEach(cb=>{
    cb.addEventListener("change",e=>{
      const id=normalizeId(e.target.dataset.id);
      const selection=getSelectionSet();
      e.target.checked?selection.add(id):selection.delete(id);
      updateSelectionButtons();
    });
  });
  $cmsBody.querySelectorAll("button.ba-btn").forEach(btn=>{
    btn.addEventListener("click",async e=>{
      const id=normalizeId(e.currentTarget.dataset.id);
      const job=cmsItems.find(j=>normalizeId(j.id)===id);
      if(!job) return;
      if(job.ba_status==="OK"){setNotice("Bereits gesendet – übersprungen","warn");return;}
      await sendToMake("INSERT",[job]);
    });
  });
}
function updateSelectionButtons(){
  const selection=getSelectionSet();
  const n=selection.size;
  if($uploadSelected) $uploadSelected.disabled=n===0;
  if($deleteSelected) $deleteSelected.disabled=n===0;
  if($clearSelection) $clearSelection.disabled=n===0;
  if($generateXml && !$generateXml.dataset.locked) $generateXml.disabled=n===0;
  if($uploadSelected) $uploadSelected.textContent=`Ausgewählte übertragen (${n})`;
  if($deleteSelected) $deleteSelected.textContent=`In BA löschen (${n})`;
  if($selectAll) $selectAll.checked=cmsItems.length&&cmsItems.every(it=>selection.has(normalizeId(it.id)));
}
async function loadList(options={}){
  if(typeof Event!=="undefined" && options instanceof Event){
    options={};
  }
  const {silent=false,preserveNotice=false}=options;
  if(listLoadingPromise){
    return listLoadingPromise;
  }
  const run=(async()=>{
    if(!silent && !preserveNotice){
      setNotice("Lade CMS-Einträge …");
    }
    try{
      const res=await fetch(WH_LIST,{method:"POST"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      if(!data||!Array.isArray(data.items)) throw new Error("Ungültige Antwort vom Server");
      cmsItems=data.items||[];
      rebuildCmsIndexes();
      const validIds=new Set(cmsItems.map(it=>normalizeId(it.id)));
      const currentSelection=getSelectionSet();
      const filtered=new Set();
      currentSelection.forEach(id=>{if(validIds.has(id)) filtered.add(id);});
      selectionState.ids=filtered;
      applyCmsFilters();
      if(!silent && !preserveNotice){
        setNotice(`Es wurden ${cmsItems.length} Einträge geladen.`,"ok");
      }
    }catch(error){
      logError("loadList", error);
      cmsItems=[];
      rebuildCmsIndexes();
      renderCmsTable(cmsItems);
      updateSelectionButtons();
      setNotice(extractErrorMessage(error,"Fehler beim Laden der Liste."),"error");
      throw error;
    }
  })();
  listLoadingPromise=run;
  try{
    await run;
  }finally{
    listLoadingPromise=null;
  }
  return run;
}

/* ========= Partner-ID Ermittlung ========= */
function resolvePartnerIdFromJobsOrForm(jobs) {
  const valid = id => /^[VPK]\d{9}$/i.test(id);
  const norm  = v => padPartnerId10(String(v || "").trim());

  // Wenn genau ein Job ausgewählt ist → direkt dessen ID nehmen
  if (Array.isArray(jobs) && jobs.length === 1) {
    const id = norm(jobs[0]?.supplier_id);
    if (valid(id)) return id;
  }

  // Wenn mehrere Jobs ausgewählt → prüfen, ob alle dieselbe gültige ID haben
  if (Array.isArray(jobs) && jobs.length > 1) {
    const jobIds = jobs.map(j => norm(j?.supplier_id)).filter(valid);
    const uniqueIds = [...new Set(jobIds)];
    if (uniqueIds.length === 1) return uniqueIds[0]; // alle gleich → ok
  }

  // Fallback: Formularfeld (#supplier_id)
  const formId = norm($("#supplier_id")?.value || "");
  if (valid(formId)) return formId;

  // Nichts brauchbares gefunden
  return "";
}


/* ========= XML Builder ========= */
function buildMultiJobXML(jobs,typeOfLoad="INSERT"){
  if(!jobs.length) return "";
  const supplierId=padPartnerId10(jobs[0].supplier_id);
  const timestamp=new Date().toISOString();
  let xml=`<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml+=`<HRBAXMLJobPositionPosting xmlns="http://xml.hr-xml.org/2007-04-15">\n`;
  xml+=`  <Header>\n`;
  xml+=`    <SupplierId>${escapeXML(supplierId)}</SupplierId>\n`;
  xml+=`    <Timestamp>${escapeXML(timestamp)}</Timestamp>\n`;
  xml+=`    <TypeOfLoad>${escapeXML(typeOfLoad)}</TypeOfLoad>\n`;
  xml+=`  </Header>\n`;
  xml+=`  <JobPositionPostings>\n`;
  for(const job of jobs){ xml+=buildBAJobXML(job); }
  xml+=`  </JobPositionPostings>\n</HRBAXMLJobPositionPosting>`;
  return xml;
}
function buildBAJobXML(data){
  let xml=`    <JobPositionPosting>\n`;
  xml+=`      <PositionDetail>\n`;
  xml+=`        <PositionTitle>${escapeXML(data.job_title||"")}</PositionTitle>\n`;
  xml+=`        <JobCategory code="${escapeXML(data.ba_title_code||"")}">${escapeXML(data.ba_title_label||"")}</JobCategory>\n`;
  xml+=`        <Description>${escapeXML(data.description_rich||"")}</Description>\n`;
  xml+=`        <EmploymentType>${escapeXML(data.employment_type||"")}</EmploymentType>\n`;
  if(data.working_hours) xml+=`        <WorkingHours>${Number(data.working_hours)}</WorkingHours>\n`;
  if(data.valid_from) xml+=`        <PostingStartDate>${escapeXML(data.valid_from)}</PostingStartDate>\n`;
  if(data.valid_to) xml+=`        <PostingEndDate>${escapeXML(data.valid_to)}</PostingEndDate>\n`;
  xml+=`      </PositionDetail>\n`;
  xml+=`      <Company>\n`;
  xml+=`        <Name>${escapeXML(data.company_name||"")}</Name>\n`;
  xml+=`        <SupplierID>${escapeXML(padPartnerId10(data.supplier_id||""))}</SupplierID>\n`;
  xml+=`      </Company>\n`;
  xml+=`      <Location>\n`;
  xml+=`        <City>${escapeXML(data.location_city||"")}</City>\n`;
  xml+=`        <PostalCode>${escapeXML(data.location_postcode||"")}</PostalCode>\n`;
  xml+=`        <Country>${escapeXML(data.location_country||"")}</Country>\n`;
  xml+=`      </Location>\n`;
  xml+=`      <Contact>\n`;
  xml+=`        <Name>${escapeXML(data.contact_name||"")}</Name>\n`;
  if(data.application_email) xml+=`        <Email>${escapeXML(data.application_email)}</Email>\n`;
  if(data.application_url) xml+=`        <Url>${escapeXML(data.application_url)}</Url>\n`;
  xml+=`      </Contact>\n`;
  xml+=`    </JobPositionPosting>\n`;
  return xml;
}

/* ========= XML Datei generieren ========= */
$("#btn-generate-xml")?.addEventListener("click", async () => {
  const selection = getSelectionSet();
  if (!selection.size) {
    setNotice("Bitte mindestens eine Stelle auswählen.", "warn");
    return;
  }

  const sel = cmsItems.filter(it => selection.has(normalizeId(it.id)));
  if (!sel.length) {
    setNotice("Keine passenden Daten.", "warn");
    return;
  }

  // ✅ Partner-ID robust bestimmen
  const partnerId = resolvePartnerIdFromJobsOrForm(sel);
  if (!partnerId) {
    setNotice("Ungültige oder fehlende Partner-ID. Bitte Partner-ID im Formular prüfen.", "error");
    return;
  }

  const xml = buildMultiJobXML(sel, "INSERT");
  const filename = buildBAFilename(partnerId);

  // Datei-Export mit richtigem Namen
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  setNotice(`XML-Datei "${filename}" mit ${sel.length} Stellen erzeugt.`, "ok");
});


/* ========= Make Upload/Delete ========= */
async function sendToMake(typeOfLoad, jobs) {
  if (!jobs.length) return;

  // ✅ Partner-ID wie oben ermitteln
  const partnerId = resolvePartnerIdFromJobsOrForm(jobs);
  if (!partnerId) {
    setNotice("Ungültige oder fehlende Partner-ID. Upload abgebrochen.", "error");
    return;
  }

  const filename = buildBAFilename(partnerId);
  const xml = buildMultiJobXML(jobs, typeOfLoad);
  if (!xml) {
    setNotice("Konnte XML nicht erzeugen.", "error");
    return;
  }

  const hook = typeOfLoad === "DELETE" ? WH_DELETE_SELECTED : WH_UPLOAD_SELECTED;
  setNotice(`${typeOfLoad === "DELETE" ? "Lösche" : "Übertrage"} ${jobs.length} Einträge …`);
  toggleDisabled(true);

  try {
    const resp = await postHook(hook, {
      filename,
      supplier_id: partnerId,
      typeOfLoad,
      ids: jobs.map(j => j.id),
      xml_content: xml
    });

    if (resp?.status === "OK" || resp?.ok === true) setNotice(resp, "ok");
    else setNotice(resp || "Unbekannte Antwort", "error");

  } catch (error) {
    setNotice(extractErrorMessage(error, "Fehler beim Senden an Make."), "error");
  } finally {
    toggleDisabled(false);
  }
}


/* ========= Button Aktionen ========= */
$uploadSelected?.addEventListener("click",async()=>{
  const selection=getSelectionSet();
  const sel=cmsItems.filter(it=>selection.has(normalizeId(it.id))&&it.ba_status!=="OK");
  if(!sel.length){setNotice("Alle ausgewählten Stellen wurden bereits gesendet.","warn");return;}
  await sendToMake("INSERT",sel);
});
$deleteSelected?.addEventListener("click",async()=>{
  const selection=getSelectionSet();
  const sel=cmsItems.filter(it=>selection.has(normalizeId(it.id)));
  if(!sel.length){setNotice("Keine Auswahl.","warn");return;}
  await sendToMake("DELETE",sel);
});
$clearSelection?.addEventListener("click", ()=>{
  getSelectionSet().clear();
  applyCmsFilters();               // ← respektiert aktuelle Filter
  updateSelectionButtons();
});

$selectAll?.addEventListener("change", e=>{
  const selection=getSelectionSet();
  if(e.target.checked){
    cmsItems.forEach(it=>{ if(it.ba_status!=="OK") selection.add(normalizeId(it.id)); });
  }else{
    selection.clear();
  }
  applyCmsFilters();               // ← statt renderCmsTable(cmsItems)
  updateSelectionButtons();
});

$refresh?.addEventListener("click",loadList);

/* ========= Init ========= */
loadList();

/* ========= UX ========= */
document.addEventListener("keydown",e=>{if(e.key==="Escape")$list?.classList.add("hidden");});

// Wende Filter an, sobald Liste geladen ist
setTimeout(applyCmsFilters, 500);

