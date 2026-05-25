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
const APP_VER = 'v1.0-maintained';
const STAGING = location.hostname.includes('-staging');

/* ─── STATE ─── */
let currentUser = null;
let authReady = false;
let activeVehicle = null;   // vehicle id
let editingRecord = null;   // { type, vehicleId, recordId }
let settings = { units:'metric', currency:'RM', modules:{fuel:true,service:true,expenses:true,trips:true,reminders:true} };
let _vehCallback = null;

/* ─── HELPERS ─── */
function $(id){ return document.getElementById(id); }
function now(){ return new Date(); }
function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtMoney(n,sym){ const s=sym||settings.currency||'RM'; return s+' '+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtMoneyW(n,sym){ const s=sym||settings.currency||'RM'; return s+' '+n.toLocaleString('en-US',{maximumFractionDigits:0}); }
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
const VEHC_NAME={red:'#ef4444',orange:'#f97316',yellow:'#eab308',white:'#e5e7eb',silver:'#9ca3af',blue:'#3b82f6',black:'#6b7280'};
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
  const name=$('login-name').value.trim();
  if(!email||!password){ alert('Enter email and password'); return; }
  if(!authReady){ alert('Auth initializing, try again in 2 seconds'); return; }
  auth.signInWithEmailAndPassword(email, password)
    .then(cred=>{ currentUser = { uid:cred.user.uid, name:name||cred.user.displayName||'User', email:cred.user.email }; if(name) saveUserProfile(cred.user.uid,name); $('dash-greeting').textContent=currentUser.email; showScreen('dash-screen'); renderDash(); attachListeners(cred.user.uid); })
    .catch(err=>{
      if(err.code==='auth/user-not-found'){
        if(!name){ alert('Enter your name to create a new account'); return; }
        if(password.length<6){ alert('Password must be at least 6 characters'); return; }
        return auth.createUserWithEmailAndPassword(email,password)
          .then(cred=>{ currentUser={uid:cred.user.uid,name,email:cred.user.email}; saveUserProfile(cred.user.uid,name); $('dash-greeting').textContent=currentUser.email; showScreen('dash-screen'); renderDash(); attachListeners(cred.user.uid); });
      }
      alert(err.message);
    });
}

$('btn-switch-user').addEventListener('click',()=>{ auth.signOut().then(()=>{ currentUser=null; activeVehicle=null; editingRecord=null; detachListeners(); $('login-email').value=''; $('login-name').value=''; $('login-password').value=''; showScreen('login-screen'); }); });

/* ─── DASHBOARD ─── */
function renderDash(){
  if(!currentUser) return;
  const uid=currentUser.uid;
  vRef().once('value').then(snap=>{
    const vehicles=snap.val()||{};
    const vids=Object.keys(vehicles);
    window.vehicles_cache=vehicles;
    // Vehicle cards with placeholder cost stats
    const container=$('vehicle-list');
    let h='';
    vids.forEach(id=>{
      const v=vehicles[id]; const isMotorcycle=v.vehicleType==='Motorcycle';
      h+=`<div class="vehicle-card" data-vid="${esc(id)}"><div class="vc-top"><div class="vc-type-badge">${isMotorcycle?'🏍️':'🚗'}</div><div class="vc-info"><div class="vehicle-name">${esc(v.make||'')} ${esc(v.model||'')} ${esc(v.year||'')}</div><div class="vehicle-plate">${esc(v.plate||'')} · ${esc(v.fuelType||'Petrol')}</div></div></div><div class="vc-costs"><div class="vc-stat"><span class="vc-stat-val" id="vccpd-${esc(id)}">—</span><span class="vc-stat-label">/mo</span></div><div class="vc-stat"><span class="vc-stat-val" id="vccpkm-${esc(id)}">—</span><span class="vc-stat-label">/km</span></div></div></div>`;
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
        if(settings.modules.service) $('hero-service').textContent = fmtMoneyW(svcTotal);
        if(settings.modules.expenses) $('hero-expense').textContent = fmtMoneyW(expTotal);
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
      renderRecentSlice(0);(it=>`<div class="item" style="border-left:3px solid ${it.color}"><div class="item-left"><div class="item-name"><span class="veh-chip" style="background:${it.color}22;color:${it.color};font-size:0.68rem;font-weight:600;padding:1px 6px;border-radius:3px;margin-right:4px">${esc(vehicles[it.vid]?.plate||it.vid)}</span>${esc(it.label)}</div><div class="item-meta">${esc(it.date)} · ${esc(it.meta)}</div></div><div class="item-amount">${it.amount?fmtMoney(it.amount):''}</div></div>`).join('') || '<div class="item"><div class="item-left"><div class="item-meta">No records yet</div></div></div>';
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
          // Fallback: odometer range from all records (fills, service, expenses) if no trip/fillup distance
          let minOdo=Infinity, maxOdo=-Infinity;
          Object.values(fills).forEach(o=>{ const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo) minOdo=odo; if(odo>maxOdo) maxOdo=odo; } });
          Object.values(svcs).forEach(o=>{ const odo=toNum(o.odometer); if(odo>0){ if(odo<minOdo) minOdo=odo; if(odo>maxOdo) maxOdo=odo; } });
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
        let svcExpTotal=0;
        results.forEach(([fills,svcs,exps,trips],i)=>{ Object.values(svcs).forEach(o=>{ svcExpTotal+=toNum(o.totalCost); }); Object.values(exps).forEach(o=>{ svcExpTotal+=toNum(o.amount); }); });
        $('alltime-svcexp').textContent = fmtMoney(svcExpTotal);
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
    loadRemindersTicker();
  });
}

