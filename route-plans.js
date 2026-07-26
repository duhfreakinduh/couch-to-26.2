const ROUTE_MODE_KEY='stridefw.route.mode.v1';
const TRAINING_KEY='stridefw.training.v1';
const TRAINING_PLANS=window.STRIDE_TRAINING_PLANS||[];
const TRAINING_BY_ID=new Map(TRAINING_PLANS.map(plan=>[plan.id,plan]));

let routeMode=localStorage.getItem(ROUTE_MODE_KEY)||'walk';
let routeWaypoints=[];
let routedDistanceMeters=0;
let routeTimer=null;
let routeVersion=0;
let lastRouteRequestAt=0;
let routingBusy=false;
let trainingFilter='all';
let expandedPlanId=null;
let trainingState=loadTrainingState();

function loadTrainingState(){
  try{return{activePlanId:null,completed:{},...JSON.parse(localStorage.getItem(TRAINING_KEY)||'{}')}}
  catch{return{activePlanId:null,completed:{}}}
}
function saveTrainingState(){localStorage.setItem(TRAINING_KEY,JSON.stringify(trainingState))}

function routeProfile(){return routeMode==='ride'?'bike':'foot'}
function routeLabel(){return routeMode==='ride'?'Ride':routeMode==='run'?'Run':'Walk'}
function routeServer(){return`https://routing.openstreetmap.de/routed-${routeProfile()}/route/v1/driving/`}
function setPlanStatus(text,busy=false){
  const el=document.getElementById('planStatus');if(el)el.textContent=text;
  const dot=document.getElementById('routingDot');if(dot)dot.classList.toggle('busy',busy);
}

function initMaps(){
  map=L.map('map',{zoomControl:false}).setView([32.7555,-97.3308],13);
  planMap=L.map('planMap',{zoomControl:false}).setView([32.7555,-97.3308],13);
  const url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const opts={maxZoom:19,attribution:'&copy; OpenStreetMap'};
  L.tileLayer(url,opts).addTo(map);
  L.tileLayer(url,opts).addTo(planMap);
  planMap.on('click',e=>addRouteWaypoint(e.latlng.lat,e.latlng.lng));
}

function setRouteMode(mode,button){
  if(!['walk','run','ride'].includes(mode))return;
  routeMode=mode;
  localStorage.setItem(ROUTE_MODE_KEY,mode);
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));
  if(button)button.classList.add('active');
  if(routeWaypoints.length>=2)scheduleRoadRoute(0);else renderPlan();
}

function addRouteWaypoint(lat,lng){
  routeWaypoints.push([Number(lat),Number(lng)]);
  if(routeWaypoints.length===1){
    planPoints=[[Number(lat),Number(lng)]];
    routedDistanceMeters=0;
    renderPlan();
    setPlanStatus('Add another point — I’ll follow the roads.',false);
    return;
  }
  scheduleRoadRoute(250);
}

function scheduleRoadRoute(delay=350){
  clearTimeout(routeTimer);
  routeVersion++;
  const version=routeVersion;
  setPlanStatus(`Routing ${routeLabel().toLowerCase()} path…`,true);
  routeTimer=setTimeout(()=>buildRoadRoute(version),delay);
}

