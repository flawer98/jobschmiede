/* ========= Konfiguration ========= */
const WH_SAVE             = "https://hook.eu2.make.com/krje3ftzgbomitzs8ca8a5f5mc5c5bhf";
const WH_LIST             = "https://hook.eu2.make.com/1thp5v89ydmjmr6oaz9zfea0h5alnpky";
const WH_UPLOAD_SELECTED  = "https://hook.integromat.com/BBBBB"; // Upload
const WH_DELETE_SELECTED  = "https://hook.integromat.com/DDDDD"; // Delete

const JSON_URL = "https://raw.githubusercontent.com/flawer98/jobschmiede/main/ba_jobs.json";

/* ========= Hilfsfunktionen ========= */
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setNotice(text, type = "info") {
  const box = $("#notice");
  if (!box) return;
  box.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  box.classList.remove("ba-notice--ok","ba-notice--warn","ba-notice--error");
  if (type === "ok") box.classList.add("ba-notice--ok");
  if (type === "warn") box.classList.add("ba-notice--warn");
  if (type === "error") box.classList.add("ba-notice--error");
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
  ["save","upload-now","btn-upload-selected","btn-delete-selected","btn-generate-xml"].forEach(id=>{
    const el=document.getElementById(id); if(el) el.disabled=disabled;
  });
}

function padPartnerId10(v) {
  const raw = String(v||"").trim().toLowerCase();
  const m7 = raw.match(/^[vpk]\d{7}$/);
  const m9 = raw.match(/^[vpk]\d{9}$/);
  if (m7) return raw + "00";
  if (m9) return raw;
  return raw;
}

