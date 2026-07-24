const ROUTE_MODE_KEY='stridefw.route.mode.v1';
const TRAINING_KEY='stridefw.training.v1';
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

const TRAINING_PLANS=[
  {id:'walk-start-4',category:'walk',icon:'🚶',title:'Start Walking',level:'Beginner',weeks:4,days:4,desc:'Build a consistent walking habit without overcomplicating it.',schedule:[
    ['20 min easy walk','20 min easy walk','25 min easy walk','30 min relaxed walk'],
    ['25 min easy walk','25 min brisk walk','30 min easy walk','35 min relaxed walk'],
    ['30 min brisk walk','25 min easy walk','35 min brisk walk','40 min relaxed walk'],
    ['30 min brisk walk','35 min mixed pace','40 min brisk walk','45 min comfortable walk']
  ]},
  {id:'walk-5k-6',category:'walk',icon:'🚶',title:'Walk a 5K',level:'Beginner',weeks:6,days:4,desc:'Progress from comfortable walks to completing a full 5K.',schedule:[
    ['25 min easy','25 min brisk','30 min easy','35 min long'],['30 min easy','25 min brisk + 5 fast','35 min easy','40 min long'],['30 min brisk','35 min easy','30 min hills or brisk','45 min long'],['35 min brisk','30 min easy','40 min mixed pace','50 min long'],['40 min brisk','30 min easy','45 min steady','55 min long'],['30 min easy','25 min brisk','20 min easy','5K walk']
  ]},
  {id:'run-5k-8',category:'run',icon:'🏃',title:'Run / Walk to 5K',level:'Beginner',weeks:8,days:3,desc:'A gentle 3-day plan using run/walk intervals to reach a 5K.',schedule:[
    ['20 min: 1 run / 2 walk','20 min: 1 run / 2 walk','25 min: 1 run / 2 walk'],
    ['22 min: 2 run / 2 walk','22 min: 2 run / 2 walk','28 min: 2 run / 2 walk'],
    ['25 min: 3 run / 2 walk','25 min: 3 run / 2 walk','30 min: 3 run / 2 walk'],
    ['28 min: 5 run / 2 walk','28 min: 5 run / 2 walk','32 min: 5 run / 2 walk'],
    ['30 min: 8 run / 2 walk','30 min: 8 run / 2 walk','35 min easy'],
    ['30 min: 10 run / 1 walk','32 min easy','38 min easy'],
    ['30 min continuous easy','35 min easy','40 min easy'],
    ['25 min easy','20 min easy + strides','5K run/walk']
  ]},
  {id:'run-10k-8',category:'run',icon:'🏃',title:'Build to 10K',level:'Intermediate',weeks:8,days:4,desc:'For someone already comfortable running about 3 miles.',schedule:[
    ['3 mi easy','2 mi easy + strides','3 mi steady','4 mi long'],['3 mi easy','3 mi intervals','3 mi easy','4.5 mi long'],['3.5 mi easy','3 mi tempo','3 mi easy','5 mi long'],['3 mi easy','3 mi hills','3.5 mi steady','5.5 mi long'],['4 mi easy','3.5 mi tempo','3 mi easy','6 mi long'],['3.5 mi easy','4 mi intervals','4 mi steady','6.5 mi long'],['4 mi easy','4 mi tempo','3 mi easy','7 mi long'],['3 mi easy','2.5 mi easy + strides','2 mi easy','10K']
  ]},
  {id:'ride-start-6',category:'ride',icon:'🚲',title:'Start Riding',level:'Beginner',weeks:6,days:3,desc:'Build bike comfort and endurance with three rides each week.',schedule:[
    ['20 min easy','25 min easy','35 min relaxed'],['25 min easy','30 min steady','40 min relaxed'],['30 min steady','30 min cadence changes','45 min long'],['35 min steady','30 min easy + 5 hard','50 min long'],['40 min steady','35 min rolling effort','60 min long'],['35 min easy','40 min steady','70 min comfortable ride']
  ]},
  {id:'ride-endurance-8',category:'ride',icon:'🚲',title:'Ride Endurance',level:'Intermediate',weeks:8,days:3,desc:'Increase time in the saddle with steady, interval, and long rides.',schedule:[
    ['40 min easy','35 min intervals','60 min long'],['45 min steady','40 min intervals','70 min long'],['50 min easy','45 min tempo','80 min long'],['45 min recovery','45 min hills','90 min long'],['55 min steady','50 min intervals','100 min long'],['60 min easy','50 min tempo','110 min long'],['60 min steady','55 min intervals','120 min long'],['40 min easy','35 min tune-up','75 min strong finish']
  ]},
  {id:'workout-base-4',category:'workout',icon:'💪',title:'Bodyweight Base',level:'Beginner',weeks:4,days:3,desc:'Simple full-body sessions that need little or no equipment.',schedule:[
    ['3 rounds: 8 squats, 6 incline push-ups, 10 glute bridges, 20s plank','20 min easy walk + mobility','3 rounds: 10 squats, 8 rows/band pulls, 8 step-ups/side, 20s plank'],
    ['3 rounds: 10 squats, 8 push-ups variation, 12 bridges, 25s plank','25 min brisk walk','3 rounds: 10 reverse lunges total, 10 rows, 10 step-ups/side, 25s plank'],
    ['4 rounds: 10 squats, 8 push-ups, 12 bridges, 30s plank','25 min walk + 6 x 20s brisk','4 rounds: 12 lunges total, 10 rows, 10 step-ups/side, 30s plank'],
    ['4 rounds: 12 squats, 10 push-ups variation, 15 bridges, 35s plank','30 min brisk walk','4 rounds: 14 lunges total, 12 rows, 12 step-ups/side, 35s plank']
  ]},
  {id:'workout-cardio-6',category:'workout',icon:'⚡',title:'Cardio + Strength',level:'Intermediate',weeks:6,days:4,desc:'Mix simple strength work with walking, running, or riding cardio.',schedule:[
    ['Strength A: 4 rounds x 8–12','30 min easy cardio','Strength B: 4 rounds x 8–12','40 min easy cardio'],
    ['Strength A','35 min cardio + 5 pickups','Strength B','45 min easy cardio'],
    ['Strength A + core','30 min intervals: 1 hard / 2 easy','Strength B + core','50 min easy cardio'],
    ['Strength A','40 min steady cardio','Strength B','55 min easy cardio'],
    ['Strength A + core','35 min intervals: 2 hard / 2 easy','Strength B + core','60 min easy cardio'],
    ['Strength A lighter','30 min steady cardio','Strength B lighter','45–60 min choice cardio']
  ]}
];

