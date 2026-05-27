(function(){
'use strict';

/* ─── FIREBASE CONFIG ─── */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC2fezwrXSOeDCytG84RES-dJ04teLvmuo",
  authDomain: "ainvested-703ec.firebaseapp.com",
  databaseURL: "https://ainvested-703ec-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ainvested-703ec",
  storageBucket: "ainvested-703ec.firebasestorage.app",
  messagingSenderId: "453797298902",
  appId: "1:453797298902:web:9c4adbc200e23dadaaff77",
  measurementId: "G-X7BH0LW5BT"
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();
const APP_VER = 'v1.37';
const STAGING = location.hostname.includes('-staging');

/* ─── EARLY VERSION DISPLAY ─── */
(function(){
  const ver=APP_VER+(STAGING?' (staging)':'');
  const loginVer=$('login-ver'); if(loginVer) loginVer.textContent=ver;
})();

/* ─── STATE ─── */
let currentUser = null;
let authReady = false;
let activeVehicle = null;   // vehicle id
let editingRecord = null;   // { type, vehicleId, recordId }
let currentReceiptFile = null;   // File object for upload
let currentMtReceiptFile = null;  // Service receipt
let settings = { units:'metric', currency:'RM', modules:{fuel:true,service:true,expenses:true,trips:true,reminders:true} };
let _vehCallback = null;

/* ─── HELPERS ─── */
function $(id){ return document.getElementById(id); }
function now(){ return new Date(); }
function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtMoney(n,sym){ return (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtMoneyW(n,sym){ return (n||0).toLocaleString('en-US',{maximumFractionDigits:0}); }
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function toNum(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  // staging banner
  const banner = $('staging-banner');
  const verSpan = $('staging-ver');
  if(banner && verSpan && id==='dash-screen'){
    if(STAGING){
      banner.classList.remove('hidden');
      verSpan.textContent = APP_VER;
    } else {
      banner.classList.add('hidden');
    }
  }
}
function todayInput(){ $('fu-date').value=fmtDate(now()); $('mt-date').value=fmtDate(now()); $('ex-date').value=fmtDate(now()); $('tr-date').value=fmtDate(now()); }

const VEHC_AUTO=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
const VEHC_NAME={red:'#ef4444',orange:'#f97316',yellow:'#eab308',white:'#e5e7eb',silver:'#9ca3af',blue:'#3b82f6',black:'#6b7280',grey:'#64748b'};
function resolveVidColors(vehicles,vids){ const r={}; const taken=new Set(); vids.forEach(vid=>{ const c=vehicles[vid]&&vehicles[vid].color; if(c&&VEHC_NAME[c]){ if(!taken.has(VEHC_NAME[c])){r[vid]=VEHC_NAME[c];taken.add(VEHC_NAME[c]);}else{r[vid]=null;} }else{r[vid]=null;} }); let ai=0; vids.forEach(vid=>{ if(r[vid]) return; while(taken.has(VEHC_AUTO[ai%VEHC_AUTO.length])) ai++; r[vid]=VEHC_AUTO[ai%VEHC_AUTO.length]; taken.add(VEHC_AUTO[ai%VEHC_AUTO.length]); ai++; }); return r; }

/* --- MODULE TOGGLE --- */
function applyModules(){
  // Dashboard hero toggles
  const hFuel=$('hero-fuel-block');
  const hSvc =$('hero-service-block');
  const hExp =$('hero-expense-block');
  if(hFuel) hFuel.classList.toggle('hidden',!settings.modules.fuel);
  if(hSvc)  hSvc.classList.toggle('hidden',!settings.modules.service);
  if(hExp)  hExp.classList.toggle('hidden',!settings.modules.expenses);
  // Vehicle tab visibility
  const tFu =document.querySelector('.tab-btn[data-tab="fillups"]');
  const tMt =document.querySelector('.tab-btn[data-tab="maintenance"]');
  const pFu =$('tab-fillups');
  const pMt =$('tab-maintenance');
  if(tFu) tFu.classList.toggle('hidden',!settings.modules.fuel);
  if(tMt) tMt.classList.toggle('hidden',!settings.modules.service);
  if(pFu) pFu.classList.toggle('hidden',!settings.modules.fuel);
  if(pMt) pMt.classList.toggle('hidden',!settings.modules.service);
  // Quick-action buttons
  const qFu=$('qa-fillup'); const qMt=$('qa-service');
  if(qFu) qFu.classList.toggle('hidden',!settings.modules.fuel);
  if(qMt) qMt.classList.toggle('hidden',!settings.modules.service);
  // Stat cards — only hide pure-fuel stats (L/100km, Total Fuel). RM/km uses all costs.
  const scFc=$('stat-card-fc'); const scTf=$('stat-card-totalfuel');
  if(scFc) scFc.classList.toggle('hidden',!settings.modules.fuel);
  if(scTf) scTf.classList.toggle('hidden',!settings.modules.fuel);
  // Re-activate first visible tab if current is hidden
  const visibleTabs=Array.from(document.querySelectorAll('.tab-btn:not(.hidden)'));
  if(visibleTabs.length && !visibleTabs.some(t=>t.classList.contains('active'))){
    document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    visibleTabs[0].classList.add('active');
    $(visibleTabs[0].dataset.tab==='stats'?'tab-stats':('tab-'+visibleTabs[0].dataset.tab)).classList.add('active');
  }
}
function setModule(key,on){
  if(!settings.modules) settings.modules={fuel:true,service:true,expenses:true,trips:true,reminders:true};
  settings.modules[key]=!!on;
  saveSettings(currentUser.uid,'modules',settings.modules);
  applyModules();
  if($('dash-screen').classList.contains('active')) renderDash();
  if(activeVehicle && $('vehicle-screen').classList.contains('active')) loadVehicleTabs(activeVehicle);
}
function normalizeModules(){
  if(!settings.modules) settings.modules={fuel:true,service:true,expenses:true,trips:true,reminders:true};
  ['fuel','service','expenses','trips','reminders'].forEach(k=>{ if(settings.modules[k]===undefined) settings.modules[k]=true; });
}

/* ─── REF BUILDERS ─── */
function uRef(path){ return db.ref('maintained/'+currentUser.uid+(path?('/'+path):'')); }
function vRef(){ return uRef('vehicles'); }
function fillRef(vid){ return uRef('fillups/'+vid); }
function maintRef(vid){ return uRef('maintenance/'+vid); }
function exp2Ref(vid){ return uRef('expenses/'+vid); }
function tripRef(vid){ return uRef('trips/'+vid); }
function remindRef(vid){ return uRef('reminders/'+vid); }
function catRef(){ return db.ref('maintained/'+currentUser.uid+'/categories'); }
function svcItemRef(){ return db.ref('maintained/'+currentUser.uid+'/serviceItems'); }

/* ─── LISTENERS ─── */
function attachListeners(uid){
  detachListeners();
  _vehCallback = snap=>{
    if(!currentUser || currentUser.uid!==uid) return;
    renderDash();
  };
  uRef().on('value', _vehCallback);
}
function detachListeners(){
  if(_vehCallback && currentUser){ uRef().off('value', _vehCallback); _vehCallback=null; }
}

/* ─── AUTH ─── */
  auth.onAuthStateChanged(user=>{
  authReady = true;
  if(user){
    if(!currentUser){
      currentUser = { uid:user.uid, name:user.displayName||'User', email:user.email };
      loadUserProfile(user.uid).then(p=>{
        if(p?.name){ currentUser.name = p.name; }
        $('dash-greeting').textContent = currentUser.email;
        loadSettings(user.uid).then(s=>{ if(s) settings = {...settings,...s}; normalizeModules(); });
        showScreen('dash-screen'); renderDash(); attachListeners(user.uid);
      });
    }
  }else{
    currentUser = null; activeVehicle = null; editingRecord = null;
    detachListeners(); showScreen('login-screen');
  }
});

function loadUserProfile(uid){ return uRef('profile').once('value').then(s=>s.val()||null); }
function saveUserProfile(uid, name){ return uRef('profile').update({ name, updatedAt: firebase.database.ServerValue.TIMESTAMP }); }
function loadSettings(uid){ return uRef('settings').once('value').then(s=>s.val()||{}); }
function saveSettings(uid, key, value){ return uRef('settings').update({ [key]: value }); }

/* ─── LOGIN ─── */
$('btn-login').addEventListener('click',doLogin);
$('login-password').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

function doLogin(){
  const email=$('login-email').value.trim();
  const password=$('login-password').value;
  if(!email||!password){ alert('Enter email and password'); return; }
  if(!authReady){ alert('Auth initializing, try again in 2 seconds'); return; }
  auth.signInWithEmailAndPassword(email, password)
    .then(cred=>{ currentUser = { uid:cred.user.uid, name:cred.user.displayName||email.split('@')[0], email:cred.user.email }; $('dash-greeting').textContent=currentUser.email; showScreen('dash-screen'); renderDash(); attachListeners(cred.user.uid); })
    .catch(err=>{
      if(err.code==='auth/user-not-found'){
        if(password.length<6){ alert('Password must be at least 6 characters'); return; }
        return auth.createUserWithEmailAndPassword(email,password)
          .then(cred=>{ currentUser={uid:cred.user.uid,name:email.split('@')[0],email:cred.user.email}; saveUserProfile(cred.user.uid,email.split('@')[0]); $('dash-greeting').textContent=currentUser.email; showScreen('dash-screen'); renderDash(); attachListeners(cred.user.uid); });
      }
      alert(err.message);
    });
}

$('btn-switch-user').addEventListener('click',()=>{ auth.signOut().then(()=>{ currentUser=null; activeVehicle=null; editingRecord=null; detachListeners(); $('login-email').value=''; $('login-password').value=''; showScreen('login-screen'); }); });

/* ─── DASHBOARD ─── */
function renderDash(){
  if(!currentUser) return;
  const dashVerEl=$('dash-version');
  if(dashVerEl) dashVerEl.textContent=APP_VER+(STAGING?' (staging)':'');
  const uid=currentUser.uid;
  vRef().once('value').then(snap=>{
    const vehicles=snap.val()||{};
    const vids=Object.keys(vehicles);
    window.vehicles_cache=vehicles;
    const vidColors=resolveVidColors(vehicles,vids);
    // Vehicle cards with placeholder cost stats
    const container=$('vehicle-list');
    let h='';
    vids.forEach(id=>{
      const v=vehicles[id]; const isMotorcycle=v.vehicleType==='Motorcycle';
      const vc=vidColors[id]||'#ef4444';
      h+=`<div class="vehicle-card" data-vid="${esc(id)}" style="border-left:4px solid ${vc}"><div class="vc-top"><span class="vc-dot" style="background:${vc}"></span><span style="font-size:1rem">${isMotorcycle?'🏍️':'🚗'}</span><div class="vc-info"><div class="vehicle-name">${esc(v.make||'')} ${esc(v.model||'')} ${esc(v.year||'')}</div><div class="vehicle-plate">${esc(v.plate||'')} · ${esc(v.fuelType||'Petrol')}</div></div></div><div class="vc-costs"><div class="vc-stat"><span class="vc-stat-val" id="vccpd-${esc(id)}">—</span><span class="vc-stat-label">/mo</span></div><div class="vc-stat"><span class="vc-stat-val" id="vccpkm-${esc(id)}">—</span><span class="vc-stat-label">/km</span></div></div><span class="vc-rem-badge" id="vcrdot-${esc(id)}"></span></div>`;
    });
    container.innerHTML=h;
    container.querySelectorAll('.vehicle-card[data-vid]').forEach(c=>c.addEventListener('click',()=>openVehicle(c.dataset.vid,vehicles[c.dataset.vid])));
    // Totals across all vehicles (this month fuel, this year service)
    const monthPrefix=fmtDate(now()).slice(0,7);
    const yearPrefix=String(now().getFullYear());
    if(settings.modules.fuel || settings.modules.service || settings.modules.expenses){
      Promise.all(vids.map(vid=>Promise.all([fillRef(vid).once('value'),maintRef(vid).once('value'),exp2Ref(vid).once('value')]))).then(results=>{
        let fuelTotal=0, svcTotal=0, expTotal=0;
        results.forEach(([fSnap,mSnap,eSnap])=>{
          const fills=fSnap.val()||{}, svcs=mSnap.val()||{}, exps=eSnap.val()||{};
          Object.values(fills).forEach(o=>{ if((o.date||'').startsWith(monthPrefix)) fuelTotal+=toNum(o.totalCost); });
          Object.values(svcs).forEach(o=>{ if((o.date||'').startsWith(yearPrefix)) svcTotal+=toNum(o.totalCost); });
          Object.values(exps).forEach(o=>{ if((o.date||'').startsWith(yearPrefix)) expTotal+=toNum(o.amount); });
        });
        if(settings.modules.fuel) $('hero-fuel').textContent = fmtMoneyW(fuelTotal);
        if(settings.modules.service) $('hero-service').textContent = 'RM '+fmtMoneyW(svcTotal);
        if(settings.modules.expenses) $('hero-expense').textContent = 'RM '+fmtMoneyW(expTotal);
      });
    }
    // Recent global items (all types interleaved, latest 15)
    const mods=settings.modules||{};
    if(mods.fuel || mods.service || mods.expenses || mods.trips){
    const vidColors=resolveVidColors(vehicles,vids);
    const recentPromises = vids.map(vid=>Promise.all([
      mods.fuel ? fillRef(vid).once('value').then(s=>s.val()) : Promise.resolve(null),
      mods.service ? maintRef(vid).once('value').then(s=>s.val()) : Promise.resolve(null),
      exp2Ref(vid).once('value').then(s=>s.val()),
      tripRef(vid).once('value').then(s=>s.val())
    ]));
    Promise.all(recentPromises).then(results=>{
      let allItems=[];
      results.forEach(([fills,svcs,exps,trips],i)=>{
        const vid=vids[i]; const color=vidColors[vid]||'#3b82f6';
        if(fills) Object.entries(fills).forEach(([id,o])=>allItems.push({t:'Fuel',id,vid,color,date:o.date||'',label:`Fuel · ${(toNum(o.liters)).toFixed(2)}L`,amount:toNum(o.totalCost),meta:`${esc(vehicles[vid]?.plate||vid)} @ ${toNum(o.odometer).toLocaleString()} km`}));
        if(svcs) Object.entries(svcs).forEach(([id,o])=>allItems.push({t:'Service',id,vid,color,date:o.date||'',label:o.items||'Service',amount:toNum(o.totalCost),meta:`${esc(vehicles[vid]?.plate||vid)} · ${esc(o.shop||'')}`}));
        if(exps) Object.entries(exps).forEach(([id,o])=>allItems.push({t:'Expense',id,vid,color,date:o.date||'',label:`${o.category||'Expense'} · ${o.description||''}`,amount:toNum(o.amount),meta:esc(vehicles[vid]?.plate||vid)}));
        if(trips) Object.entries(trips).forEach(([id,o])=>allItems.push({t:'Trip',id,vid,color,date:o.date||'',label:`Trip · ${o.purpose||''}`,amount:0,meta:`${esc(vehicles[vid]?.plate||vid)} · ${toNum(o.distance).toLocaleString()} km`}));
      });
      allItems.sort((a,b)=>b.date.localeCompare(a.date));
      window._recentCache=allItems;
      renderRecentSlice(0);
    });}
    // All-time stats: total cost, cost/month, cost/km
    if(vids.length){
      const allP = vids.map(vid=>Promise.all([
        fillRef(vid).once('value').then(s=>s.val()||{}),
        maintRef(vid).once('value').then(s=>s.val()||{}),
        exp2Ref(vid).once('value').then(s=>s.val()||{}),
        tripRef(vid).once('value').then(s=>s.val()||{})
      ]));
      Promise.all(allP).then(results=>{
        let totalCost=0, totalDist=0, earliestDate=null;
        results.forEach(([fills,svcs,exps,trips],i)=>{
          const vid=vids[i]; const v=vehicles[vid]||{};
          let vehCost=0, vehDist=0, vehEarliest=null;
          // Per-vehicle cost
          Object.values(fills).forEach(o=>{ const c=toNum(o.totalCost); vehCost+=c; totalCost+=c; if(o.date){ if(!vehEarliest||o.date<vehEarliest) vehEarliest=o.date; if(!earliestDate||o.date<earliestDate) earliestDate=o.date; } });
          Object.values(svcs).forEach(o=>{ const c=toNum(o.totalCost); vehCost+=c; totalCost+=c; if(o.date){ if(!vehEarliest||o.date<vehEarliest) vehEarliest=o.date; if(!earliestDate||o.date<earliestDate) earliestDate=o.date; } });
          Object.values(exps).forEach(o=>{ const c=toNum(o.amount); vehCost+=c; totalCost+=c; if(o.date){ if(!vehEarliest||o.date<vehEarliest) vehEarliest=o.date; if(!earliestDate||o.date<earliestDate) earliestDate=o.date; } });
          Object.values(trips).forEach(o=>{ const d=toNum(o.distance||o.endOdo-o.startOdo); vehDist+=d; totalDist+=d; if(o.date){ if(!vehEarliest||o.date<vehEarliest) vehEarliest=o.date; if(!earliestDate||o.date<earliestDate) earliestDate=o.date; } });
          // Distance from consecutive non-partial fill-ups for this vehicle
          const fillArr=Object.values(fills).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
          for(let j=1;j<fillArr.length;j++){ if(fillArr[j].partial) continue; const d=toNum(fillArr[j].odometer)-toNum(fillArr[j-1].odometer); if(d>0) vehDist+=d; }
          // Fallback: odometer range from all records + vehicle's stored odo
          let minOdo=Infinity, maxOdo=-Infinity;
          Object.values(fills).forEach(o=>{ const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo) minOdo=odo; if(odo>maxOdo) maxOdo=odo; } });
          Object.values(svcs).forEach(o=>{ const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo) minOdo=odo; if(odo>maxOdo) maxOdo=odo; } });
          Object.values(exps).forEach(o=>{ const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo) minOdo=odo; if(odo>maxOdo) maxOdo=odo; } });
          // Also consider the vehicle's stored odometer for a more accurate max
          const storedOdo=toNum(v.odometer);
          if(storedOdo>maxOdo) maxOdo=storedOdo;
          if(vehDist===0 && minOdo<maxOdo){ vehDist=maxOdo-minOdo; totalDist+=vehDist; }
          // Update this vehicle's card stats
          const vehDays=vehEarliest?Math.max(1,Math.ceil((now()-new Date(vehEarliest))/86400000)):1;
          const vehMonths=Math.max(0.5, vehDays/30);
          const cpdEl=$('vccpd-'+vid); if(cpdEl) cpdEl.textContent=fmtMoney(vehCost/vehMonths);
          const cpkmEl=$('vccpkm-'+vid);
          if(cpkmEl){
            if(v.trackOdo!==false && vehDist>0) cpkmEl.textContent=fmtMoney(vehCost/vehDist);
            else cpkmEl.textContent=vehDist>0?fmtMoney(vehCost/vehDist):'—';
          }
        });
        $('alltime-cost').textContent = fmtMoney(totalCost);
        // Sum each vehicle's own cost/month for the global figure
        let fleetMonthly=0;
        results.forEach(([fills,svcs,exps,trips],i)=>{
          let vehCost=0, vehEarliest=null;
          Object.values(fills).forEach(o=>{ vehCost+=toNum(o.totalCost); if(o.date && (!vehEarliest||o.date<vehEarliest)) vehEarliest=o.date; });
          Object.values(svcs).forEach(o=>{ vehCost+=toNum(o.totalCost); if(o.date && (!vehEarliest||o.date<vehEarliest)) vehEarliest=o.date; });
          Object.values(exps).forEach(o=>{ vehCost+=toNum(o.amount); if(o.date && (!vehEarliest||o.date<vehEarliest)) vehEarliest=o.date; });
          const vehDays=vehEarliest?Math.max(1,Math.ceil((now()-new Date(vehEarliest))/86400000)):1;
          fleetMonthly+=vehCost/Math.max(0.5,vehDays/30);
        });
        $('alltime-cpd').textContent = fmtMoney(fleetMonthly);
        if(totalDist>0) $('alltime-cpkm').textContent = fmtMoney(totalCost/totalDist);
        else $('alltime-cpkm').textContent = '—';
      });
    }
    applyModules();
    // Load reminder indicators for vehicle cards
    if(settings.modules.reminders){
      Promise.all(vids.map(vid=>remindRef(vid).once('value').then(s=>s.val()||{}))).then(remResults=>{
        remResults.forEach((reminders,i)=>{
          const vid=vids[i];
          const v=vehicles[vid]||{};
          let activeCount=0, overdueCount=0;
          const nowDate=fmtDate(now());
          const curOdo=toNum(v.odometer);
          Object.values(reminders).forEach(r=>{
            if(r.status==='completed'||r.enabled===false) return;
            // Date-based
            if(r.dueDate){
              var due=new Date(r.dueDate);
              var daysRemaining=Math.ceil((due-now())/86400000);
              if(daysRemaining<=90){
                if(daysRemaining<=0) overdueCount++;
                else activeCount++;
              }
            }
            // Odo-based: count if at 80%+ of target (only if date didn't already count this one)
            if((r.dueType==='odo'||r.dueType==='both') && r.dueOdo && curOdo>0){
              // For 'both' type, only add odo count if date is further away (>90d), to avoid double-counting
              var alreadyCountedByDate = r.dueDate && (function(){
                var d=new Date(r.dueDate);
                return Math.ceil((d-now())/86400000)<=90;
              })();
              if(!alreadyCountedByDate && curOdo>=r.dueOdo*0.8){
                if(curOdo>=r.dueOdo) overdueCount++;
                else activeCount++;
              }
            }
          });
          const badge=$('vcrdot-'+vid);
          if(!badge) return;
          const total=activeCount+overdueCount;
          if(total>0){
            badge.className='vc-rem-badge '+(overdueCount>0?'overdue':'active');
            badge.textContent=total;
            badge.title=(overdueCount>0?overdueCount+' overdue':'')+(overdueCount>0&&activeCount>0?', ':'')+(activeCount>0?activeCount+' upcoming':'')+' reminder'+(total>1?'s':'');
          }
        });
      });
    }
    loadRemindersTicker();
  });
}