async function buildRoadRoute(version){
  if(version!==routeVersion||routeWaypoints.length<2)return;
  const wait=Math.max(0,1100-(Date.now()-lastRouteRequestAt));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(version!==routeVersion)return;

  const snapshot=routeWaypoints.map(p=>[p[0],p[1]]);
  const coords=snapshot.map(p=>`${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
  const url=`${routeServer()}${coords}?overview=full&geometries=geojson&steps=false&alternatives=false&generate_hints=false`;
  lastRouteRequestAt=Date.now();
  routingBusy=true;

  try{
    const response=await fetch(url,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`Routing error ${response.status}`);
    const data=await response.json();
    if(data.code!=='Ok'||!data.routes?.[0]?.geometry?.coordinates?.length)throw new Error(data.message||'No route found');
    if(version!==routeVersion)return;

    planPoints=data.routes[0].geometry.coordinates.map(p=>[p[1],p[0]]);
    routedDistanceMeters=Number(data.routes[0].distance)||0;
    if(Array.isArray(data.waypoints)&&data.waypoints.length===snapshot.length){
      routeWaypoints=data.waypoints.map(w=>[w.location[1],w.location[0]]);
    }
    renderPlan();
    setPlanStatus(`${routeLabel()} route follows mapped roads & paths.`,false);
  }catch(error){
    if(version!==routeVersion)return;
    planPoints=snapshot;
    routedDistanceMeters=pathMeters(planPoints,planMap);
    renderPlan();
    setPlanStatus('Road routing unavailable — showing a temporary straight preview.',false);
    toast('Could not route on roads. Try again in a moment.');
  }finally{routingBusy=false}
}

function renderPlan(){
  if(planLine)planLine.remove();
  planMarkers.forEach(m=>m.remove());
  planMarkers=[];
  if(planPoints.length)planLine=L.polyline(planPoints,{color:'#16a34a',weight:6,opacity:.95,lineJoin:'round'}).addTo(planMap);

  const markers=routeWaypoints.length?routeWaypoints:(planPoints.length?sampleRouteWaypoints(planPoints,Math.min(8,planPoints.length)):[]);
  markers.forEach((p,i)=>planMarkers.push(L.circleMarker(p,{radius:i===0?7:5,color:'#fff',weight:2,fillColor:i===0?'#16a34a':'#111827',fillOpacity:1}).addTo(planMap)));

  const meters=routedDistanceMeters||pathMeters(planPoints,planMap);
  planDistance.textContent=`${displayMeters(meters).toFixed(2)} ${settings.units}`;
  planPointsCount.textContent=markers.length;
  planBadge.textContent=`${markers.length} stop${markers.length===1?'':'s'} • ${routeLabel()}`;
}

function sampleRouteWaypoints(coords,max=10){
  if(!Array.isArray(coords)||!coords.length)return[];
  if(coords.length<=max)return coords.map(p=>[p[0],p[1]]);
  const step=(coords.length-1)/(max-1);
  return Array.from({length:max},(_,i)=>coords[Math.round(i*step)]).map(p=>[p[0],p[1]]);
}
function addMyLocationToPlan(){
  if(!lastPosition){enableGPS();toast('Turn on GPS first');return}
  addRouteWaypoint(lastPosition.lat,lastPosition.lng);
}
function undoPlan(){
  if(!routeWaypoints.length&&planPoints.length)routeWaypoints=sampleRouteWaypoints(planPoints,8);
  routeWaypoints.pop();
  if(!routeWaypoints.length){
    planPoints=[];routedDistanceMeters=0;renderPlan();setPlanStatus('Tap the map to add your first stop.',false);return;
  }
  if(routeWaypoints.length===1){planPoints=[...routeWaypoints];routedDistanceMeters=0;renderPlan();return}
  scheduleRoadRoute(0);
}
function reversePlan(){
  if(routeWaypoints.length<2)routeWaypoints=sampleRouteWaypoints(planPoints,8);
  routeWaypoints.reverse();scheduleRoadRoute(0);
}
function closePlan(){
  if(routeWaypoints.length<3){toast('Add at least 3 stops to close a loop');return}
  const first=routeWaypoints[0],last=routeWaypoints[routeWaypoints.length-1];
  if(planMap.distance(first,last)>4)routeWaypoints.push([...first]);
  scheduleRoadRoute(0);
}
function clearPlan(){
  routeVersion++;clearTimeout(routeTimer);routeWaypoints=[];planPoints=[];routedDistanceMeters=0;routeName.value='';renderPlan();setPlanStatus('Tap the map to add your first stop.',false);
}
function savePlan(){
  if(planPoints.length<2){toast('Add at least two stops');return}
  const miles=(routedDistanceMeters||pathMeters(planPoints,planMap))*MI_PER_M;
  const name=routeName.value.trim()||`${routeLabel()} route — ${displayMiles(miles).toFixed(1)} ${settings.units}`;
  routes.unshift({
    id:Date.now(),name,date:new Date().toISOString(),distanceMiles:round(miles,3),
    coords:planPoints.map(p=>[round(p[0],6),round(p[1],6)]),
    waypoints:routeWaypoints.map(p=>[round(p[0],6),round(p[1],6)]),profile:routeMode
  });
  persist();routeName.value='';toast('Road-following route saved');renderHistory();
}
function loadRoute(index){
  const r=routes[index];if(!r)return;
  routeMode=['walk','run','ride'].includes(r.profile)?r.profile:'walk';
  localStorage.setItem(ROUTE_MODE_KEY,routeMode);
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===routeMode));
  routeWaypoints=Array.isArray(r.waypoints)&&r.waypoints.length>=2?r.waypoints.map(p=>[p[0],p[1]]):sampleRouteWaypoints(r.coords||[],Math.min(10,(r.coords||[]).length));
  planPoints=(r.coords||[]).map(p=>[p[0],p[1]]);
  routedDistanceMeters=Number(r.distanceMiles||0)/MI_PER_M;
  routeName.value=r.name;
  showScreen('plan');renderPlan();
  if(routeWaypoints.length>=2)scheduleRoadRoute(100);
  setTimeout(fitPlan,180);
}

function sessionKey(id,week,day){return`${id}:${week}:${day}`}
function countPlanDone(plan){
  let count=0;
  plan.schedule.forEach((week,w)=>week.forEach((_,d)=>{if(trainingState.completed[sessionKey(plan.id,w,d)])count++}));
  return count;
}
function countStrengthSessions(plan){
  return plan.schedule.reduce((total,week)=>total+week.filter(session=>session.workout).length,0);
}
function sessionWorkoutHtml(session){
  if(!session.workout)return'<div class="sessionBlock"><b>Bodyweight</b><span>Recovery / cardio-only day.</span></div>';
  const moves=session.workout.moves.map(move=>`<li>${esc(move)}</li>`).join('');
  return`<div class="sessionBlock workoutBlock"><b>Bodyweight • ${session.workout.rounds} round${session.workout.rounds===1?'':'s'}</b><ol>${moves}</ol></div>`;
}
function sessionDetailsHtml(session){
  return`<div class="sessionDetailGrid"><div class="sessionBlock"><b>Cardio</b><span>${esc(session.cardio)}</span></div>${sessionWorkoutHtml(session)}${session.when?`<div class="sessionBlock"><b>When</b><span>${esc(session.when)}</span></div>`:''}${session.note?`<div class="sessionBlock cautionBlock"><b>Note</b><span>${esc(session.note)}</span></div>`:''}</div>`;
}
function weeklyPlanHtml(plan){
  return`<div class="weekList">${plan.schedule.map((week,wi)=>`<div class="weekBlock"><h4>Week ${wi+1}</h4>${week.map((session,di)=>{
    const key=sessionKey(plan.id,wi,di),done=!!trainingState.completed[key];
    return`<div class="sessionRow"><button class="sessionCheck ${done?'done':''}" onclick="toggleTrainingSession('${plan.id}',${wi},${di})" aria-label="Mark session complete">${done?'✓':''}</button><div class="sessionText"><b>Day ${di+1} • ${esc(session.title)}</b><span>${esc(session.cardio)}</span><details class="sessionDetails"><summary>See exact workout</summary>${sessionDetailsHtml(session)}</details></div></div>`;
  }).join('')}</div>`).join('')}</div>`;
}

function renderTrainingPlans(filter=trainingFilter){
  trainingFilter=filter;
  document.querySelectorAll('.planFilter').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
  renderActiveTraining();
  renderExerciseLibrary();

  const list=document.getElementById('trainingList');if(!list)return;
  const matching=TRAINING_PLANS.filter(plan=>filter==='all'||plan.category===filter);
  list.innerHTML=matching.map(plan=>{
    const expanded=expandedPlanId===plan.id;
    const total=plan.schedule.reduce((n,w)=>n+w.length,0);
    const done=countPlanDone(plan);
    const pct=total?Math.round(done/total*100):0;
    const strength=countStrengthSessions(plan);
    return`<article class="trainingCard"><div class="trainingTop"><div><div class="trainingTitle">${plan.icon} ${esc(plan.title)}</div><div class="trainingDesc">${esc(plan.desc)}</div></div><span class="trainingBadge">${esc(plan.level)}</span></div><div class="trainingMeta"><span>${plan.weeks} weeks</span><span>${plan.days} days/week</span><span>${strength} bodyweight sessions</span><span>${done}/${total} done</span></div><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div><div class="trainingActions"><button class="btn secondary" onclick="toggleTrainingDetails('${plan.id}')">${expanded?'Hide':'View'} plan</button><button class="btn primary" onclick="startTrainingPlan('${plan.id}')">${trainingState.activePlanId===plan.id?'Active plan':'Start plan'}</button></div>${expanded?weeklyPlanHtml(plan):''}</article>`;
  }).join('');
}
function toggleTrainingDetails(id){expandedPlanId=expandedPlanId===id?null:id;renderTrainingPlans()}
function startTrainingPlan(id){
  const plan=TRAINING_BY_ID.get(id);if(!plan)return;
  trainingState.activePlanId=id;saveTrainingState();expandedPlanId=id;renderTrainingPlans();toast(`${plan.title} is now your active plan`);
}
function toggleTrainingSession(id,week,day){
  const key=sessionKey(id,week,day);
  trainingState.completed[key]=!trainingState.completed[key];
  saveTrainingState();renderTrainingPlans();
}
function resetTrainingPlan(id){
  const plan=TRAINING_BY_ID.get(id);if(!plan)return;
  if(!confirm(`Reset progress for ${plan.title}?`))return;
  Object.keys(trainingState.completed).filter(key=>key.startsWith(`${id}:`)).forEach(key=>delete trainingState.completed[key]);
  saveTrainingState();renderTrainingPlans();toast('Plan progress reset');
}
function renderActiveTraining(){
  const host=document.getElementById('activePlan');if(!host)return;
  const plan=TRAINING_BY_ID.get(trainingState.activePlanId);
  if(!plan){host.innerHTML='<div class="panel hint">Pick a plan below. Every session includes the exact cardio and bodyweight work to do.</div>';return}

  const sessions=[];
  plan.schedule.forEach((week,w)=>week.forEach((session,d)=>sessions.push({w,d,session,key:sessionKey(plan.id,w,d)})));
  const next=sessions.find(item=>!trainingState.completed[item.key]);
  const done=countPlanDone(plan),pct=sessions.length?Math.round(done/sessions.length*100):0;
  host.innerHTML=`<div class="activePlanCard"><div class="activePlanLabel">Active plan • ${pct}% complete</div><div class="activePlanTitle">${plan.icon} ${esc(plan.title)}</div><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>${next?`<div class="activeNext"><small>Next up • Week ${next.w+1}, Day ${next.d+1}</small><b>${esc(next.session.title)}</b>${sessionDetailsHtml(next.session)}<button class="btn good" style="width:100%;margin-top:8px" onclick="toggleTrainingSession('${plan.id}',${next.w},${next.d})">✓ Mark done</button></div>`:'<div class="activeNext"><b>Plan complete!</b><p>Nice work. Reset it to repeat or pick another plan.</p></div>'}<button class="textBtn" onclick="resetTrainingPlan('${plan.id}')">Reset this plan</button></div>`;
}
function showTrainingFilter(filter,button){
  trainingFilter=filter;
  if(button)document.querySelectorAll('.planFilter').forEach(b=>b.classList.toggle('active',b===button));
  renderTrainingPlans(filter);
}
function renderExerciseLibrary(){
  const host=document.getElementById('exerciseLibrary');if(!host)return;
  const library=window.STRIDE_EXERCISE_LIBRARY||[];
  host.innerHTML=library.map(item=>`<details class="exerciseItem"><summary>${esc(item.name)}</summary><p>${esc(item.cue)}</p><small><b>Easier:</b> ${esc(item.easier)}</small></details>`).join('');
}

window.addEventListener('load',()=>{
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===routeMode));
  setPlanStatus('Tap the map to add your first stop.',false);
  renderTrainingPlans('all');
});