function loadTrainingState(){try{return{activePlanId:null,completed:{},...JSON.parse(localStorage.getItem(TRAINING_KEY)||'{}')}}catch{return{activePlanId:null,completed:{}}}}
function saveTrainingState(){localStorage.setItem(TRAINING_KEY,JSON.stringify(trainingState))}
function routeProfile(){return routeMode==='ride'?'bike':'foot'}
function routeLabel(){return routeMode==='ride'?'Ride':routeMode==='run'?'Run':'Walk'}
function routeServer(){return `https://routing.openstreetmap.de/routed-${routeProfile()}/route/v1/driving/`}
function setPlanStatus(text,busy=false){const el=document.getElementById('planStatus');if(el)el.textContent=text;const dot=document.getElementById('routingDot');if(dot)dot.classList.toggle('busy',busy)}

function initMaps(){
  map=L.map('map',{zoomControl:false}).setView([32.7555,-97.3308],13);
  planMap=L.map('planMap',{zoomControl:false}).setView([32.7555,-97.3308],13);
  const url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',opts={maxZoom:19,attribution:'&copy; OpenStreetMap'};
  L.tileLayer(url,opts).addTo(map);L.tileLayer(url,opts).addTo(planMap);
  planMap.on('click',e=>addRouteWaypoint(e.latlng.lat,e.latlng.lng));
}

function setRouteMode(mode,button){
  if(!['walk','run','ride'].includes(mode))return;
  routeMode=mode;localStorage.setItem(ROUTE_MODE_KEY,mode);
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));
  if(button)button.classList.add('active');
  if(routeWaypoints.length>=2)scheduleRoadRoute(0);else renderPlan();
}

function addRouteWaypoint(lat,lng){
  routeWaypoints.push([Number(lat),Number(lng)]);
  if(routeWaypoints.length===1){planPoints=[[Number(lat),Number(lng)]];routedDistanceMeters=0;renderPlan();setPlanStatus('Add another point — I’ll follow the roads.',false);return}
  scheduleRoadRoute(250);
}

function scheduleRoadRoute(delay=350){
  clearTimeout(routeTimer);routeVersion++;const version=routeVersion;
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
  lastRouteRequestAt=Date.now();routingBusy=true;
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`Routing error ${response.status}`);
    const data=await response.json();
    if(data.code!=='Ok'||!data.routes?.[0]?.geometry?.coordinates?.length)throw new Error(data.message||'No route found');
    if(version!==routeVersion)return;
    planPoints=data.routes[0].geometry.coordinates.map(p=>[p[1],p[0]]);
    routedDistanceMeters=Number(data.routes[0].distance)||0;
    if(Array.isArray(data.waypoints)&&data.waypoints.length===snapshot.length){routeWaypoints=data.waypoints.map(w=>[w.location[1],w.location[0]])}
    renderPlan();setPlanStatus(`${routeLabel()} route follows mapped roads & paths.`,false);
  }catch(error){
    if(version!==routeVersion)return;
    planPoints=snapshot;routedDistanceMeters=pathMeters(planPoints,planMap);renderPlan();
    setPlanStatus('Road routing unavailable — showing a temporary straight preview.',false);
    toast('Could not route on roads. Try again in a moment.');
  }finally{routingBusy=false}
}