function renderRecentSlice(start){
  const el=$('recent-list');
  if(!window._recentCache||!window._recentCache.length){ el.innerHTML='<div class="item"><div class="item-left"><div class="item-meta">No records yet</div></div></div>'; return; }
  const slice=window._recentCache.slice(start,start+10);
  let h=slice.map(it=>`<div class="item" style="border-left:3px solid ${it.color}"><div class="item-left"><div class="item-name"><span class="veh-chip" style="background:${it.color}22;color:${it.color};font-size:0.68rem;font-weight:600;padding:1px 6px;border-radius:3px;margin-right:4px">${esc(window.vehicles_cache?.[it.vid]?.plate||it.vid)}</span>${esc(it.label)}</div><div class="item-meta">${esc(it.date)} &middot; ${esc(it.meta)}</div></div><div class="item-amount">${it.amount?fmtMoney(it.amount):''}</div></div>`).join('');
  if(start===0) el.innerHTML=h;
  else el.innerHTML+=h;
  if(start+10<window._recentCache.length) el.innerHTML+=`<button class="load-more-btn" onclick="renderRecentSlice(${start+10})">Show more&hellip; (${window._recentCache.length-(start+10)} remaining)</button>`;
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
  loadVehicleTabs(vid);
  // Set default trip start from last end
  tripRef(vid).once('value').then(s=>{ const o=s.val()||{}; const arr=Object.values(o).sort((a,b)=>b.date?.localeCompare(a.date)||0); if(arr[0]) $('tr-start').value = arr[0].endOdo||''; });
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
    $('maintenance-list').innerHTML = items.length ? items.map(r=>`<div class="item" data-mid="${esc(r.id)}"><div class="item-left"><div class="item-name">${esc(r.items||'Service')}</div><div class="item-meta">${fmtDate2(r.date)} · ${esc(r.shop||'')} · Odo ${toNum(r.odometer).toLocaleString()}</div></div><div class="item-amount">${fmtMoney(toNum(r.totalCost))}</div></div>`).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No service records</div></div></div>';
    $('maintenance-list').querySelectorAll('.item[data-mid]').forEach(el=>el.addEventListener('click',()=>editMaintenance(vid,el.dataset.mid)));
  });
  }
  // Expense list
  exp2Ref(vid).once('value').then(s=>{
    const o=s.val()||{};
    let items=Object.entries(o).map(([id,r])=>({id,...r})).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    $('expense-list').innerHTML = items.length ? items.map(r=>`<div class="item" data-eid="${esc(r.id)}"><div class="item-left"><div class="item-name">${esc(r.category||'Expense')}${r.description?' · '+esc(r.description):''}</div><div class="item-meta">${fmtDate2(r.date)}${r.odometer?' · Odo '+toNum(r.odometer).toLocaleString()+' km':''}</div></div><div class="item-amount">${fmtMoney(toNum(r.amount))}</div></div>`).join('') : '<div class="item"><div class="item-left"><div class="item-meta">No expenses</div></div></div>';
    $('expense-list').querySelectorAll('.item[data-eid]').forEach(el=>el.addEventListener('click',()=>editExpense(vid,el.dataset.eid)));
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
    // Fallback: odometer range
    if(totalDist===0 && minOdo<maxOdo) totalDist=maxOdo-minOdo;
    if(totalCost>0 && totalDist>0) $('stat-costkm').textContent=fmtMoney(totalCost/totalDist);
    else if(totalCost>0 && totalDist===0) $('stat-costkm').textContent='—';
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
let mtAmountStr='';
function resetMaintenanceForm(){ todayInput(); $('mt-odo').value=''; $('mt-items').value=''; $('mt-shop').value=''; mtAmountStr=''; $('mt-amount').textContent='0.00'; $('mt-next-odo').value=''; $('mt-next-date').value=''; editingRecord=null; $('btn-delete-maintenance').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('mt-odo').value=toNum(v.odometer)||''; });
}
function handleMtNumpad(k){
  if(k==='C') mtAmountStr='';
  else if(k==='.' && mtAmountStr.includes('.')) return;
  else if(mtAmountStr.replace('.','').length>=7) return;
  else mtAmountStr+=k;
  $('mt-amount').textContent = mtAmountStr ? parseFloat(mtAmountStr).toFixed(2) : '0.00';
}
$('add-maintenance-screen').querySelectorAll('.numpad button').forEach(b=>b.addEventListener('click',()=>handleMtNumpad(b.dataset.k)));

