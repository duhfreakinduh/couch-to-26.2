const NAV_WARN_METERS = 180;
const NAV_NEAR_METERS = 45;
const NAV_ADVANCE_METERS = 18;
const NAV_OFF_ROUTE_WALK = 45;
const NAV_OFF_ROUTE_RIDE = 70;

let navMap = null;
let navRouteLine = null;
let navUserMarker = null;
let navWatchId = null;
let navRoute = null;
let navSteps = [];
let navStepIndex = 0;
let navGeometry = [];
let navCumulative = [];
let navTotalMeters = 0;
let navMuted = false;
let navSpoken = new Map();
let navLastOffRouteSpokenAt = 0;
let navLoading = false;

function navRouteServer(profile) {
  return `https://routing.openstreetmap.de/routed-${profile === 'ride' ? 'bike' : 'foot'}/route/v1/driving/`;
}

function navSourcePoints(route) {
  if (Array.isArray(route.waypoints) && route.waypoints.length >= 2) return route.waypoints.map(p => [Number(p[0]), Number(p[1])]);
  const coords = Array.isArray(route.coords) ? route.coords : [];
  if (coords.length < 2) return [];
  const max = Math.min(20, coords.length);
  const step = (coords.length - 1) / Math.max(1, max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]).map(p => [Number(p[0]), Number(p[1])]);
}

function currentRouteForNavigation() {
  const points = (typeof routeWaypoints !== 'undefined' && routeWaypoints.length >= 2)
    ? routeWaypoints.map(p => [p[0], p[1]])
    : navSourcePoints({ coords: planPoints });
  return {
    name: routeName.value.trim() || `${typeof routeLabel === 'function' ? routeLabel() : 'Route'} navigation`,
    profile: typeof routeMode !== 'undefined' ? routeMode : 'walk',
    waypoints: points,
    coords: planPoints.map(p => [p[0], p[1]])
  };
}

async function guideCurrentRoute() {
  const route = currentRouteForNavigation();
  if (route.waypoints.length < 2) {
    toast('Make a route with at least two stops first');
    return;
  }
  await startRouteNavigation(route);
}

async function guideSavedRoute(index) {
  const route = routes[index];
  if (!route) return;
  await startRouteNavigation(route);
}