function renderPlan(){
  if(planLine)planLine.remove();planMarkers.forEach(m=>m.remove());planMarkers=[];
  if(planPoints.length)planLine=L.polyline(planPoints,{color:'#16a34a',weight:6,opacity:.95,lineJoin:'round'}).addTo(planMap);
  const markers=routeWaypoints.length?routeWaypoints:(planPoints.length?sampleRouteWaypoints(planPoints,Math.min(8,planPoints.length)):[]);
  markers.forEach((p,i)=>planMarkers.push(L.circleMarker(p,{radius:i===0?7:5,color:'#fff',weight:2,fillColor:i===0?'#16a34a':'#111827',fillOpacity:1}).addTo(planMap)));
  const meters=routedDistanceMeters||pathMeters(planPoints,planMap);
  planDistance.textContent=`${displayMeters(meters).toFixed(2)} ${settings.units}`;
  planPointsCount.textContent=markers.length;
  planBadge.textContent=`${markers.length} stop${markers.length===1?'':'s'} • ${routeLabel()}`;
}

function sampleRouteWaypoints(coords,max=10){
  if(!Array.isArray(coords)||!coords.length)return[];if(coords.length<=max)return coords.map(p=>[p[0],p[1]]);
  const step=(coords.length-1)/(max-1);return Array.from({length:max},(_,i)=>coords[Math.round(i*step)]).map(p=>[p[0],p[1]]);
}
function addMyLocationToPlan(){if(!lastPosition){enableGPS();toast('Turn on GPS first');return}addRouteWaypoint(lastPosition.lat,lastPosition.lng)}
function undoPlan(){if(!routeWaypoints.length&&planPoints.length)routeWaypoints=sampleRouteWaypoints(planPoints,8);routeWaypoints.pop();if(!routeWaypoints.length){planPoints=[];routedDistanceMeters=0;renderPlan();setPlanStatus('Tap the map to add your first stop.',false);return}if(routeWaypoints.length===1){planPoints=[...routeWaypoints];routedDistanceMeters=0;renderPlan();return}scheduleRoadRoute(0)}
function reversePlan(){if(routeWaypoints.length<2)routeWaypoints=sampleRouteWaypoints(planPoints,8);routeWaypoints.reverse();scheduleRoadRoute(0)}
function closePlan(){if(routeWaypoints.length<3){toast('Add at least 3 stops to close a loop');return}const first=routeWaypoints[0],last=routeWaypoints[routeWaypoints.length-1];if(planMap.distance(first,last)>4)routeWaypoints.push([...first]);scheduleRoadRoute(0)}
function clearPlan(){routeVersion++;clearTimeout(routeTimer);routeWaypoints=[];planPoints=[];routedDistanceMeters=0;routeName.value='';renderPlan();setPlanStatus('Tap the map to add your first stop.',false)}
function savePlan(){
  if(planPoints.length<2){toast('Add at least two stops');return}
  const miles=(routedDistanceMeters||pathMeters(planPoints,planMap))*MI_PER_M;
  const name=routeName.value.trim()||`${routeLabel()} route — ${displayMiles(miles).toFixed(1)} ${settings.units}`;
  routes.unshift({id:Date.now(),name,date:new Date().toISOString(),distanceMiles:round(miles,3),coords:planPoints.map(p=>[round(p[0],6),round(p[1],6)]),waypoints:routeWaypoints.map(p=>[round(p[0],6),round(p[1],6)]),profile:routeMode});
  persist();routeName.value='';toast('Road-following route saved');renderHistory();
}
function loadRoute(index){
  const r=routes[index];if(!r)return;routeMode=['walk','run','ride'].includes(r.profile)?r.profile:'walk';localStorage.setItem(ROUTE_MODE_KEY,routeMode);
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===routeMode));
  routeWaypoints=Array.isArray(r.waypoints)&&r.waypoints.length>=2?r.waypoints.map(p=>[p[0],p[1]]):sampleRouteWaypoints(r.coords||[],Math.min(10,(r.coords||[]).length));
  planPoints=(r.coords||[]).map(p=>[p[0],p[1]]);routedDistanceMeters=Number(r.distanceMiles||0)/MI_PER_M;routeName.value=r.name;showScreen('plan');renderPlan();if(routeWaypoints.length>=2)scheduleRoadRoute(100);setTimeout(fitPlan,180)
}