$('btn-mt-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-maintenance').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const odo=toNum($('mt-odo').value); const amt=mtAmountStr?parseFloat(mtAmountStr):0;
  if(!$('mt-items').value.trim()){ alert('Please describe the service items'); return; }
  const rec={ date:$('mt-date').value, odometer: odo, items: $('mt-items').value.trim(), shop: $('mt-shop').value.trim(), totalCost: amt, nextOdo: toNum($('mt-next-odo').value)||null, nextDate: $('mt-next-date').value||null, createdAt: firebase.database.ServerValue.TIMESTAMP };
  const key = editingRecord && editingRecord.type==='maintenance' ? editingRecord.recordId : maintRef(activeVehicle).push().key;
  Promise.all([
    maintRef(activeVehicle).child(key).set(rec),
    vRef().child(activeVehicle).update({ odometer: odo, updatedAt: firebase.database.ServerValue.TIMESTAMP })
  ]).then(()=>{ resetMaintenanceForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});
$('btn-delete-maintenance').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this service record?')) return;
  maintRef(activeVehicle).child(editingRecord.recordId).remove().then(()=>{ resetMaintenanceForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editMaintenance(vid, mid){
  maintRef(vid).child(mid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'maintenance', vehicleId:vid, recordId:mid};
    $('mt-date').value=o.date||''; $('mt-odo').value=o.odometer||''; $('mt-items').value=o.items||''; $('mt-shop').value=o.shop||''; mtAmountStr=o.totalCost?String(o.totalCost):''; $('mt-amount').textContent=mtAmountStr?parseFloat(mtAmountStr).toFixed(2):'0.00'; $('mt-next-odo').value=o.nextOdo||''; $('mt-next-date').value=o.nextDate||'';
    $('btn-delete-maintenance').classList.remove('hidden');
    showScreen('add-maintenance-screen');
  });
}

/* ─── EXPENSE FORM ─── */
let exAmountStr='';
function resetExpenseForm(){ todayInput(); $('ex-odo').value=''; $('ex-category').value='Insurance'; $('ex-desc').value=''; exAmountStr=''; $('ex-amount').textContent='0.00'; editingRecord=null; $('btn-delete-expense').classList.add('hidden');
  if(activeVehicle) vRef().child(activeVehicle).once('value').then(s=>{ const v=s.val(); if(v) $('ex-odo').value=toNum(v.odometer)||''; }); }
function handleExNumpad(k){
  if(k==='C') exAmountStr='';
  else if(k==='.' && exAmountStr.includes('.')) return;
  else if(exAmountStr.replace('.','').length>=7) return;
  else exAmountStr+=k;
  $('ex-amount').textContent = exAmountStr ? parseFloat(exAmountStr).toFixed(2) : '0.00';
}
$('add-expense-screen').querySelectorAll('.numpad button').forEach(b=>b.addEventListener('click',()=>handleExNumpad(b.dataset.k)));