function renderRecentSlice(start, limit=10){
  const el=$('recent-list');
  if(!window._recentCache||!window._recentCache.length){ el.innerHTML='<div class="item"><div class="item-left"><div class="item-meta">No records yet</div></div></div>'; return; }
  const slice=window._recentCache.slice(start,start+limit);
  const h=slice.map(it=>`<div class="item" style="border-left:3px solid ${it.color}"><div class="item-left"><div class="item-name"><span class="veh-chip" style="background:${it.color}22;color:${it.color};font-size:0.68rem;font-weight:600;padding:1px 6px;border-radius:3px;margin-right:4px">${esc(window.vehicles_cache?.[it.vid]?.plate||it.vid)}</span>${esc(it.label)}</div><div class="item-meta">${esc(it.date)} · ${esc(it.meta)}</div></div><div class="item-amount">${it.amount?fmtMoney(it.amount):''}</div></div>`).join('');
  const oldBtn=el.querySelector('.load-more-btn');
  if(oldBtn) oldBtn.remove();
  if(start===0) el.innerHTML=h;
  else el.innerHTML+=h;
  if(start+limit<window._recentCache.length){
    const remaining=window._recentCache.length-(start+limit);
    el.innerHTML+=`<button class="load-more-btn" onclick="renderRecentSlice(${start+limit})">Show more (${remaining})</button>`;
  }
}
window.renderRecentSlice=renderRecentSlice;