async function startRouteNavigation(route) {
  if (navLoading) return;
  const points = navSourcePoints(route);
  if (points.length < 2) {
    toast('This route does not have enough path data to navigate');
    return;
  }
  if (!navigator.geolocation) {
    toast('GPS is required for navigation');
    return;
  }

  navLoading = true;
  navMuted = settings.voice === false;
  showNavigationScreen();
  document.getElementById('navMuteBtn').textContent = navMuted ? '🔇 Voice off' : '🔊 Voice on';
  document.getElementById('navStopBtn').textContent = '■ Stop navigation';
  document.getElementById('navTurnDistance').textContent = '—';
  document.getElementById('navOffRoute').classList.remove('show');
  setNavInstruction('Building turn-by-turn directions…', 'Please wait');
  document.getElementById('navRouteName').textContent = route.name || 'Route';

  try {
    const coords = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const url = `${navRouteServer(route.profile || 'walk')}${coords}?overview=full&geometries=geojson&steps=true&alternatives=false&generate_hints=false`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Routing error ${response.status}`);
    const data = await response.json();
    const result = data.routes?.[0];
    if (data.code !== 'Ok' || !result?.geometry?.coordinates?.length) throw new Error(data.message || 'No route found');

    navRoute = { ...route, profile: route.profile || 'walk' };
    navGeometry = result.geometry.coordinates.map(p => [p[1], p[0]]);
    navSteps = (result.legs || []).flatMap(leg => leg.steps || []).map((step, index) => ({
      ...step,
      _index: index,
      _latlng: step.maneuver?.location ? [step.maneuver.location[1], step.maneuver.location[0]] : null
    })).filter(step => step._latlng);
    navStepIndex = navSteps[0]?.maneuver?.type === 'depart' ? Math.min(1, navSteps.length - 1) : 0;
    navSpoken = new Map();
    navTotalMeters = Number(result.distance) || routeDistance(navGeometry);
    navCumulative = cumulativeDistances(navGeometry);
    drawNavigationRoute();
    updateNavSummary(navTotalMeters);
    const first = currentNavStep();
    setNavInstruction(first ? instructionForStep(first) : 'Follow the highlighted route', first ? 'Starting navigation' : 'GPS guidance active');
    speakNav(`Navigation started. ${first ? instructionForStep(first) : 'Follow the highlighted route.'}`);
    startNavigationGps();
    if (settings.wake) requestWakeLock();
  } catch (error) {
    setNavInstruction('Could not build turn-by-turn directions', 'Return to Route and try again');
    toast(error.message || 'Navigation setup failed');
  } finally {
    navLoading = false;
  }
}

function showNavigationScreen() {
  document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.navBtn').forEach(x => x.classList.remove('active'));
  document.getElementById('screen-navigate').classList.add('active');
  if (!navMap) {
    navMap = L.map('navMap', { zoomControl: false }).setView([32.7555, -97.3308], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(navMap);
  }
  setTimeout(() => navMap.invalidateSize(), 60);
}

function drawNavigationRoute() {
  if (navRouteLine) navRouteLine.remove();
  navRouteLine = L.polyline(navGeometry, { color: '#2563eb', weight: 8, opacity: .95, lineJoin: 'round' }).addTo(navMap);
  navMap.fitBounds(navRouteLine.getBounds(), { padding: [30, 30] });
}

function startNavigationGps() {
  if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);
  navWatchId = navigator.geolocation.watchPosition(updateNavigationPosition, error => {
    document.getElementById('navGpsState').textContent = 'GPS problem';
    toast(error.message || 'Navigation GPS error');
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}

function updateNavigationPosition(position) {
  if (!navRoute || !navMap || !navGeometry.length) return;
  const point = [position.coords.latitude, position.coords.longitude];
  const accuracy = Number(position.coords.accuracy) || 0;
  document.getElementById('navGpsState').textContent = accuracy ? `GPS ±${Math.round(accuracy)} m` : 'GPS on';

  if (!navUserMarker) {
    navUserMarker = L.circleMarker(point, { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(navMap);
  } else navUserMarker.setLatLng(point);
  navMap.setView(point, Math.max(navMap.getZoom(), 17), { animate: true });

  const nearest = nearestGeometryPoint(point);
  const remaining = Math.max(0, navTotalMeters - (navCumulative[nearest.index] || 0));
  updateNavSummary(remaining);

  const offLimit = navRoute.profile === 'ride' ? NAV_OFF_ROUTE_RIDE : NAV_OFF_ROUTE_WALK;
  const offRoute = nearest.distance > offLimit;
  document.getElementById('navOffRoute').classList.toggle('show', offRoute);
  if (offRoute && Date.now() - navLastOffRouteSpokenAt > 20000) {
    navLastOffRouteSpokenAt = Date.now();
    speakNav('You are off the planned route. Return to the highlighted path.');
  }

  advancePastReachedSteps(point, nearest.index);
  const step = currentNavStep();
  if (!step) {
    setNavInstruction('Route complete', 'Nice work');
    speakNav('You have arrived. Route complete.');
    stopRouteNavigation(true);
    return;
  }

  const turnDistance = navMap.distance(point, step._latlng);
  const instruction = instructionForStep(step);
  document.getElementById('navTurnDistance').textContent = formatNavDistance(turnDistance);
  setNavInstruction(instruction, `${formatNavDistance(turnDistance)} to next instruction`);
  maybeSpeakTurn(step, turnDistance);
}

function advancePastReachedSteps(point, routeIndex) {
  let step = currentNavStep();
  while (step) {
    const distance = navMap.distance(point, step._latlng);
    const maneuverIndex = nearestIndexForLatLng(step._latlng);
    if (distance <= NAV_ADVANCE_METERS || routeIndex > maneuverIndex + 3) {
      navStepIndex += 1;
      step = currentNavStep();
      continue;
    }
    break;
  }
}

function currentNavStep() {
  return navSteps[navStepIndex] || null;
}

function maybeSpeakTurn(step, meters) {
  if (navMuted) return;
  const state = navSpoken.get(navStepIndex) || { far: false, near: false };
  if (meters <= NAV_WARN_METERS && !state.far) {
    state.far = true;
    speakNav(`In ${speakDistance(meters)}, ${instructionForStep(step)}.`);
  }
  if (meters <= NAV_NEAR_METERS && !state.near) {
    state.near = true;
    speakNav(instructionForStep(step));
  }
  navSpoken.set(navStepIndex, state);
}

function instructionForStep(step) {
  const maneuver = step.maneuver || {};
  const type = String(maneuver.type || 'turn').toLowerCase();
  const modifier = String(maneuver.modifier || '').toLowerCase();
  const road = step.name ? ` onto ${step.name}` : '';
  const direction = modifier.replace(/_/g, ' ');

  if (type === 'arrive') return 'You have arrived at your destination';
  if (type === 'depart') return `Start ${direction || 'ahead'}${road}`;
  if (type === 'roundabout' || type === 'rotary') return road ? `Enter the roundabout and continue${road}` : 'Enter the roundabout and continue';
  if (type === 'merge') return `Merge ${direction || 'ahead'}${road}`;
  if (type === 'fork') return `Keep ${direction || 'straight'}${road}`;
  if (type === 'on ramp') return `Take the ramp ${direction}${road}`.replace(/\s+/g, ' ').trim();
  if (type === 'off ramp') return `Take the exit ${direction}${road}`.replace(/\s+/g, ' ').trim();
  if (type === 'end of road') return `At the end of the road, turn ${direction || 'ahead'}${road}`;
  if (type === 'new name') return road ? `Continue${road}` : 'Continue ahead';
  if (type === 'continue') return direction && direction !== 'straight' ? `Continue ${direction}${road}` : `Continue straight${road}`;
  if (modifier.includes('left')) return `Turn ${direction}${road}`;
  if (modifier.includes('right')) return `Turn ${direction}${road}`;
  if (modifier === 'uturn' || modifier === 'u-turn') return `Make a U-turn${road}`;
  return road ? `Continue${road}` : 'Continue ahead';
}

function setNavInstruction(main, sub) {
  document.getElementById('navInstruction').textContent = main;
  document.getElementById('navInstructionSub').textContent = sub || '';
}

function updateNavSummary(remainingMeters) {
  document.getElementById('navRemaining').textContent = formatNavDistance(remainingMeters);
  document.getElementById('navProgress').textContent = navTotalMeters > 0 ? `${Math.min(100, Math.max(0, Math.round((1 - remainingMeters / navTotalMeters) * 100)))}%` : '0%';
}

function formatNavDistance(meters) {
  meters = Math.max(0, Number(meters) || 0);
  if (settings.units === 'km') return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
  const feet = meters * 3.28084;
  return feet < 1000 ? `${Math.round(feet)} ft` : `${(meters * MI_PER_M).toFixed(2)} mi`;
}

function speakDistance(meters) {
  meters = Math.max(0, Number(meters) || 0);
  if (settings.units === 'km') return meters < 1000 ? `${Math.round(meters / 10) * 10} meters` : `${(meters / 1000).toFixed(1)} kilometers`;
  const feet = meters * 3.28084;
  return feet < 1000 ? `${Math.max(20, Math.round(feet / 25) * 25)} feet` : `${(meters * MI_PER_M).toFixed(1)} miles`;
}

function speakNav(text) {
  if (navMuted || !('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  speechSynthesis.speak(utterance);
}

function toggleNavMute() {
  navMuted = !navMuted;
  document.getElementById('navMuteBtn').textContent = navMuted ? '🔇 Voice off' : '🔊 Voice on';
  if (navMuted && 'speechSynthesis' in window) speechSynthesis.cancel();
  else speakNav('Voice guidance on');
}

function recenterNavigation() {
  if (navUserMarker) navMap.setView(navUserMarker.getLatLng(), 17, { animate: true });
  else if (navRouteLine) navMap.fitBounds(navRouteLine.getBounds(), { padding: [30, 30] });
}

function stopRouteNavigation(arrived = false) {
  if (navWatchId !== null) navigator.geolocation.clearWatch(navWatchId);
  navWatchId = null;
  releaseWakeLock();
  if (arrived) {
    document.getElementById('navStopBtn').textContent = 'Done';
    return;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  navRoute = null;
  showScreen('plan');
}

function routeDistance(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += L.latLng(coords[i - 1]).distanceTo(L.latLng(coords[i]));
  return total;
}

function cumulativeDistances(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + L.latLng(coords[i - 1]).distanceTo(L.latLng(coords[i])));
  return out;
}

function nearestGeometryPoint(point) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < navGeometry.length; i++) {
    const distance = navMap.distance(point, navGeometry[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

function nearestIndexForLatLng(latlng) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < navGeometry.length; i++) {
    const distance = navMap.distance(latlng, navGeometry[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function decorateHistoryGuideButtons() {
  document.querySelectorAll('#historyList .historyItem').forEach(item => {
    const useButton = Array.from(item.querySelectorAll('button')).find(button => /^loadRoute\(\d+\)$/.test((button.getAttribute('onclick') || '').replace(/\s/g, '')));
    if (!useButton) return;
    const actions = useButton.closest('.smallActions');
    if (!actions || actions.querySelector('.navGuideBtn')) return;
    const match = (useButton.getAttribute('onclick') || '').match(/loadRoute\((\d+)\)/);
    if (!match) return;
    const button = document.createElement('button');
    button.className = 'btn navGuideBtn';
    button.textContent = '▶ Guide';
    button.onclick = () => guideSavedRoute(Number(match[1]));
    actions.insertBefore(button, actions.firstChild);
  });
}

// Health integrations were removed from the UI in build 5; keep old cached app code from touching missing health elements.
if (typeof renderHealth === 'function') renderHealth = function () {};

const strideBaseRenderHistory = renderHistory;
renderHistory = function () {
  strideBaseRenderHistory();
  decorateHistoryGuideButtons();
};

window.addEventListener('load', () => {
  decorateHistoryGuideButtons();
});
