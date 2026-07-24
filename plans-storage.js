function renderHealth(){}
function startHealthConnect(){toast('Health integrations are not part of this build')}
function refreshHealth(){toast('Health integrations are not part of this build')}
function renderFitbit(){}
function startFitbitConnect(){toast('Fitbit has been removed from Stride FW')}
function refreshFitbit(){toast('Fitbit has been removed from Stride FW')}

function exportData(){
  const payload={exportedAt:new Date().toISOString(),activities,routes,settings,crew,training:trainingState};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=`stride-fw-${new Date().toISOString().slice(0,10)}.json`;anchor.click();URL.revokeObjectURL(url);
  toast('Stride FW data exported');
}

function clearAllData(){
  if(!confirm('Delete every saved activity, route, crew and training-plan progress on this device?'))return;
  activities=[];routes=[];crew=null;trainingState={activePlanId:null,completed:{}};routeWaypoints=[];planPoints=[];routedDistanceMeters=0;
  persist();
  localStorage.removeItem(KEYS.c);localStorage.removeItem(TRAINING_KEY);localStorage.removeItem(KEYS.h);localStorage.removeItem(KEYS.f);
  renderHistory();renderStats();renderCrew();renderTrainingPlans();renderPlan();
  toast('All Stride FW data cleared');
}