/* ─── VEHICLE ─── */
function openVehicle(vid, v){
  activeVehicle = vid;
  $('vehicle-title').textContent = `${esc(v.vehicleType||'Car') === 'Motorcycle' ? '🏍️' : '🚗'} ${esc(v.make||'')} ${esc(v.model||'')} ${esc(v.year||'')}`;
  $('vehicle-meta').textContent = `${esc(v.plate||'')} · ${esc(v.fuelType||'Petrol')} · ${esc(v.vehicleType||'Car')}`;
  $('vehicle-odo').textContent = toNum(v.odometer).toLocaleString();
  if(v.trackOdo===false) $('vehicle-odometer').classList.add('hidden');
  else $('vehicle-odometer').classList.remove('hidden');
  showScreen('vehicle-screen');
  applyModules();
  // reset to stats tab
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
  const statsTab=document.querySelector('.tab-btn[data-tab="stats"]');
  if(statsTab) statsTab.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
  var tp=$('tab-stats'); if(tp) tp.classList.add('active');
  var fab=$('btn-add-record'); if(fab) fab.classList.add('hidden');
  loadVehicleTabs(vid);
  // Set default trip start from last end
  tripRef(vid).once('value').then(s=>{ const o=s.val()||{}; const arr=Object.values(o).sort((a,b)=>b.date?.localeCompare(a.date)||0); if(arr[0]) $('tr-start').value = arr[0].endOdo||''; });
  // Odometer inline edit
  initOdoEdit(vid, v);
}

let _odoHandlerRef=null;

function initOdoEdit(vid, v){
  const odoSpan=$('vehicle-odo');
  const editBtn=$('btn-odo-edit');
  const savedSpan=$('odo-saved');
  if(!odoSpan) return;
  if(_odoHandlerRef){
    odoSpan.removeEventListener('click',_odoHandlerRef);
    if(editBtn) editBtn.removeEventListener('click',_odoHandlerRef);
  }
  function startEdit(){
    const curOdo=toNum(v.odometer).toString();
    const input=document.createElement('input');
    input.type='number'; input.value=curOdo; input.min='0';
    input.style.cssText='width:100px;text-align:center;background:var(--surface);color:var(--text);border:1px solid var(--accent);border-radius:6px;padding:2px 6px;font-size:0.9rem;font-weight:600;';
    odoSpan.replaceWith(input);
    input.focus(); input.select();
    function save(){
      const newOdo=parseInt(input.value)||0;
      if(newOdo===toNum(v.odometer)){ cancel(); return; }
      vRef().child(vid).update({odometer:newOdo}).then(()=>{
        v.odometer=newOdo;
        const span=document.createElement('span');
        span.id='vehicle-odo';
        span.style.cssText='cursor:pointer;border-bottom:1px dashed var(--muted)';
        span.title='Click to update';
        span.textContent=newOdo.toLocaleString();
        span.addEventListener('click',_odoHandlerRef);
        input.replaceWith(span);
        if(savedSpan){ savedSpan.style.display='inline'; setTimeout(()=>{savedSpan.style.display='none';},2000); }
        loadVehicleTabs(vid);
      }).catch(e=>{
        cancel();
        console.error('Odo update failed:',e);
      });
    }
    function cancel(){
      const span=document.createElement('span');
      span.id='vehicle-odo';
      span.style.cssText='cursor:pointer;border-bottom:1px dashed var(--muted)';
      span.title='Click to update';
      span.textContent=toNum(v.odometer).toLocaleString();
      span.addEventListener('click',_odoHandlerRef);
      if(input.parentNode) input.replaceWith(span);
    }
    input.addEventListener('blur',save);
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); save(); } if(e.key==='Escape'){ e.preventDefault(); cancel(); } });
  }
  _odoHandlerRef=startEdit;
  odoSpan.addEventListener('click',startEdit);
  if(editBtn) editBtn.addEventListener('click',startEdit);
}

function loadVehicleTabs(vid){
  applyModules();
  // Stats
  if(settings.modules.fuel){
  fillRef(vid).once('value').then(s=>{
    const fills=s.val()||{};
    const arr=Object.values(fills).sort((a,b)=> (a.date||'').localeCompare(b.date||''));
    let totalL=0, totalDist=0, totalCost=0;
    for(let i=1;i<arr.length;i++){
      const prev=arr[i-1], cur=arr[i];
      if(cur.partial) continue;
      const dist=toNum(cur.odometer)-toNum(prev.odometer);
      if(dist>0 && toNum(cur.liters)>0){ totalDist+=dist; totalL+=toNum(cur.liters); totalCost+=toNum(cur.totalCost); }
    }
    if(totalDist>0 && totalL>0){
      const lp100 = (totalL/totalDist)*100;
      $('stat-fc').textContent = lp100.toFixed(1);
      $('stat-totalfuel').textContent = totalL.toFixed(1)+' L';
      $('stat-costkm').textContent = fmtMoney(totalCost/totalDist);
    } else {
      $('stat-fc').textContent = '—'; $('stat-totalfuel').textContent = '—';
    }
  });
  }
  // RM/km + Cost/month from all costs (always computed)
  computeAllInCostPerKm(vid);
  // Total Svc+Exp stat
  Promise.all([maintRef(vid).once('value').then(s=>s.val()||{}),exp2Ref(vid).once('value').then(s=>s.val()||{})]).then(([svcs,exps])=>{ let t=0; Object.values(svcs).forEach(o=>{ t+=toNum(o.totalCost); }); Object.values(exps).forEach(o=>{ t+=toNum(o.amount); }); var sc=$('stat-totalcost'); if(sc) sc.textContent=fmtMoney(t); });
  // Cost/month from maintenance (quick, always-on backup)
  maintRef(vid).once('value').then(s=>{
    const arr=Object.values(s.val()||{}).filter(o=>o.totalCost>0);
    if(!arr.length) return;
    let cost=0, minDt=null;
    arr.forEach(o=>{ cost+=toNum(o.totalCost); if(o.date&&(!minDt||o.date<minDt)) minDt=o.date; });
    if(cost>0 && minDt){
      const d=Math.max(1,Math.ceil((now()-new Date(minDt))/86400000));
      $('stat-costmonth').textContent=fmtMoney(cost/Math.max(0.5,d/30));
    }
  });
  // Last service
  maintRef(vid).once('value').then(s=>{
    const sv=s.val()||{};
    const arr=Object.values(sv).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('stat-lastsvc').textContent = arr[0]?.date || '—';
  });
  // Fill-up list
  if(settings.modules.fuel){
  fillRef(vid).once('value').then(s=>{
    const o=s.val()||{};
    let items=Object.entries(o).map(([id,r])=>({id,...r})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('fillup-list').innerHTML = items.length ? items.map(r=>`<div class="item" data-fid="${esc(r.id)}"><div class="item-left"><div class="item-name">${fmtDate2(r.date)} · ${toNum(r.liters).toFixed(2)}L @ ${fmtMoney(toNum(r.ppl),'')}/L</div><div class="item-meta">Odo ${toNum(r.odometer).toLocaleString()} km ${r.partial?'(partial)':''}</div></div><div class="item-amount">${fmtMoney(toNum(r.totalCost))}</div></div>`).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No fill-ups</div></div></div>';
    $('fillup-list').querySelectorAll('.item[data-fid]').forEach(el=>el.addEventListener('click',()=>editFillup(vid,el.dataset.fid)));
  });
  }
  // Maintenance list
  if(settings.modules.service){
  maintRef(vid).once('value').then(s=>{
    const o=s.val()||{};
    let items=Object.entries(o).map(([id,r])=>({id,...r})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('maintenance-list').innerHTML = items.length ? items.map(r=>{
      const extras=(r.alsoServiced||[]).filter(x=>x!==r.items);
      const extraPills=extras.length?'<span style="color:var(--muted);font-size:0.68rem;margin-left:4px">+'+esc(extras.join(', '))+'</span>':'';
      const receiptIcon=r.receiptUrl?' <span style="font-size:0.7rem">📎</span>':'';
      return '<div class="item" data-mid="'+esc(r.id)+'"><div class="item-left"><div class="item-name">'+esc(r.items||'Service')+extraPills+(r.remarks?' <span style="color:var(--muted);font-size:0.7rem;font-style:italic">'+esc(r.remarks)+'</span>':'')+receiptIcon+'</div><div class="item-meta">'+fmtDate2(r.date)+' · '+esc(r.shop||'')+' · Odo '+toNum(r.odometer).toLocaleString()+' <span class="remind-btn"><button class="btn-xs btn-ghost remind-svc-btn" data-label="'+esc(r.items||'Service')+'" data-date="'+(r.date||'')+'" data-odo="'+toNum(r.odometer)+'" style="font-size:0.65rem">🔔</button></span></div></div><div class="item-amount">'+fmtMoney(toNum(r.totalCost))+'</div></div>';
    }).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No service records</div></div></div>';
    $('maintenance-list').querySelectorAll('.item[data-mid]').forEach(el=>el.addEventListener('click',()=>editMaintenance(vid,el.dataset.mid)));
    // 🔔 buttons
    $('maintenance-list').querySelectorAll('.remind-svc-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        showReminderForm('add',null,null,{
          label:btn.dataset.label, date:btn.dataset.date, odo:parseInt(btn.dataset.odo)||0,
          refLabel:btn.dataset.label,
          refDetail:btn.dataset.date+' · Odo '+(parseInt(btn.dataset.odo)||0).toLocaleString()
        });
      });
    });
  });
  }
  // Expense list
  exp2Ref(vid).once('value').then(s=>{
    const o=s.val()||{};
    let items=Object.entries(o).map(([id,r])=>({id,...r})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('expense-list').innerHTML = items.length ? items.map(r=>{
      const receiptIcon=r.receiptUrl?' <span style="font-size:0.7rem">📎</span>':'';
      return '<div class="item" data-eid="'+esc(r.id)+'"><div class="item-left"><div class="item-name">'+esc(r.category||'Expense')+(r.description?' · '+esc(r.description):'')+receiptIcon+'</div><div class="item-meta">'+fmtDate2(r.date)+(r.odometer?' · Odo '+toNum(r.odometer).toLocaleString()+' km':'')+' <span class="remind-btn"><button class="btn-xs btn-ghost remind-exp-btn" data-label="'+esc(r.category||'Expense')+(r.description?' · '+esc(r.description):'')+'" data-date="'+(r.date||'')+'" data-odo="'+toNum(r.odometer)+'" style="font-size:0.65rem">🔔</button></span></div></div><div class="item-amount">'+fmtMoney(toNum(r.amount))+'</div></div>';
    }).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No expenses</div></div></div>';
    $('expense-list').querySelectorAll('.item[data-eid]').forEach(el=>el.addEventListener('click',()=>editExpense(vid,el.dataset.eid)));
    // 🔔 buttons
    $('expense-list').querySelectorAll('.remind-exp-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.stopPropagation();
        showReminderForm('add',null,null,{
          label:btn.dataset.label, date:btn.dataset.date, odo:parseInt(btn.dataset.odo)||0,
          refLabel:btn.dataset.label,
          refDetail:btn.dataset.date+(parseInt(btn.dataset.odo)?' · Odo '+(parseInt(btn.dataset.odo)||0).toLocaleString()+' km':'')
        });
      });
    });
  });
  // Trip list
  tripRef(vid).once('value').then(s=>{
    const o=s.val()||{};
    let items=Object.entries(o).map(([id,r])=>({id,...r})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('trip-list').innerHTML = items.length ? items.map(r=>`<div class="item" data-tid="${esc(r.id)}"><div class="item-left"><div class="item-name">${esc(r.purpose||'Trip')}</div><div class="item-meta">${fmtDate2(r.date)} · ${toNum(r.startOdo).toLocaleString()} → ${toNum(r.endOdo).toLocaleString()} km</div></div><div class="item-amount">${toNum(r.distance).toLocaleString()} km</div></div>`).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No trips</div></div></div>';
    $('trip-list').querySelectorAll('.item[data-tid]').forEach(el=>el.addEventListener('click',()=>editTrip(vid,el.dataset.tid)));
    });
  // Reminders tab
  if(settings.modules.reminders) loadVehicleReminders(vid);
  else { var rl=$('reminder-list'); if(rl) rl.innerHTML='<div class="item"><div class="item-left"><div class="item-meta">Reminders module disabled</div></div></div>'; }
}