function renderTrainingPlans(filter=trainingFilter){
  trainingFilter=filter;document.querySelectorAll('.planFilter').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));renderActiveTraining();
  const list=document.getElementById('trainingList');if(!list)return;list.innerHTML='';
  TRAINING_PLANS.filter(p=>filter==='all'||p.category===filter).forEach(plan=>{
    const card=document.createElement('div');card.className='trainingCard';
    const expanded=expandedPlanId===plan.id;const total=plan.schedule.reduce((n,w)=>n+w.length,0),done=countPlanDone(plan),pct=total?Math.round(done/total*100):0;
    card.innerHTML=`<div class="trainingTop"><div><div class="trainingTitle">${plan.icon} ${esc(plan.title)}</div><div class="trainingDesc">${esc(plan.desc)}</div></div><span class="trainingBadge">${plan.level}</span></div><div class="trainingMeta"><span>${plan.weeks} weeks</span><span>${plan.days} days/week</span><span>${done}/${total} done</span></div><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div><div class="trainingActions"><button class="btn secondary" onclick="toggleTrainingDetails('${plan.id}')">${expanded?'Hide':'View'} plan</button><button class="btn primary" onclick="startTrainingPlan('${plan.id}')">${trainingState.activePlanId===plan.id?'Active plan':'Start plan'}</button></div>${expanded?weeklyPlanHtml(plan):''}`;
    list.appendChild(card);
  });
}
function weeklyPlanHtml(plan){return `<div class="weekList">${plan.schedule.map((week,wi)=>`<div class="weekBlock"><h4>Week ${wi+1}</h4>${week.map((session,di)=>{const key=sessionKey(plan.id,wi,di),done=!!trainingState.completed[key];return `<div class="sessionRow"><button class="sessionCheck ${done?'done':''}" onclick="toggleTrainingSession('${plan.id}',${wi},${di})">${done?'✓':''}</button><div class="sessionText"><b>Day ${di+1}</b><span>${esc(session)}</span></div></div>`}).join('')}</div>`).join('')}</div>`}
function toggleTrainingDetails(id){expandedPlanId=expandedPlanId===id?null:id;renderTrainingPlans()}
function sessionKey(id,w,d){return `${id}:${w}:${d}`}
function countPlanDone(plan){let n=0;plan.schedule.forEach((week,w)=>week.forEach((_,d)=>{if(trainingState.completed[sessionKey(plan.id,w,d)])n++}));return n}
function startTrainingPlan(id){const p=TRAINING_PLANS.find(x=>x.id===id);if(!p)return;trainingState.activePlanId=id;saveTrainingState();expandedPlanId=id;renderTrainingPlans();toast(`${p.title} is now your active plan`)}
function toggleTrainingSession(id,w,d){const key=sessionKey(id,w,d);trainingState.completed[key]=!trainingState.completed[key];saveTrainingState();renderTrainingPlans()}
function renderActiveTraining(){
  const host=document.getElementById('activePlan');if(!host)return;const p=TRAINING_PLANS.find(x=>x.id===trainingState.activePlanId);if(!p){host.innerHTML='<div class="panel hint">Pick a plan below. Your progress stays saved on this device.</div>';return}
  const sessions=[];p.schedule.forEach((week,w)=>week.forEach((text,d)=>sessions.push({w,d,text,key:sessionKey(p.id,w,d)})));const next=sessions.find(x=>!trainingState.completed[x.key]);const done=countPlanDone(p),pct=Math.round(done/sessions.length*100);
  host.innerHTML=`<div class="activePlanCard"><div class="activePlanLabel">Active plan • ${pct}% complete</div><div class="activePlanTitle">${p.icon} ${esc(p.title)}</div><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div>${next?`<div class="activeNext"><small>Next up • Week ${next.w+1}, Day ${next.d+1}</small><b>${esc(next.text)}</b><p>Keep the effort comfortable enough to finish with good form.</p><button class="btn good" style="width:100%;margin-top:8px" onclick="toggleTrainingSession('${p.id}',${next.w},${next.d})">✓ Mark done</button></div>`:'<div class="activeNext"><b>Plan complete!</b><p>Nice work. Pick another plan or repeat this one.</p></div>'}</div>`;
}
function showTrainingFilter(filter,button){trainingFilter=filter;if(button)document.querySelectorAll('.planFilter').forEach(b=>b.classList.toggle('active',b===button));renderTrainingPlans(filter)}

window.addEventListener('load',()=>{
  document.querySelectorAll('.routeMode').forEach(x=>x.classList.toggle('active',x.dataset.mode===routeMode));
  setPlanStatus('Tap the map to add your first stop.',false);
  renderTrainingPlans('all');
});
