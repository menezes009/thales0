// app.js – Persistente (sem auto-clear)
const KEY_PREFIX = 'qr_v5';
const USED_KEY = `${KEY_PREFIX}_used`;
const LOG_KEY  = `${KEY_PREFIX}_checkins`;

let html5Qrcode, currentCameraId=null, last='', lastTime=0;
const DEBOUNCE=1500;

let codesMap = {};
let usedLocal = new Set(JSON.parse(localStorage.getItem(USED_KEY) || '[]'));

const elStart=document.getElementById('btnStart');
const elStop=document.getElementById('btnStop');
const elSel=document.getElementById('cameraSelect');
const elFile=document.getElementById('file');
const elBtnImg=document.getElementById('btnScanFile');
const elManual=document.getElementById('manualCode');
const elBtnMan=document.getElementById('btnManual');
const elStatus=document.getElementById('statusBadge');
const elGuest=document.getElementById('guestInfo');
const elHardReset=document.getElementById('btnHardReset');
const elExport=document.getElementById('btnExport');
const elImp=document.getElementById('imp');

if (navigator.storage && navigator.storage.persist) {
  try { navigator.storage.persist(); } catch(e){}
}

function setStatus(t, cls=''){ elStatus.textContent=t; elStatus.className='badge '+(cls||''); }
function persistUsed(){ localStorage.setItem(USED_KEY, JSON.stringify(Array.from(usedLocal))); }
function addLog(entry){
  const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  arr.push(entry);
  localStorage.setItem(LOG_KEY, JSON.stringify(arr));
}

function extractCodigo(text){
  try{ const u=new URL(text); const p=new URLSearchParams(u.search||''); const c=p.get('codigo')||p.get('code')||p.get('c'); if(c) return c.trim(); }catch{}
  const idx=text.indexOf('codigo='); const base= idx>=0? text.slice(idx+7): text; return String(base).split('&')[0].trim();
}

async function loadData(){
  const res = await fetch('data.json?_=' + Date.now());
  const data = await res.json();
  if (Array.isArray(data)){
    data.forEach(row => {
      const k = String(row.codigo||'').trim();
      if (k) codesMap[k] = { name: row.nome || row.name || '', presenca: row.presenca || '' };
    });
  } else {
    Object.keys(data||{}).forEach(k => {
      const v = data[k] || {};
      codesMap[k] = { name: v.name || v.nome || '', presenca: v.presenca || '' };
    });
  }
}

async function listCameras(){
  const cams = await Html5Qrcode.getCameras();
  elSel.innerHTML='';
  cams.forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.label||c.id; elSel.appendChild(o); });
  if (cams[0]){
    const back = cams.find(c=>/back|rear|traseira/i.test(c.label||''));
    currentCameraId = (back && back.id) || cams[0].id; elSel.value=currentCameraId;
  }
}

function handleDecodedText(text){
  const code = extractCodigo(text);
  if (!code){ setStatus('Inválido', 'err'); elGuest.textContent=''; return; }
  const now=Date.now(); if (code===last && now-lastTime<DEBOUNCE) return; last=code; lastTime=now;
  const item = codesMap[code];
  if (!item){ setStatus('Inválido', 'err'); elGuest.textContent = `Código não encontrado: ${code}`; return; }

  if (String(item.presenca||'').toLowerCase()==='sim'){
    setStatus('❌ Já usado (presença marcada)', 'warn');
    elGuest.textContent = item.name || 'Convidado';
    return;
  }
  if (usedLocal.has(code)){
    setStatus('⛔ Já lido neste aparelho', 'warn');
    elGuest.textContent = item.name || 'Convidado';
    return;
  }
  usedLocal.add(code); persistUsed();
  const entry = { code, name: item.name || 'Convidado', at: Date.now(), deviceId: 'ios' };
  addLog(entry);
  setStatus('✅ Acesso liberado', 'ok');
  elGuest.textContent = entry.name;
}

async function start(){
  await loadData(); await listCameras();
  if (!html5Qrcode) html5Qrcode = new Html5Qrcode('reader');
  const config = { fps: 10, qrbox: 250, rememberLastUsedCamera: true };
  const camCfg = currentCameraId ? { deviceId: { exact: currentCameraId } } : { facingMode: 'environment' };
  try{
    await html5Qrcode.start(camCfg, config, (txt)=>handleDecodedText(txt), ()=>{});
    elStart.disabled=true; elStop.disabled=false; setStatus('Lendo…','');
  }catch(e){
    setStatus('Erro ao iniciar. Use Safari e permita a câmera.', 'err');
  }
}
function stop(){ if (!html5Qrcode) return; html5Qrcode.stop().then(()=>{ elStart.disabled=false; elStop.disabled=true; setStatus('Parado',''); }).catch(()=>{ elStart.disabled=false; elStop.disabled=true; setStatus('Parado',''); }); }

function hardReset(){
  localStorage.removeItem(USED_KEY);
  localStorage.removeItem(LOG_KEY);
  usedLocal = new Set();
  setStatus('Local zerado. Faça uma leitura nova agora.', 'ok');
  elGuest.textContent = '';
}
function exportBackup(){
  const data = {
    used: JSON.parse(localStorage.getItem(USED_KEY) || '[]'),
    log:  JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
  };
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='backup-checkins.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}
function importBackup(file){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.used)) localStorage.setItem(USED_KEY, JSON.stringify(data.used));
      if (Array.isArray(data.log))  localStorage.setItem(LOG_KEY, JSON.stringify(data.log));
      usedLocal = new Set(JSON.parse(localStorage.getItem(USED_KEY) || '[]'));
      setStatus('Backup restaurado.', 'ok');
    } catch(e){
      setStatus('Arquivo inválido.', 'err');
    }
  };
  reader.readAsText(file);
}

elStart.addEventListener('click', start);
elStop.addEventListener('click', stop);
elSel.addEventListener('change', e => { currentCameraId=e.target.value; if (html5Qrcode){ stop(); start(); } });
elBtnImg.addEventListener('click', async ()=>{
  try{
    if (!html5Qrcode) html5Qrcode = new Html5Qrcode('reader');
    const f = elFile.files[0]; if (!f){ setStatus('Selecione JPG/PNG', 'warn'); return; }
    const txt = await html5Qrcode.scanFile(f, true);
    handleDecodedText(txt);
  }catch(e){ setStatus('Falha ao ler a imagem. Use screenshot (PNG) ou JPG.', 'err'); }
});
elBtnMan.addEventListener('click', ()=> handleDecodedText(elManual.value.trim()));
elHardReset.addEventListener('click', hardReset);
elExport.addEventListener('click', exportBackup);
elImp.addEventListener('change', e => { const f=e.target.files[0]; if (f) importBackup(f); });