function fmtDate2(d){ return d ? d : ''; }

/* Compute RM/km from all cost types (fuel + service + expenses) */
function computeAllInCostPerKm(vid){
  Promise.all([
    fillRef(vid).once('value').then(s=>s.val()||{}),
    maintRef(vid).once('value').then(s=>s.val()||{}),
    exp2Ref(vid).once('value').then(s=>s.val()||{}),
    tripRef(vid).once('value').then(s=>s.val()||{})
  ]).then(([fills,svcs,exps,trips])=>{
    let totalCost=0, totalDist=0;
    let minOdo=Infinity, maxOdo=-Infinity;
    let earliestDate=null;
    // Sum all costs
    Object.values(fills).forEach(o=>{ totalCost+=toNum(o.totalCost); const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo)minOdo=odo; if(odo>maxOdo)maxOdo=odo; } if(o.date&&(!earliestDate||o.date<earliestDate)) earliestDate=o.date; });
    Object.values(svcs).forEach(o=>{ totalCost+=toNum(o.totalCost); const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo)minOdo=odo; if(odo>maxOdo)maxOdo=odo; } if(o.date&&(!earliestDate||o.date<earliestDate)) earliestDate=o.date; });
    Object.values(exps).forEach(o=>{ totalCost+=toNum(o.amount); const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo)minOdo=odo; if(odo>maxOdo)maxOdo=odo; } if(o.date&&(!earliestDate||o.date<earliestDate)) earliestDate=o.date; });
    Object.values(trips).forEach(o=>{ totalDist+=toNum(o.distance||o.endOdo-o.startOdo); if(o.date&&(!earliestDate||o.date<earliestDate)) earliestDate=o.date; });
    // Distance from fill-up deltas
    const fillArr=Object.values(fills).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    for(let i=1;i<fillArr.length;i++){ if(fillArr[i].partial) continue; const d=toNum(fillArr[i].odometer)-toNum(fillArr[i-1].odometer); if(d>0) totalDist+=d; }
    // Fallback: odometer range from all records + vehicle's stored odo
    if(totalDist===0 && minOdo<maxOdo) totalDist=maxOdo-minOdo;
    // Also factor in the vehicle's current stored odometer (may be newer than any record)
    vRef().child(vid).once('value').then(vSnap=>{
      const v=vSnap.val()||{};
      const storedOdo=toNum(v.odometer);
      if(storedOdo>maxOdo){
        if(totalDist>0) totalDist += (storedOdo - maxOdo);
        else if(minOdo<maxOdo) totalDist = maxOdo - minOdo;
        maxOdo = storedOdo;
      }
      if(totalDist===0 && minOdo<maxOdo) totalDist = maxOdo - minOdo;
      if(totalCost>0 && totalDist>0) $('stat-costkm').textContent=fmtMoney(totalCost/totalDist);
      else if(totalCost>0 && totalDist===0) $('stat-costkm').textContent='—';
    });
    // Cost/month
    const days=earliestDate?Math.max(1,Math.ceil((now()-new Date(earliestDate))/86400000)):1;
    const months=Math.max(0.5, days/30);
    $('stat-costmonth').textContent=totalCost>0?fmtMoney(totalCost/months):'—';
  }).catch(e=>console.log('computeAllInCostPerKm error:',e));
}

/* ─── TABS ─── */
document.querySelectorAll('.tab-btn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $(`tab-${b.dataset.tab}`).classList.add('active');
    const tab=b.dataset.tab;
    const fab=$('btn-add-record');
    if(fab) fab.classList.toggle('hidden', tab==='stats');
  });
});

$('btn-vehicle-back').addEventListener('click',()=>{ activeVehicle=null; showScreen('dash-screen'); renderDash(); });

/* ─── QUICK ACTION BUTTONS ─── */
 ['qa-fillup','qa-service','qa-expense','qa-trip'].forEach(function(id){
   var el=$(id);
   if(!el) return;
   el.addEventListener('click',function(){
     if(!activeVehicle) return;
     if(id==='qa-fillup'){ resetFillupForm(); showScreen('add-fillup-screen'); }
     else if(id==='qa-service'){ resetMaintenanceForm(); showScreen('add-maintenance-screen'); }
     else if(id==='qa-expense'){ resetExpenseForm(); showScreen('add-expense-screen'); }
     else if(id==='qa-trip'){ resetTripForm(); showScreen('add-trip-screen'); }
   });
 });

/* ─── ADD RECORD FAB ─── */
let fabAction='';
$('btn-add-record').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const el=document.querySelector('.tab-btn.active');
  const tab=el?el.dataset.tab:'fillups';
  if((tab==='stats'||tab==='fillups') && settings.modules.fuel){ resetFillupForm(); showScreen('add-fillup-screen'); }
  else if(tab==='maintenance' && settings.modules.service){ resetMaintenanceForm(); showScreen('add-maintenance-screen'); }
  else if(tab==='expenses'){ resetExpenseForm(); showScreen('add-expense-screen'); }
  else if(tab==='trips'){ resetTripForm(); showScreen('add-trip-screen'); }
  else if(tab==='reminders'){ showReminderForm(); }
});

/* ─── VEHICLE FORM ─── */
function resetVehicleForm(){ $('av-plate').value=''; $('av-make').value=''; $('av-model').value=''; $('av-year').value=''; $('av-type').value='Car'; $('av-fueltype').value='Petrol'; $('av-track-odo').checked=true; $('av-odo').value=''; $('av-odo-field').classList.remove('hidden'); editingRecord=null; }
// Odometer toggle
$('av-type').addEventListener('change',function(){
  if(this.value==='Motorcycle'){ $('av-track-odo').checked=false; toggleOdo(); }
  else { $('av-track-odo').checked=true; toggleOdo(); }
});
$('av-track-odo').addEventListener('change',toggleOdo);
function toggleOdo(){ $('av-odo-field').classList.toggle('hidden',!$('av-track-odo').checked); if(!$('av-track-odo').checked) $('av-odo').value=''; }
$('btn-av-back').addEventListener('click',()=>showScreen('dash-screen'));
$('btn-save-vehicle').addEventListener('click',()=>{
  const v={ plate:$('av-plate').value.trim(), make:$('av-make').value.trim(), model:$('av-model').value.trim(), year:$('av-year').value.trim(), vehicleType:$('av-type').value, fuelType:$('av-fueltype').value, trackOdo:$('av-track-odo').checked, odometer: toNum($('av-odo').value), createdAt: firebase.database.ServerValue.TIMESTAMP };
  if(!v.plate){ alert('Plate number is required'); return; }
  const key = editingRecord && editingRecord.type==='vehicle' ? editingRecord.recordId : vRef().push().key;
  vRef().child(key).update(v).then(()=>{ activeVehicle=key; showScreen('vehicle-screen'); openVehicle(key, v); });
});

/* ─── FILL-UP FORM ─── */
function resetFillupForm(){ todayInput(); $('fu-odo').value=''; $('fu-liters').value=''; $('fu-ppl').value=''; $('fu-total').textContent='0.00'; $('fu-partial').checked=false; editingRecord=null; $('btn-delete-fillup').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('fu-odo').value=toNum(v.odometer)||''; });
}
function calcFuelTotal(){ const L=toNum($('fu-liters').value), ppl=toNum($('fu-ppl').value); $('fu-total').textContent = (L*ppl).toFixed(2); }
['input','change'].forEach(ev=>{ $('fu-liters').addEventListener(ev,calcFuelTotal); $('fu-ppl').addEventListener(ev,calcFuelTotal); });

$('btn-fu-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-fillup').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const odo=toNum($('fu-odo').value), L=toNum($('fu-liters').value), ppl=toNum($('fu-ppl').value), total=L*ppl;
  if(odo<=0 || L<=0 || ppl<=0){ alert('Please fill in all fields correctly'); return; }
  const rec={ date:$('fu-date').value, odometer: odo, liters: L, ppl: ppl, totalCost: total, partial: $('fu-partial').checked, createdAt: firebase.database.ServerValue.TIMESTAMP };
  const key = editingRecord && editingRecord.type==='fillup' ? editingRecord.recordId : fillRef(activeVehicle).push().key;
  Promise.all([
    fillRef(activeVehicle).child(key).set(rec),
    vRef().child(activeVehicle).update({ odometer: odo, updatedAt: firebase.database.ServerValue.TIMESTAMP })
  ]).then(()=>{ resetFillupForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});
$('btn-delete-fillup').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this fill-up?')) return;
  fillRef(activeVehicle).child(editingRecord.recordId).remove().then(()=>{ resetFillupForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editFillup(vid, fid){
  fillRef(vid).child(fid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'fillup', vehicleId:vid, recordId:fid};
    $('fu-date').value=o.date||''; $('fu-odo').value=o.odometer||''; $('fu-liters').value=o.liters||''; $('fu-ppl').value=o.ppl||''; $('fu-total').textContent=(toNum(o.totalCost)).toFixed(2); $('fu-partial').checked=!!o.partial;
    $('btn-delete-fillup').classList.remove('hidden');
    showScreen('add-fillup-screen');
  });
}