$('btn-ex-back').addEventListener('click',()=>showScreen('vehicle-screen'));
$('btn-save-expense').addEventListener('click',()=>{
  if(!activeVehicle) return;
  const amt=exAmountStr?parseFloat(exAmountStr):0;
  const rec={ date:$('ex-date').value, odometer: toNum($('ex-odo').value)||null, category:$('ex-category').value, description:$('ex-desc').value.trim(), amount: amt, createdAt: firebase.database.ServerValue.TIMESTAMP };
  const key = editingRecord && editingRecord.type==='expense' ? editingRecord.recordId : exp2Ref(activeVehicle).push().key;
  exp2Ref(activeVehicle).child(key).set(rec).then(()=>{ resetExpenseForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});
$('btn-delete-expense').addEventListener('click',()=>{
  if(!editingRecord || !activeVehicle) return;
  if(!confirm('Delete this expense?')) return;
  exp2Ref(activeVehicle).child(editingRecord.recordId).remove().then(()=>{ resetExpenseForm(); showScreen('vehicle-screen'); loadVehicleTabs(activeVehicle); });
});

function editExpense(vid, eid){
  exp2Ref(vid).child(eid).once('value').then(s=>{
    const o=s.val(); if(!o) return;
    editingRecord={type:'expense', vehicleId:vid, recordId:eid};
    $('ex-date').value=o.date||''; $('ex-odo').value=o.odometer||''; $('ex-category').value=o.category||'Insurance'; $('ex-desc').value=o.description||''; exAmountStr=o.amount?String(o.amount):''; $('ex-amount').textContent=exAmountStr?parseFloat(exAmountStr).toFixed(2):'0.00';
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
        Object.values(reminders).forEach(r=>{
          if(r.enabled===false) return;
          if(r.dueType==='date' && r.dueDate){
            var due=new Date(r.dueDate);
            var daysRemaining=Math.ceil((due-now())/86400000);
            if(daysRemaining<=90) entries.push({vid:vid,plate:v.plate||vid,dueLabel:r.label+' ('+(daysRemaining>0?'in '+daysRemaining+'d':'Overdue')+')', urgency:daysRemaining});
          }
        });
      });
      entries.sort((a,b)=>a.urgency-b.urgency);
      var ticker=$('reminder-ticker');
      if(entries.length){
        ticker.classList.remove('hidden');
        $('reminder-ticker-inner').textContent=' ⚠ '+entries.map(e=>e.plate+': '+e.dueLabel).join('  ·  ')+'  ·  ';
      } else { ticker.classList.add('hidden'); }
    });
  });
}

function loadVehicleReminders(vid){
  remindRef(vid).once('value').then(s=>{
    var o=s.val()||{};
    var items=Object.entries(o).map(function(e){ return Object.assign({id:e[0]},e[1]); });
    items.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
    $('reminder-list').innerHTML=items.length?items.map(r=>`<div class="item" data-rid="${esc(r.id)}">
<div class="item-left"><div class="item-name">${esc(r.label)}${r.enabled===false?' <span style="color:var(--muted);font-size:0.68rem">(paused)</span>':''}</div>
<div class="item-meta">${r.dueType==='odo'?'Due at '+toNum(r.dueOdo).toLocaleString()+' km':r.dueDate||''} &middot; ${r.desc||''}</div></div>
<div class="item-amount">
  <button class="btn-xs btn-ghost" onclick="window.toggleReminder('${esc(vid)}','${esc(r.id)}',${r.enabled!==false})">${r.enabled===false?'Resume':'Pause'}</button>
  <button class="btn-xs btn-danger" onclick="window.deleteReminder('${esc(vid)}','${esc(r.id)}')">&times;</button>
</div></div>`).join(''):'<div class="item"><div class="item-left"><div class="item-meta">No reminders &mdash; tap + to add</div></div></div>';
  });
}

window.toggleReminder=function(vid,rid,curEnabled){
  remindRef(vid).child(rid).update({enabled:!curEnabled}).then(()=>loadVehicleReminders(vid));
};

window.deleteReminder=function(vid,rid){
  if(!confirm('Delete this reminder?')) return;
  remindRef(vid).child(rid).remove().then(()=>loadVehicleReminders(vid));
};

function showReminderForm(){
  if(!activeVehicle) return;
  var label=prompt('Reminder label (e.g. Renew Road Tax):');
  if(!label) return;
  var type=confirm('Date-based? (OK=date, Cancel=odometer)')?'date':'odo';
  var dueDate=null, dueOdo=null, desc='';
  if(type==='date'){
    var d=prompt('Due date (YYYY-MM-DD):');
    if(!d) return;
    dueDate=d;
  } else {
    var o=prompt('Due odometer (km):');
    if(!o) return;
    dueOdo=parseInt(o);
  }
  desc=prompt('Optional note:')||'';
  var rec={label:label,dueType:type,dueDate:dueDate,dueOdo:dueOdo,desc:desc,enabled:true,createdAt:firebase.database.ServerValue.TIMESTAMP};
  remindRef(activeVehicle).push().set(rec).then(()=>{ loadVehicleReminders(activeVehicle); });
}

/* ─── SETTINGS ─── */
$('btn-settings').addEventListener('click',openSettings);
$('btn-settings-back').addEventListener('click',()=>showScreen('dash-screen'));
$('btn-settings-add-vehicle').addEventListener('click',()=>{ showScreen('add-vehicle-screen'); resetVehicleForm(); });
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
      var opts=['red','orange','yellow','white','silver','blue','black'].map(c=>'<option value="'+c+'" '+(current===c?'selected':'')+'>'+c+'</option>').join('');
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