function formatTimestampForBA(d=new Date()) {
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildBAFilename(partnerId) {
  const pid = padPartnerId10(partnerId);
  if(!/^[vpk]\d{9}$/.test(pid)) return "DSXXXXXXXXXX_0000-00-00_00-00-00.xml";
  const ts=formatTimestampForBA().replace(/[:T]/g,"-");
  return `DS${pid}_${ts}.xml`;
}

function escapeXML(str){
  return String(str??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

/* ========= CMS Liste ========= */
let cmsItems = [];
let selectedIds = new Set();

const $cmsBody         = document.getElementById("cms-tbody");
const $selectAll       = document.getElementById("select-all");
const $uploadSelected  = document.getElementById("btn-upload-selected");
const $deleteSelected  = document.getElementById("btn-delete-selected");
const $clearSelection  = document.getElementById("btn-clear-selection");
const $refresh         = document.getElementById("btn-refresh");

function renderCmsTable(items){
  if(!$cmsBody) return;
  if(!items?.length){
    $cmsBody.innerHTML="<tr><td colspan='7'>Keine Einträge gefunden.</td></tr>";
    return;
  }

  $cmsBody.innerHTML = items.map(it=>`
    <tr>
      <td><input type="checkbox" class="row-check" data-id="${it.id}" ${selectedIds.has(it.id)?"checked":""} ${it.ba_status==="OK"?"disabled":""}></td>
      <td>${escapeXML(it.job_title||"-")}</td>
      <td>${escapeXML(it.location_city||"-")}</td>
      <td><small>${it.updated_on?new Date(it.updated_on).toLocaleDateString("de-DE")+" "+new Date(it.updated_on).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}):"-"}</small></td>
      <td>${it.transfer_flag?"<span class='ba-chip'>true</span>":"<span class='ba-chip'>false</span>"}</td>
      <td><span class="ba-chip ${it.ba_status==="OK"?"ba-chip--ok":it.ba_status==="ERROR"?"ba-chip--error":"ba-chip--wait"}">${escapeXML(it.ba_status||"-")}</span></td>
      <td><button type="button" class="ba-btn ba-btn--ghost" data-id="${it.id}" data-action="upload-one" ${it.ba_status==="OK"?"disabled":""}>Upload</button></td>
    </tr>
  `).join("");

  $cmsBody.querySelectorAll(".row-check").forEach(cb=>{
    cb.addEventListener("change",e=>{
      const id=e.target.dataset.id;
      e.target.checked?selectedIds.add(id):selectedIds.delete(id);
      updateSelectionButtons();
    });
  });

  $cmsBody.querySelectorAll("button[data-action='upload-one']").forEach(btn=>{
    btn.addEventListener("click",async e=>{
      const id=e.currentTarget.dataset.id;
      const job=cmsItems.find(j=>j.id===id);
      if(!job) return;
      if(job.ba_status==="OK"){ setNotice("Bereits gesendet – übersprungen","warn"); return; }
      await sendToMake("INSERT",[job]);
    });
  });
}

function updateSelectionButtons(){
  const n=selectedIds.size;
  [$uploadSelected,$deleteSelected,$clearSelection].forEach(b=>{ if(b) b.disabled=n===0; });
  if($uploadSelected) $uploadSelected.textContent=`Ausgewählte übertragen (${n})`;
  if($deleteSelected) $deleteSelected.textContent=`In BA löschen (${n})`;
  if($selectAll) $selectAll.checked=cmsItems.length && cmsItems.every(it=>selectedIds.has(it.id));
}

async function loadList(){
  setNotice("Lade CMS-Einträge …");
  try{
    const res=await fetch(WH_LIST,{method:"POST"});
    const data=await res.json();
    cmsItems=data.items||[];
    renderCmsTable(cmsItems);
    updateSelectionButtons();
    setNotice(`Es wurden ${cmsItems.length} Einträge geladen.`,"ok");
  }catch{
    setNotice("Fehler beim Laden der Liste.","error");
  }
}

/* ========= XML Builder ========= */
function buildMultiJobXML(jobs,typeOfLoad="INSERT"){
  if(!jobs.length) return "";
  const supplierId=padPartnerId10(jobs[0].supplier_id);
  const timestamp=formatTimestampForBA();
  let xml=`<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml+=`<HRBAXMLJobPositionPosting xmlns="http://xml.hr-xml.org/2007-04-15">\n`;
  xml+=`  <Header>\n`;
  xml+=`    <SupplierId>${escapeXML(supplierId)}</SupplierId>\n`;
  xml+=`    <Timestamp>${timestamp}</Timestamp>\n`;
  xml+=`    <TypeOfLoad>${escapeXML(typeOfLoad)}</TypeOfLoad>\n`;
  xml+=`  </Header>\n`;
  xml+=`  <JobPositionPostings>\n`;
  for(const job of jobs){
    xml+=buildBAJobXML(job);
  }
  xml+=`  </JobPositionPostings>\n`;
  xml+=`</HRBAXMLJobPositionPosting>`;
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
  if(data.valid_from)   xml+=`        <PostingStartDate>${escapeXML(data.valid_from)}</PostingStartDate>\n`;
  if(data.valid_to)     xml+=`        <PostingEndDate>${escapeXML(data.valid_to)}</PostingEndDate>\n`;
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
  if(data.application_url)   xml+=`        <Url>${escapeXML(data.application_url)}</Url>\n`;
  xml+=`      </Contact>\n`;
  xml+=`    </JobPositionPosting>\n`;
  return xml;
}

/* ========= XML Download ========= */
$("#btn-generate-xml")?.addEventListener("click",async()=>{
  if(!selectedIds.size){ setNotice("Bitte mindestens eine Stelle auswählen.","warn"); return; }
  const selected=cmsItems.filter(it=>selectedIds.has(it.id));
  if(!selected.length){ setNotice("Keine passenden CMS-Daten gefunden.","warn"); return; }
  const xml=buildMultiJobXML(selected,"INSERT");
  const filename=buildBAFilename(selected[0]?.supplier_id);
  const blob=new Blob([xml],{type:"application/xml"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
  setNotice(`XML-Datei "${filename}" wurde erzeugt.`,"ok");
});

/* ========= Übertragung an Make ========= */
async function sendToMake(typeOfLoad,jobs){
  if(!jobs.length) return;
  const filename=buildBAFilename(jobs[0]?.supplier_id);
  const xml=buildMultiJobXML(jobs,typeOfLoad);
  const hook=typeOfLoad==="DELETE"?WH_DELETE_SELECTED:WH_UPLOAD_SELECTED;
  setNotice(`${typeOfLoad==="DELETE"?"Lösche":"Übertrage"} ${jobs.length} Einträge …`);
  toggleDisabled(true);
  try{
    const resp=await postHook(hook,{
      filename,
      supplier_id: jobs[0]?.supplier_id,
      typeOfLoad,
      ids: jobs.map(j=>j.id),
      xml_content: xml
    });
    if(resp?.status==="OK"||resp?.ok===true){
      setNotice(resp,"ok");
    }else{
      setNotice(resp,"error");
    }
  }catch{
    setNotice("Fehler beim Senden an Make.","error");
  }finally{
    toggleDisabled(false);
  }
}

/* ========= Buttons ========= */
$uploadSelected?.addEventListener("click",async()=>{
  if(!selectedIds.size){ setNotice("Bitte auswählen.","warn"); return; }
  const sel=cmsItems.filter(it=>selectedIds.has(it.id)&&it.ba_status!=="OK");
  if(!sel.length){ setNotice("Alle ausgewählten Stellen wurden bereits gesendet.","warn"); return; }
  await sendToMake("INSERT",sel);
});

$deleteSelected?.addEventListener("click",async()=>{
  if(!selectedIds.size){ setNotice("Bitte auswählen.","warn"); return; }
  const sel=cmsItems.filter(it=>selectedIds.has(it.id));
  await sendToMake("DELETE",sel);
});

$clearSelection?.addEventListener("click",()=>{
  selectedIds.clear();
  renderCmsTable(cmsItems);
  updateSelectionButtons();
});
$selectAll?.addEventListener("change",e=>{
  if(e.target.checked) cmsItems.forEach(it=>{ if(it.ba_status!=="OK") selectedIds.add(it.id); });
  else selectedIds.clear();
  renderCmsTable(cmsItems);
  updateSelectionButtons();
});
$refresh?.addEventListener("click",loadList);

/* ========= Init ========= */
loadList();