/* ─── MAINTENANCE FORM ─── */
let _mtAlsoSelected=new Set();
let _mtAlsoNames=[];
function resetMaintenanceForm(){ todayInput(); $('mt-odo').value=''; populateServiceItemSelect('Oil Change'); _mtAlsoSelected.clear(); if($('mt-also')) $('mt-also').innerHTML=''; $('mt-remarks').value=''; $('mt-shop').value=''; $('mt-amount').value=''; $('mt-next-odo').value=''; $('mt-next-date').value=''; editingRecord=null; currentMtReceiptFile=null; $('mt-receipt').value=''; $('mt-receipt-preview').innerHTML=''; $('mt-receipt-preview').classList.add('hidden'); $('btn-delete-maintenance').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('mt-odo').value=toNum(v.odometer)||''; });
}
function _renderMtAlsoChips(){
  var grid=$('mt-also');
  if(!grid) return;
  var primary=$('mt-items').value;
  if(!_mtAlsoNames.length){ grid.innerHTML='<span style="color:var(--muted);font-size:0.75rem">Select primary item first</span>'; return; }
  grid.innerHTML=_mtAlsoNames.map(function(name){
    var isPrimary=name===primary;
    var isSelected=isPrimary||_mtAlsoSelected.has(name);
    var cls='service-chip'+(isPrimary?' locked':'')+(isSelected?' selected':'');
    return '<button class="'+cls+'" data-chip="'+esc(name)+'" '+(isPrimary?'disabled':'')+'>'+(isSelected?'✓ ':'')+esc(name)+'</button>';
  }).join('');
  grid.querySelectorAll('[data-chip]').forEach(function(btn){
    if(btn.disabled) return;
    btn.addEventListener('click',function(){
      var n=btn.dataset.chip;
      if(_mtAlsoSelected.has(n)){ _mtAlsoSelected.delete(n); }else{ _mtAlsoSelected.add(n); }
      _renderMtAlsoChips();
    });
  });
}
$('mt-items').addEventListener('change',function(){ _mtAlsoSelected.delete(this.value); _renderMtAlsoChips(); });

// Service receipt file input handler
$('mt-receipt').addEventListener('change', function(){
  const file = this.files[0];
  if (!file) { currentMtReceiptFile = null; $('mt-receipt-preview').classList.add('hidden'); return; }
  currentMtReceiptFile = file;
  const preview = $('mt-receipt-preview');
  preview.innerHTML = '';
  preview.classList.remove('hidden');
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(e){
      preview.innerHTML = '<img src="'+e.target.result+'" alt="Service receipt preview">';
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = '<span class="file-badge">📄 '+file.name+'</span>';
  }
});

$('btn-mt-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-maintenance').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const odo=toNum($('mt-odo').value); const amt=toNum($('mt-amount').value);
  if(!$('mt-items').value.trim()){ alert('Please describe the service items'); return; }
  const key = editingRecord && editingRecord.type==='maintenance' ? editingRecord.recordId : maintRef(activeVehicle).push().key;
  const rec={ date:$('mt-date').value, odometer: odo, items: $('mt-items').value.trim(), alsoServiced: Array.from(_mtAlsoSelected).filter(x=>x!==$('mt-items').value.trim()), remarks: $('mt-remarks').value.trim(), shop: $('mt-shop').value.trim(), totalCost: amt, nextOdo: toNum($('mt-next-odo').value)||null, nextDate: $('mt-next-date').value||null, createdAt: firebase.database.ServerValue.TIMESTAMP };

  const saveRec = () => {
    // Only update vehicle odo if new value is higher than stored
    vRef().child(activeVehicle).once('value').then(vSnap=>{
      const storedOdo = toNum((vSnap.val()||{}).odometer);
      const promises = [maintRef(activeVehicle).child(key).set(rec)];
      if (odo > storedOdo) {
        promises.push(vRef().child(activeVehicle).update({ odometer: odo, updatedAt: firebase.database.ServerValue.TIMESTAMP }));
      }
      Promise.all(promises).then(()=>{ resetMaintenanceForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
    });
  };

  // Upload receipt if selected
  if (currentMtReceiptFile) {
    const ext = currentMtReceiptFile.name.split('.').pop() || 'jpg';
    const storagePath = 'maintained/'+currentUser.uid+'/receipts/'+activeVehicle+'/'+key+'.'+ext;
    const uploadTask = storage.ref(storagePath).put(currentMtReceiptFile);
    uploadTask.on('state_changed', null, function(err){
      console.error('Service receipt upload failed:', err);
      alert('Receipt upload failed (storage may need CORS config). Record saved without receipt. Code: '+err.code);
      saveRec();
    }, function(){
      uploadTask.snapshot.ref.getDownloadURL().then(function(url){
        rec.receiptUrl = url;
        maintRef(activeVehicle).child(key).update({receiptUrl: url});
        saveRec();
      }).catch(function(e){
        console.error('Download URL failed:', e);
        saveRec();
      });
    });
  } else {
    saveRec();
  }
});
$('btn-delete-maintenance').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this service record?')) return;
  // Delete receipt from storage if present
  maintRef(activeVehicle).child(editingRecord.recordId).once('value').then(s=>{
    const rec=s.val();
    if(rec && rec.receiptUrl){
      storage.refFromURL(rec.receiptUrl).delete().catch(function(){});
    }
    return maintRef(activeVehicle).child(editingRecord.recordId).remove();
  }).then(()=>{ resetMaintenanceForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editMaintenance(vid, mid){
  maintRef(vid).child(mid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'maintenance', vehicleId:vid, recordId:mid};
    currentMtReceiptFile=null; $('mt-receipt').value='';
    $('mt-date').value=o.date||''; $('mt-odo').value=o.odometer||''; populateServiceItemSelect(o.items||''); _mtAlsoSelected=new Set((o.alsoServiced||[]).filter(function(x){return x!==o.items;})); if(_mtAlsoNames.length) _renderMtAlsoChips(); $('mt-remarks').value=o.remarks||''; $('mt-shop').value=o.shop||''; $('mt-amount').value=o.totalCost?o.totalCost.toFixed(2):''; $('mt-next-odo').value=o.nextOdo||''; $('mt-next-date').value=o.nextDate||'';
    // Show existing receipt preview
    var preview=$('mt-receipt-preview');
    if(o.receiptUrl){
      preview.innerHTML='<img src="'+o.receiptUrl+'" alt="Service Receipt">';
      preview.classList.remove('hidden');
    } else { preview.innerHTML=''; preview.classList.add('hidden'); }
    $('btn-delete-maintenance').classList.remove('hidden');
    showScreen('add-maintenance-screen');
  });
}

/* ─── EXPENSE FORM ─── */
function resetExpenseForm(){ todayInput(); $('ex-odo').value=''; populateCategorySelect('Insurance'); $('ex-desc').value=''; $('ex-amount').value=''; editingRecord=null; currentReceiptFile=null; $('ex-receipt').value=''; $('ex-receipt-preview').innerHTML=''; $('ex-receipt-preview').classList.add('hidden'); $('btn-delete-expense').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('ex-odo').value=toNum(v.odometer)||''; }); }

// Receipt file input handler
$('ex-receipt').addEventListener('change', function(){
  const file = this.files[0];
  if (!file) { currentReceiptFile = null; $('ex-receipt-preview').classList.add('hidden'); return; }
  currentReceiptFile = file;
  const preview = $('ex-receipt-preview');
  preview.innerHTML = '';
  preview.classList.remove('hidden');
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(e){
      preview.innerHTML = '<img src="'+e.target.result+'" alt="Receipt preview">';
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = '<span class="file-badge">📄 '+file.name+'</span>';
  }
});

$('btn-ex-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-expense').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const amt=toNum($('ex-amount').value);
  const expOdo=toNum($('ex-odo').value)||null;
  const key = editingRecord && editingRecord.type==='expense' ? editingRecord.recordId : exp2Ref(activeVehicle).push().key;
  const rec={ date:$('ex-date').value, odometer: expOdo, category:$('ex-category').value, description:$('ex-desc').value.trim(), amount: amt, createdAt: firebase.database.ServerValue.TIMESTAMP };

  const saveRec = () => {
    // Only update vehicle odo if expense has an odo AND it's higher than stored
    if (expOdo) {
      vRef().child(activeVehicle).once('value').then(vSnap=>{
        const storedOdo = toNum((vSnap.val()||{}).odometer);
        const promises = [exp2Ref(activeVehicle).child(key).set(rec)];
        if (expOdo > storedOdo) {
          promises.push(vRef().child(activeVehicle).update({ odometer: expOdo, updatedAt: firebase.database.ServerValue.TIMESTAMP }));
        }
        Promise.all(promises).then(()=>{ resetExpenseForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
      });
    } else {
      exp2Ref(activeVehicle).child(key).set(rec).then(()=>{ resetExpenseForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
    }
  };

  // Upload receipt if selected
  if (currentReceiptFile) {
    const ext = currentReceiptFile.name.split('.').pop() || 'jpg';
    const storagePath = 'maintained/'+currentUser.uid+'/receipts/'+activeVehicle+'/'+key+'.'+ext;
    const uploadTask = storage.ref(storagePath).put(currentReceiptFile);
    uploadTask.on('state_changed', null, function(err){
      console.error('Receipt upload failed:', err);
      alert('Receipt upload failed (storage may need CORS config). Record saved without receipt. Code: '+err.code);
      saveRec();
    }, function(){
      uploadTask.snapshot.ref.getDownloadURL().then(function(url){
        rec.receiptUrl = url;
        exp2Ref(activeVehicle).child(key).update({receiptUrl: url});
        saveRec();
      }).catch(function(e){
        console.error('Download URL failed:', e);
        saveRec();
      });
    });
  } else {
    saveRec();
  }
});
$('btn-delete-expense').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this expense?')) return;
  // Delete receipt from storage if present
  exp2Ref(activeVehicle).child(editingRecord.recordId).once('value').then(s=>{
    const rec=s.val();
    if(rec && rec.receiptUrl){
      storage.refFromURL(rec.receiptUrl).delete().catch(function(){});
    }
    return exp2Ref(activeVehicle).child(editingRecord.recordId).remove();
  }).then(()=>{ resetExpenseForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editExpense(vid, eid){
  exp2Ref(vid).child(eid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'expense', vehicleId:vid, recordId:eid};
    currentReceiptFile=null; $('ex-receipt').value='';
    $('ex-date').value=o.date||''; $('ex-odo').value=o.odometer||''; populateCategorySelect(o.category||'Insurance'); $('ex-desc').value=o.description||''; $('ex-amount').value=o.amount?o.amount.toFixed(2):'';
    // Show existing receipt preview
    var preview=$('ex-receipt-preview');
    if(o.receiptUrl){
      preview.innerHTML='<img src="'+o.receiptUrl+'" alt="Receipt">';
      preview.classList.remove('hidden');
    } else { preview.innerHTML=''; preview.classList.add('hidden'); }
    $('btn-delete-expense').classList.remove('hidden');
    showScreen('add-expense-screen');
  });
}

/* ─── TRIP FORM ─── */
function resetTripForm(){ todayInput(); $('tr-purpose').value=''; $('tr-start').value=''; $('tr-end').value=''; $('tr-dist').value=''; editingRecord=null; $('btn-delete-trip').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('tr-start').value=toNum(v.odometer)||''; });
}
function calcTripDist(){ const s=toNum($('tr-start').value), e=toNum($('tr-end').value); if(e>s) $('tr-dist').value=(e-s).toFixed(0); }
['input','change'].forEach(ev=>{ $('tr-start').addEventListener(ev,calcTripDist); $('tr-end').addEventListener(ev,calcTripDist); });

$('btn-tr-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-trip').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const s=toNum($('tr-start').value), e=toNum($('tr-end').value), d=toNum($('tr-dist').value)||(e>s?e-s:0);
  if(s<=0 || e<=0 || d<=0){ alert('Please enter valid odometer readings'); return; }
  const rec={ date:$('tr-date').value, purpose: $('tr-purpose').value.trim()||'Trip', startOdo: s, endOdo: e, distance: d, createdAt: firebase.database.ServerValue.TIMESTAMP };
  const key = editingRecord && editingRecord.type==='trip' ? editingRecord.recordId : tripRef(activeVehicle).push().key;
  Promise.all([
    tripRef(activeVehicle).child(key).set(rec),
    vRef().child(activeVehicle).update({ odometer: e, updatedAt: firebase.database.ServerValue.TIMESTAMP })
  ]).then(()=>{ resetTripForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});
$('btn-delete-trip').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this trip?')) return;
  tripRef(activeVehicle).child(editingRecord.recordId).remove().then(()=>{ resetTripForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editTrip(vid, tid){
  tripRef(vid).child(tid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'trip', vehicleId:vid, recordId:tid};
    $('tr-date').value=o.date||''; $('tr-purpose').value=o.purpose||''; $('tr-start').value=o.startOdo||''; $('tr-end').value=o.endOdo||''; $('tr-dist').value=o.distance||'';
    $('btn-delete-trip').classList.remove('hidden');
    showScreen('add-trip-screen');
  });
}


/* Reminders */
function loadRemindersTicker(){
  if(!settings.modules.reminders){ $('reminder-ticker').classList.add('hidden'); return; }
  vRef().once('value').then(vSnap=>{
    var vehicles=vSnap.val()||{};
    var vids=Object.keys(vehicles);
    Promise.all(vids.map(vid=>remindRef(vid).once('value').then(s=>s.val()||{}))).then(results=>{
      var entries=[];
      results.forEach((reminders,i)=>{
        var vid=vids[i]; var v=vehicles[vid];
        var curOdo=toNum(v.odometer);
        Object.values(reminders).forEach(r=>{
          if(r.enabled===false) return;
          if(r.status==='completed') return; // skip done
          // Date-based (date or both type)
          if((r.dueType==='date'||r.dueType==='both') && r.dueDate){
            var due=new Date(r.dueDate);
            var daysRemaining=Math.ceil((due-now())/86400000);
            var isOverdue=daysRemaining<=0;
            if(daysRemaining<=90) entries.push({vid:vid,plate:v.plate||vid,label:r.label,days:daysRemaining,isOverdue:isOverdue});
          }
          // Odo-based (odo or both type): warn at 80% of target
          if((r.dueType==='odo'||r.dueType==='both') && r.dueOdo && curOdo>0){
            var threshold=r.dueOdo*0.8;
            if(curOdo>=threshold){
              var odoRemaining=r.dueOdo-curOdo;
              var isOverdue=odoRemaining<=0;
              entries.push({vid:vid,plate:v.plate||vid,label:r.label+' (odo)',days:isOverdue?-1:Math.ceil(odoRemaining/100)*100,isOverdue:isOverdue,odoRemaining:odoRemaining});
            }
          }
        });
      });
      entries.sort((a,b)=>a.days-b.days);
      var ticker=$('reminder-ticker');
      if(entries.length){
        ticker.classList.remove('hidden');
        $('reminder-ticker-inner').innerHTML=' ⚠ '+entries.map(e=>{
          var txt;
          if(e.odoRemaining!==undefined){
            txt=e.plate+': '+e.label+(e.isOverdue?' ('+Math.abs(e.odoRemaining).toLocaleString()+' km over)':' (~'+Math.abs(e.odoRemaining).toLocaleString()+' km to go)');
          } else {
            txt=e.plate+': '+e.label+(e.isOverdue?' ('+Math.abs(e.days)+'d overdue)':(e.days>0?' (in '+e.days+'d)':' (today)'));
          }
          return e.isOverdue?'<span style="color:var(--danger)">'+txt+'</span>':txt;
        }).join('  ·  ')+'  ·  ';
      } else { ticker.classList.add('hidden'); }
    });
  });
}

function loadVehicleReminders(vid){
  remindRef(vid).once('value').then(s=>{
    var o=s.val()||{};
    var items=Object.entries(o).map(function(e){ return Object.assign({id:e[0]},e[1]); });
    // Auto-detect completion: fetch expenses & services for this vehicle
    Promise.all([
      exp2Ref(vid).once('value').then(s=>s.val()||{}),
      maintRef(vid).once('value').then(s=>s.val()||{})
    ]).then(([exps,svcs])=>{
      var nowDate=fmtDate(now());
      items.forEach(r=>{
        if(r.status==='completed') return; // already done
        if(r.enabled===false) return;
        var matchKey=(r.refLabel||r.label||'').toLowerCase();
        var found=false;
        // Check expenses: category match + date >= reminder date
        if((r.dueType==='date'||r.dueType==='both') && r.dueDate){
          Object.values(exps).forEach(ex=>{
            var cat=(ex.category||'').toLowerCase();
            if(cat===matchKey || cat.includes(matchKey) || matchKey.includes(cat)){
              if(ex.date >= r.dueDate){ found=true; }
            }
          });
        }
        // Check services: items match + date >= reminder date
        if(!found && (r.dueType==='date'||r.dueType==='both') && r.dueDate){
          Object.values(svcs).forEach(sv=>{
            var allNames=[(sv.items||'').toLowerCase()].concat((sv.alsoServiced||[]).map(function(x){return (x||'').toLowerCase();}));
            if(allNames.some(function(n){return n===matchKey||n.includes(matchKey)||matchKey.includes(n);})){
              if(sv.date >= r.dueDate){ found=true; }
            }
          });
        }
        // Check odo-based (also covers 'both' type)
        if(!found && (r.dueType==='odo'||r.dueType==='both') && r.dueOdo){
          Object.values(svcs).forEach(sv=>{
            var svcName=(sv.items||'').toLowerCase();
            var allNames=[svcName].concat((sv.alsoServiced||[]).map(function(x){return (x||'').toLowerCase();}));
            var svcOdo=toNum(sv.odometer);
            if(allNames.some(function(n){return n===matchKey||n.includes(matchKey)||matchKey.includes(n);}) && svcOdo>=r.dueOdo){
              found=true;
            }
          });
          // Also check expenses with odometer
          Object.values(exps).forEach(ex=>{
            var cat=(ex.category||'').toLowerCase();
            var exOdo=toNum(ex.odometer);
            if((cat===matchKey||cat.includes(matchKey)||matchKey.includes(cat)) && exOdo>=r.dueOdo){
              found=true;
            }
          });
        }
        if(found){
          remindRef(vid).child(r.id).update({status:'completed',completedAt:firebase.database.ServerValue.TIMESTAMP});
          r.status='completed';
        }
      });
      // Render
      renderReminderList(vid, items, o);
    });
  });
}

function renderReminderList(vid, items, rawO){
  items.sort((a,b)=>{
    if(a.status==='completed' && b.status!=='completed') return 1;
    if(a.status!=='completed' && b.status==='completed') return -1;
    return (a.dueDate||'').localeCompare(b.dueDate||'');
  });
  var nowDate=fmtDate(now());
  $('reminder-list').innerHTML=items.length?items.map(r=>{
    var isDone=r.status==='completed';
    // Compute days remaining for date-based and 'both' type
    var daysRemaining=null, isOverdue=false, isUpcoming=false;
    if(!isDone && r.dueDate){
      var due=new Date(r.dueDate);
      daysRemaining=Math.ceil((due-now())/86400000);
      if(daysRemaining<=0) isOverdue=true;
      else if(daysRemaining<=90) isUpcoming=true;
    }
    // Odo-based: compute distance to go
    var odoRemaining=null;
    if(!isDone && (r.dueType==='odo'||r.dueType==='both') && r.dueOdo){
      var curOdo=toNum(window.vehicles_cache?.[vid]?.odometer);
      if(curOdo>0) odoRemaining=r.dueOdo-curOdo;
    }
    var rowClass='';
    if(isOverdue) rowClass=' overdue';
    else if(isUpcoming) rowClass=' upcoming';
    if(isDone) rowClass='';
    var rowStyle='';
    if(isDone) rowStyle='opacity:0.5;border-left:3px solid var(--success)';
    // Days badge
    var daysBadge='';
    if(daysRemaining!==null){
      if(daysRemaining<=0) daysBadge=' <span style="color:var(--danger);font-size:0.68rem;font-weight:600">'+Math.abs(daysRemaining)+'d overdue</span>';
      else if(daysRemaining<=90) daysBadge=' <span style="color:var(--warn);font-size:0.68rem;font-weight:600">in '+daysRemaining+'d</span>';
      else daysBadge=' <span style="color:var(--muted);font-size:0.68rem">in '+daysRemaining+'d</span>';
    }
    // Odo badge
    if(odoRemaining!==null){
      var odoBadge='';
      if(odoRemaining<=0) odoBadge=' <span style="color:var(--danger);font-size:0.68rem;font-weight:600">('+Math.abs(odoRemaining).toLocaleString()+' km over)</span>';
      else odoBadge=' <span style="color:var(--warn);font-size:0.68rem;font-weight:600">('+odoRemaining.toLocaleString()+' km to go)</span>';
      daysBadge+=odoBadge;
    }
    var doneBadge=isDone?' <span style="color:var(--success);font-size:0.68rem">✓ Done</span>':'';
    var btns=isDone
      ? `<button class="btn-xs btn-ghost" onclick="event.stopPropagation();window.toggleReminderStatus('${esc(vid)}','${esc(r.id)}','active')">Undo</button>`
      : `<button class="btn-xs btn-ghost" onclick="event.stopPropagation();window.toggleReminderStatus('${esc(vid)}','${esc(r.id)}','completed')" style="color:var(--success)">Done</button>`;
    return `<div class="item${rowClass}" data-rid="${esc(r.id)}" style="cursor:pointer;${rowStyle}">
<div class="item-left"><div class="item-name">${esc(r.label)}${daysBadge}${doneBadge}${r.enabled===false?' <span style="color:var(--muted);font-size:0.68rem">(paused)</span>':''}</div>
<div class="item-meta">${r.dueType==='odo'?'Due at '+toNum(r.dueOdo).toLocaleString()+' km':(r.dueType==='both'?('Due: '+(r.dueDate||'')+' · '+toNum(r.dueOdo||0).toLocaleString()+' km'):r.dueDate||'')}${r.interval?' · Every '+r.interval:''}${r.refLabel?'<br><span style="color:var(--muted);font-size:0.65rem">'+esc(r.refLabel)+'</span>':''}${r.desc?' · '+esc(r.desc):''}</div></div>
<div class="item-amount">${btns}</div></div>`;
  }).join(''):'<div class="item"><div class="item-left"><div class="item-meta">No reminders &mdash; tap + to add</div></div></div>';
  // Click item → edit
  $('reminder-list').querySelectorAll('.item[data-rid]').forEach(el=>{
    el.addEventListener('click',()=>{
      var rid=el.dataset.rid;
      var data=rawO[rid];
      if(data) showReminderForm('edit',rid,data);
    });
  });
}

window.toggleReminder=function(vid,rid,curEnabled){
  remindRef(vid).child(rid).update({enabled:!curEnabled}).then(()=>loadVehicleReminders(vid));
};

window.toggleReminderStatus=function(vid,rid,newStatus){
  remindRef(vid).child(rid).update({status:newStatus,completedAt:newStatus==='completed'?firebase.database.ServerValue.TIMESTAMP:null}).then(()=>loadVehicleReminders(vid));
};

window._editingReminderId=null;
window._remModalMode='add';

function showReminderForm(mode, rid, data, ctx){
  if(!activeVehicle) return;
  mode=mode||'add';
  window._remModalMode=mode;
  window._editingReminderId=rid||null;
  window._remCtx=ctx||null;
  const modal=$('reminder-modal');
  const title=$('rem-modal-title');
  const formFields=$('rem-form-fields');
  const deleteConfirm=$('rem-delete-confirm');
  const saveBtn=$('btn-save-reminder');
  const deleteBtn=$('btn-rem-delete');

  if(mode==='delete'){
    title.textContent='Delete Reminder?';
    formFields.classList.add('hidden');
    deleteConfirm.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    deleteBtn.classList.add('hidden');
    modal.classList.remove('hidden');
    return;
  }

  // Add or Edit mode
  title.textContent=mode==='edit'?'Edit Reminder':'Add Reminder';
  formFields.classList.remove('hidden');
  deleteConfirm.classList.add('hidden');
  saveBtn.classList.remove('hidden');
  saveBtn.textContent=mode==='edit'?'Update Reminder':'Save Reminder';
  deleteBtn.classList.toggle('hidden',mode!=='edit');

  if(data){
    // Edit: pre-fill from existing reminder data
    $('rem-label').value=data.label||'';
    $('rem-type').value=data.dueType||'date';
    // Pre-fill interval fields (can't recover original, use defaults)
    if(data.dueType==='odo'){
      $('rem-interval-odo').value=10000;
    } else if(data.dueType==='both'){
      $('rem-interval-val').value=12;
      $('rem-interval-unit').value='months';
      $('rem-interval-odo').value=10000;
    } else {
      $('rem-interval-val').value=12;
      $('rem-interval-unit').value='months';
    }
    $('rem-note').value=data.desc||'';
    // Show reference from stored data if available
    $('rem-ref-info').style.display=data.refLabel?'block':'none';
    if(data.refLabel){ $('rem-ref-label').textContent=data.refLabel; $('rem-ref-detail').textContent=data.refDetail||''; }
  } else if(ctx){
    // From expense/service: pre-fill from context
    $('rem-label').value=ctx.label||'';
    $('rem-type').value='date';
    $('rem-interval-val').value=12;
    $('rem-interval-unit').value='months';
    $('rem-interval-odo').value=10000;
    $('rem-note').value='';
    $('rem-ref-info').style.display='block';
    $('rem-ref-label').textContent=ctx.refLabel||'';
    $('rem-ref-detail').textContent=ctx.refDetail||'';
  } else {
    // Fresh add
    $('rem-label').value='';
    $('rem-type').value='date';
    $('rem-interval-val').value=12;
    $('rem-interval-unit').value='months';
    $('rem-interval-odo').value=10000;
    $('rem-note').value='';
    $('rem-ref-info').style.display='none';
  }
  updateRemFormFields();
  updateRemDuePreview();
  modal.classList.remove('hidden');
}

function closeReminderModal(){
  $('reminder-modal').classList.add('hidden');
  window._editingReminderId=null;
  window._remModalMode='add';
  window._remCtx=null;
}

$('btn-reminder-close').addEventListener('click',closeReminderModal);
$('btn-rem-cancel-delete').addEventListener('click',closeReminderModal);
$('rem-type').addEventListener('change',()=>{ updateRemFormFields(); updateRemDuePreview(); });
$('rem-interval-val').addEventListener('input',updateRemDuePreview);
$('rem-interval-unit').addEventListener('change',updateRemDuePreview);
$('rem-interval-odo').addEventListener('input',updateRemDuePreview);

function updateRemFormFields(){
  const typ=$('rem-type').value;
  $('rem-interval-field').classList.toggle('hidden',typ!=='date'&&typ!=='both');
  $('rem-odo-interval-field').classList.toggle('hidden',typ!=='odo'&&typ!=='both');
}

function updateRemDuePreview(){
  const typ=$('rem-type').value;
  const el=$('rem-due-preview');
  const ctx=window._remCtx;
  if(typ==='date'){
    const val=parseInt($('rem-interval-val').value)||12;
    const unit=$('rem-interval-unit').value;
    const months=unit==='years'?val*12:val;
    const baseDate=ctx&&ctx.date?new Date(ctx.date):new Date();
    const due=new Date(baseDate); due.setMonth(due.getMonth()+months);
    el.textContent='Due: '+fmtDate(due);
  } else if(typ==='odo'){
    const interval=parseInt($('rem-interval-odo').value)||10000;
    const baseOdo=ctx&&ctx.odo?ctx.odo:0;
    const dueOdo=baseOdo+interval;
    el.textContent='Due at: '+dueOdo.toLocaleString()+' km';
  } else {
    // 'both' — show both previews
    const val=parseInt($('rem-interval-val').value)||12;
    const unit=$('rem-interval-unit').value;
    const months=unit==='years'?val*12:val;
    const baseDate=ctx&&ctx.date?new Date(ctx.date):new Date();
    const due=new Date(baseDate); due.setMonth(due.getMonth()+months);
    const interval=parseInt($('rem-interval-odo').value)||10000;
    const baseOdo=ctx&&ctx.odo?ctx.odo:0;
    const dueOdo=baseOdo+interval;
    el.textContent='Due: '+fmtDate(due)+' · '+dueOdo.toLocaleString()+' km (whichever first)';
  }
}

// Delete button in edit mode
$('btn-rem-delete').addEventListener('click',()=>{
  if(window._remModalMode==='edit' && window._editingReminderId){
    showReminderForm('delete',window._editingReminderId);
  }
});

// Confirm delete
$('btn-rem-confirm-delete').addEventListener('click',()=>{
  var rid=window._editingReminderId;
  if(!rid) return;
  remindRef(activeVehicle).child(rid).remove().then(()=>{
    closeReminderModal();
    loadVehicleReminders(activeVehicle);
  });
});

window.deleteReminder=function(vid,rid){
  showReminderForm('delete',rid);
};

$('btn-save-reminder').addEventListener('click',()=>{
  const errEl=$('rem-error');
  errEl.style.display='none';
  const label=$('rem-label').value.trim();
  if(!label){ errEl.textContent='Enter a label'; errEl.style.display='block'; return; }
  const typ=$('rem-type').value;
  let dueDate=null, dueOdo=null;
  const ctx=window._remCtx;
  if(typ==='date'||typ==='both'){
    const val=parseInt($('rem-interval-val').value)||12;
    const unit=$('rem-interval-unit').value;
    const months=unit==='years'?val*12:val;
    const baseDate=ctx&&ctx.date?new Date(ctx.date):new Date();
    const due=new Date(baseDate); due.setMonth(due.getMonth()+months);
    dueDate=fmtDate(due);
  }
  if(typ==='odo'||typ==='both'){
    const interval=parseInt($('rem-interval-odo').value)||10000;
    const baseOdo=ctx&&ctx.odo?ctx.odo:0;
    dueOdo=baseOdo+interval;
    if(!dueOdo){ errEl.textContent='Enter odometer interval'; errEl.style.display='block'; return; }
  }
  const desc=$('rem-note').value.trim();
  const rec={label:label,dueType:typ,dueDate:dueDate,dueOdo:dueOdo,desc:desc};
  if(!window._editingReminderId){
    rec.enabled=true;
    rec.status='active';
  }
  // Store reference info if from a record
  if(ctx){
    rec.refLabel=ctx.refLabel||'';
    rec.refDetail=ctx.refDetail||'';
    rec.interval=(typ==='date'?($('rem-interval-val').value+' '+$('rem-interval-unit').value):(typ==='odo'?($('rem-interval-odo').value+' km'):($('rem-interval-val').value+' '+$('rem-interval-unit').value+' / '+$('rem-interval-odo').value+' km')));
  }
  if(window._editingReminderId){
    remindRef(activeVehicle).child(window._editingReminderId).update(rec).then(()=>{
      closeReminderModal();
      loadVehicleReminders(activeVehicle);
    });
  } else {
    rec.createdAt=firebase.database.ServerValue.TIMESTAMP;
    remindRef(activeVehicle).push().set(rec).then(()=>{
      closeReminderModal();
      loadVehicleReminders(activeVehicle);
    });
  }
});

/* ─── EXPENSE CATEGORIES ─── */
function loadExpenseCategories(cb){
  catRef().once('value').then(s=>{
    var cats=s.val()||{};
    // Also discover from existing expense records
    if(cb) cb(cats);
  });
}

function renderCategoryManager(){
  loadExpenseCategories(cats=>{
    var entries=Object.entries(cats);
    entries.sort((a,b)=>a[1].localeCompare(b[1]));
    var h=entries.map(([id,name])=>`<div class="cat-row" data-cid="${esc(id)}">
      <span class="cat-row-name">${esc(name)}</span>
      <span class="cat-row-edit" title="Edit">✎</span>
      <span class="cat-row-del" title="Delete">&times;</span>
    </div>`).join('');
    $('cat-mgr-list').innerHTML=h||'<div style="color:var(--muted);font-size:0.8rem">No categories yet</div>';
    // Edit: tap ✎ icon or name → inline edit
    function startCatEdit(el, cid, curName){
      var inp=document.createElement('input');
      inp.type='text'; inp.value=curName; inp.style.cssText='flex:1;font-size:0.85rem;padding:2px 4px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text)';
      el.parentNode.replaceChild(inp,el);
      inp.focus(); inp.select();
      inp.addEventListener('blur',()=>saveCatEdit(cid,inp.value.trim()));
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); saveCatEdit(cid,inp.value.trim()); } });
    }
    $('cat-mgr-list').querySelectorAll('.cat-row-name').forEach(el=>{
      el.addEventListener('click',()=>startCatEdit(el,el.parentNode.dataset.cid,el.textContent));
    });
    $('cat-mgr-list').querySelectorAll('.cat-row-edit').forEach(el=>{
      el.addEventListener('click',e=>{
        e.stopPropagation();
        var row=el.parentNode;
        var nameEl=row.querySelector('.cat-row-name');
        startCatEdit(nameEl,row.dataset.cid,nameEl.textContent);
      });
    });
    // Delete
    $('cat-mgr-list').querySelectorAll('.cat-row-del').forEach(el=>{
      el.addEventListener('click',()=>{
        var cid=el.parentNode.dataset.cid;
        catRef().child(cid).remove().then(()=>renderCategoryManager());
      });
    });
  });
}

function saveCatEdit(cid, newName){
  if(!newName) return;
  catRef().child(cid).set(newName).then(()=>renderCategoryManager());
}

function populateCategorySelect(selectedVal){
  var sel=$('ex-category');
  if(!sel) return;
  catRef().once('value').then(s=>{
    var cats=s.val()||{};
    var names=Object.values(cats);
    // Also add hardcoded defaults + discover from existing expenses if needed
    if(!names.length) names=['Insurance','Road Tax','Toll / Parking','Accessories / Tyres','Fine','Car Wash / Detailing','Others'];
    names.sort();
    sel.innerHTML=names.map(n=>`<option value="${esc(n)}" ${n===selectedVal?'selected':''}>${esc(n)}</option>`).join('');
    // Ensure selectedVal is selected (if it doesn't match any option, select first)
    if(selectedVal && !names.includes(selectedVal)){
      // Add it as a one-off
      sel.innerHTML+=`<option value="${esc(selectedVal)}" selected>${esc(selectedVal)}</option>`;
    }
  });
}

$('btn-cat-add').addEventListener('click',()=>{
  var inp=$('cat-mgr-input');
  var name=inp.value.trim();
  if(!name) return;
  catRef().push().set(name).then(()=>{
    inp.value='';
    renderCategoryManager();
  });
});

/* ─── SERVICE ITEMS ─── */
function renderServiceItemManager(){
  svcItemRef().once('value').then(s=>{
    var items=s.val()||{};
    var entries=Object.entries(items);
    entries.sort((a,b)=>a[1].localeCompare(b[1]));
    var h=entries.map(([id,name])=>`<div class="cat-row" data-sid="${esc(id)}">
      <span class="cat-row-name">${esc(name)}</span>
      <span class="cat-row-edit" title="Edit">✎</span>
      <span class="cat-row-del" title="Delete">&times;</span>
    </div>`).join('');
    $('svc-item-list').innerHTML=h||'<div style="color:var(--muted);font-size:0.8rem">No items yet</div>';
    function startEdit(el, sid, curName){
      var inp=document.createElement('input');
      inp.type='text'; inp.value=curName; inp.style.cssText='flex:1;font-size:0.85rem;padding:2px 4px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text)';
      el.parentNode.replaceChild(inp,el);
      inp.focus(); inp.select();
      inp.addEventListener('blur',()=>{ var n=inp.value.trim(); if(n) svcItemRef().child(sid).set(n).then(()=>renderServiceItemManager()); });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); var n=inp.value.trim(); if(n) svcItemRef().child(sid).set(n).then(()=>renderServiceItemManager()); } });
    }
    $('svc-item-list').querySelectorAll('.cat-row-name').forEach(el=>{
      el.addEventListener('click',()=>startEdit(el,el.parentNode.dataset.sid,el.textContent));
    });
    $('svc-item-list').querySelectorAll('.cat-row-edit').forEach(el=>{
      el.addEventListener('click',e=>{
        e.stopPropagation();
        var row=el.parentNode; var nameEl=row.querySelector('.cat-row-name');
        startEdit(nameEl,row.dataset.sid,nameEl.textContent);
      });
    });
    $('svc-item-list').querySelectorAll('.cat-row-del').forEach(el=>{
      el.addEventListener('click',()=>{
        svcItemRef().child(el.parentNode.dataset.sid).remove().then(()=>renderServiceItemManager());
      });
    });
  });
}

function populateServiceItemSelect(selectedVal){
  var sel=$('mt-items');
  if(!sel) return;
  svcItemRef().once('value').then(s=>{
    var items=s.val()||{};
    var names=Object.values(items);
    if(!names.length) names=['Oil Change','Engine Oil','Oil Filter','Air Filter','Brake Pads','Spark Plugs','Tyre Rotation','AC Service','Battery','General Service'];
    names.sort();
    sel.innerHTML=names.map(n=>`<option value="${esc(n)}" ${n===selectedVal?'selected':''}>${esc(n)}</option>`).join('');
    if(selectedVal && !names.includes(selectedVal)){
      sel.innerHTML+=`<option value="${esc(selectedVal)}" selected>${esc(selectedVal)}</option>`;
    }
    _mtAlsoNames=names;
    if($('mt-also')) _renderMtAlsoChips();
  });
}

$('btn-svc-item-add').addEventListener('click',()=>{
  var inp=$('svc-item-input');
  var name=inp.value.trim();
  if(!name) return;
  svcItemRef().push().set(name).then(()=>{
    inp.value='';
    renderServiceItemManager();
  });
});

/* ─── SETTINGS ─── */
$('btn-settings').addEventListener('click',openSettings);
$('btn-settings-back').addEventListener('click',()=>showScreen('dash-screen'));
$('btn-settings-add-vehicle').addEventListener('click',()=>{ showScreen('add-vehicle-screen'); resetVehicleForm(); });

/* Settings tab switching */
document.querySelectorAll('.set-tab-btn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.set-tab-btn').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.set-tab-panel').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('set-tab-'+b.dataset.setTab).classList.add('active');
  });
});

function openSettings(){ 
  $('set-my-uid').textContent=currentUser.uid||'—'; 
  $('set-units').value=settings.units||'metric';
  $('set-currency').value=settings.currency||'RM';
  // Vehicle color pickers
  vRef().once('value').then(snap=>{
    var vehicles=snap.val()||{};
    var vids=Object.keys(vehicles);
    var h=vids.map(vid=>{
      var v=vehicles[vid]; var current=v.color||'';
      var opts=['red','orange','yellow','white','silver','grey','blue','black'].map(c=>'<option value="'+c+'" '+(current===c?'selected':'')+'>'+c+'</option>').join('');
      return '<div class="inline-field" style="margin-bottom:6px"><span style="flex:1;font-size:0.85rem">'+esc(v.plate||vid)+' '+esc(v.make||'')+' '+esc(v.model||'')+'</span><select onchange="setVehicleColor(\''+esc(vid)+'\',this.value)" style="width:100px">'+opts+'</select></div>';
    }).join('');
    $('veh-color-list').innerHTML=h||'No vehicles';
  });
  // Check if owner linked
  uRef('settings').once('value').then(s=>{
    const sets=s.val()||{};
    if(sets.ownerUid){ $('set-owner-uid').value=sets.ownerUid; $('btn-clear-owner').classList.remove('hidden'); }
    else { $('set-owner-uid').value=''; $('btn-clear-owner').classList.add('hidden'); }
    // Pending links for main account
    ownerLinksRef(currentUser.uid).once('value').then(ls=>{
      const links=ls.val()||{};
      const pending=Object.entries(links).filter(([_,l])=>l.status==='pending');
      const approved=Object.entries(links).filter(([_,l])=>l.status==='approved');
      if(pending.length){ $('owner-panel').classList.remove('hidden'); $('pending-links').innerHTML=pending.map(([id,l])=>`<div class="link-request"><div>${esc(l.name||id)}</div><div class="btn-row"><button class="btn-sm btn-approve" data-uid="${esc(id)}">Approve</button><button class="btn-sm btn-reject" data-uid="${esc(id)}">Reject</button></div></div>`).join('');
        $('pending-links').querySelectorAll('.btn-approve').forEach(b=>b.addEventListener('click',()=>{ approveLink(currentUser.uid,b.dataset.uid).then(()=>openSettings()); }));
        $('pending-links').querySelectorAll('.btn-reject').forEach(b=>b.addEventListener('click',()=>{ rejectLink(currentUser.uid,b.dataset.uid).then(()=>openSettings()); }));
      } else { $('owner-panel').classList.add('hidden'); }
      if(approved.length){ $('approved-panel').classList.remove('hidden'); $('approved-links').innerHTML=approved.map(([id,l])=>`<div class="link-request"><div>${esc(l.name||id)}</div><button class="btn-sm btn-ghost" data-uid="${esc(id)}" onclick="removeLink('${currentUser.uid}','${id}').then(()=>openSettings())">Remove</button></div>`).join(''); }
      else { $('approved-panel').classList.add('hidden'); }
    });
  });
  var m=settings.modules||{fuel:true,service:true}; $('set-mod-fuel').checked=!!m.fuel; $('set-mod-service').checked=!!m.service;
  $('set-mod-reminders').checked=!!m.reminders;
  renderCategoryManager();
  renderServiceItemManager();
  showScreen('settings-screen'); 
}

$('btn-save-owner').addEventListener('click',()=>{
  const ownerUid=$('set-owner-uid').value.trim();
  if(!ownerUid){ alert('Enter a Main Account ID'); return; }
  if(ownerUid===currentUser.uid){ alert('Cannot link to yourself'); return; }
  requestLink(currentUser.uid, ownerUid, currentUser.name).then(()=>{
    alert('Link request sent. Ask the main account owner to approve it in Settings.');
    $('btn-clear-owner').classList.remove('hidden');
  }).catch(e=>alert(e.message));
});

$('btn-clear-owner').addEventListener('click',()=>{
  if(!confirm('Unlink from main account?')) return;
  uRef('settings').update({ ownerUid: null }).then(()=>{
    $('set-owner-uid').value=''; $('btn-clear-owner').classList.add('hidden');
  });
});

/* Link helpers */
function ownerLinksRef(ownerUid){ return db.ref('maintained/'+ownerUid+'/links'); }
function requestLink(partnerUid, ownerUid, partnerName){
  return ownerLinksRef(ownerUid).child(partnerUid).set({ status:'pending', name: partnerName, requestedAt: firebase.database.ServerValue.TIMESTAMP });
}
function approveLink(ownerUid, partnerUid){
  return ownerLinksRef(ownerUid).child(partnerUid).update({ status:'approved', approvedAt: firebase.database.ServerValue.TIMESTAMP });
}
function rejectLink(ownerUid, partnerUid){
  return ownerLinksRef(ownerUid).child(partnerUid).update({ status:'rejected', rejectedAt: firebase.database.ServerValue.TIMESTAMP });
}
function removeLink(ownerUid, partnerUid){
  return ownerLinksRef(ownerUid).child(partnerUid).remove();
}

$('btn-export').addEventListener('click',()=>{
  if(!currentUser) return;
  uRef().once('value').then(s=>{
    const data=s.val()||{};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='maintained-'+currentUser.uid.slice(-6)+'.json'; a.click();
  });
});

$('btn-clear').addEventListener('click',()=>{
  if(!confirm('DELETE ALL vehicle data? This is irreversible.')) return;
  uRef().remove().then(()=>{ alert('All data cleared'); showScreen('dash-screen'); renderDash(); });
});
$('set-units').addEventListener('change',()=>{ settings.units=$('set-units').value; saveSettings(currentUser.uid,'units',settings.units); });
$('set-currency').addEventListener('change',()=>{ settings.currency=$('set-currency').value; saveSettings(currentUser.uid,'currency',settings.currency); });
$('set-mod-fuel').addEventListener('change',()=>{ setModule('fuel',$('set-mod-fuel').checked); });
$('set-mod-service').addEventListener('change',()=>{ setModule('service',$('set-mod-service').checked); });
$('set-mod-reminders').addEventListener('change',()=>{ setModule('reminders',$('set-mod-reminders').checked); });
window.setVehicleColor=function(vid,color){ vRef().child(vid).update({color}).then(()=>renderDash()); };

/* register service worker */
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(err=>console.log('SW fail',err)); }); }

})();
