const MI_PER_M = 0.000621371;
const KM_PER_M = 0.001;
const KEYS = {
  a: 'stridefw.activities.v1',
  r: 'stridefw.routes.v1',
  s: 'stridefw.settings.v1',
  c: 'stridefw.crew.v1',
  h: 'stridefw.health.summary.v1',
  f: 'stridefw.fitbit.summary.v1'
};

// Set this to the secure Stride FW backend URL when cloud sync is deployed.
// Google Health OAuth tokens and Crew live-location data must never be stored in public GitHub Pages code.
const HEALTH_BACKEND = '';

let map, planMap, userMarker, accuracyCircle, trackLine, planLine, shownLayer;
let watchId = null, lastPosition = null, gpsReady = false;
let activityType = 'Run', recording = false, paused = false, startedAt = null;
let pauseAt = null, pausedMs = 0, timerId = null, wakeLock = null, lastAnnounced = 0;
let trackPoints = [], planPoints = [], planMarkers = [], historyFilter = 'all';
let activities = loadArray(KEYS.a), routes = loadArray(KEYS.r), settings = loadSettings();
let crew = loadObject(KEYS.c, null);
let healthSummary = loadObject(KEYS.h, null) || loadObject(KEYS.f, null);

function loadArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadObject(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadSettings() {
  try {
    return {
      units: 'mi', voice: true, wake: true, follow: true, theme: 'light',
      ...JSON.parse(localStorage.getItem(KEYS.s) || '{}')
    };
  } catch {
    return { units: 'mi', voice: true, wake: true, follow: true, theme: 'light' };
  }
}

function migrate() {
  if (!activities.length) {
    const old = loadArray('runfw.activities.v2');
    if (old.length) activities = old;
  }
  if (!routes.length) {
    const old = loadArray('runfw.routes.v2');
    if (old.length) routes = old;
  }
  if (healthSummary && !localStorage.getItem(KEYS.h)) {
    localStorage.setItem(KEYS.h, JSON.stringify(healthSummary));
  }
  persist();
}

function persist() {
  localStorage.setItem(KEYS.a, JSON.stringify(activities));
  localStorage.setItem(KEYS.r, JSON.stringify(routes));
}

function saveSettings() {
  settings.voice = voiceToggle.checked;
  settings.wake = wakeToggle.checked;
  settings.follow = followToggle.checked;
  localStorage.setItem(KEYS.s, JSON.stringify(settings));
}

function applySettings() {
  unitsSelect.value = settings.units;
  voiceToggle.checked = settings.voice;
  wakeToggle.checked = settings.wake;
  followToggle.checked = settings.follow;
  document.body.classList.toggle('dark', settings.theme === 'dark');
  unitLabels();
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(KEYS.s, JSON.stringify(settings));
  document.body.classList.toggle('dark', settings.theme === 'dark');
}

function changeUnits(value) {
  settings.units = value === 'km' ? 'km' : 'mi';
  localStorage.setItem(KEYS.s, JSON.stringify(settings));
  unitLabels();
  updateTrack();
  renderPlan();
  renderHistory();
  renderStats();
}

function unitLabels() {
  distanceLabel.textContent = settings.units === 'km' ? 'Kilometers' : 'Miles';
  paceLabel.textContent = settings.units === 'km' ? 'Pace / km' : 'Pace / mi';
}

function initMaps() {
  map = L.map('map', { zoomControl: false }).setView([32.7555, -97.3308], 13);
  planMap = L.map('planMap', { zoomControl: false }).setView([32.7555, -97.3308], 13);
  const url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const options = { maxZoom: 19, attribution: '&copy; OpenStreetMap' };
  L.tileLayer(url, options).addTo(map);
  L.tileLayer(url, options).addTo(planMap);
  planMap.on('click', event => {
    planPoints.push([event.latlng.lat, event.latlng.lng]);
    renderPlan();
  });
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.navBtn').forEach(x => x.classList.remove('active'));
  const screen = document.getElementById('screen-' + name);
  if (!screen) return;
  screen.classList.add('active');
  const nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');
  if (name === 'plan') setTimeout(() => planMap.invalidateSize(), 50);
  if (name === 'track') setTimeout(() => map.invalidateSize(), 50);
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
  if (name === 'crew') renderCrew();
  if (name === 'more') renderHealth();
}

function setActivityType(type) {
  if (recording) return;
  activityType = type;
  document.querySelectorAll('.typeBtn').forEach(button => button.classList.toggle('active', button.dataset.type === type));
}

function enableGPS() {
  if (!navigator.geolocation) {
    toast('GPS is not supported here');
    return;
  }
  gpsBtn.disabled = true;
  mapStatus.textContent = 'Requesting precise location…';
  if (watchId !== null) {
    gpsReady = true;
    startBtn.disabled = false;
    return;
  }
  watchId = navigator.geolocation.watchPosition(handlePosition, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
}

function handlePosition(position) {
  const point = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    timestamp: position.timestamp || Date.now()
  };
  lastPosition = point;
  gpsReady = true;
  gpsBtn.textContent = '✓ GPS ready';
  gpsBtn.disabled = true;
  startBtn.disabled = recording;
  gpsBadge.textContent = point.accuracy ? `±${Math.round(point.accuracy)} m` : 'GPS on';
  const latlng = [point.lat, point.lng];

  if (!userMarker) {
    userMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latlng, { radius: point.accuracy || 10, color: '#2563eb', weight: 1, opacity: .3, fillColor: '#2563eb', fillOpacity: .08 }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latlng).setRadius(point.accuracy || 10);
  }

  if (settings.follow) map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true });
  mapStatus.textContent = recording ? (paused ? 'Paused' : 'Recording live') : 'GPS ready — press START';

  if (recording && !paused && shouldRecord(point)) {
    trackPoints.push(point);
    drawTrack();
    updateTrack();
    announceIfNeeded();
  }
}

function handleGpsError(error) {
  gpsReady = false;
  gpsBtn.disabled = false;
  gpsBtn.textContent = '📍 Turn on GPS';
  startBtn.disabled = true;
  mapStatus.textContent = 'GPS unavailable — check permission';
  toast(error.message || 'GPS error');
}

function shouldRecord(point) {
  if (point.accuracy && point.accuracy > 70) return false;
  if (!trackPoints.length) return true;
  const previous = trackPoints[trackPoints.length - 1];
  const meters = map.distance([previous.lat, previous.lng], [point.lat, point.lng]);
  const seconds = Math.max(1, (point.timestamp - previous.timestamp) / 1000);
  return meters >= 2 && meters / seconds <= 18;
}

async function startActivity() {
  if (!gpsReady || !lastPosition) {
    enableGPS();
    return;
  }
  recording = true;
  paused = false;
  startedAt = Date.now();
  pauseAt = null;
  pausedMs = 0;
  lastAnnounced = 0;
  trackPoints = [{ ...lastPosition, timestamp: Date.now() }];
  clearShown();
  drawTrack();
  updateTrack();
  startWrap.classList.add('hidden');
  recordControls.classList.remove('hidden');
  document.querySelectorAll('.typeBtn').forEach(button => button.disabled = true);
  goalInput.disabled = true;
  mapStatus.textContent = 'Recording live';
  timerId = setInterval(updateTrack, 1000);
  if (settings.wake) await requestWakeLock();
}

function togglePause() {
  if (!recording) return;
  paused = !paused;
  if (paused) {
    pauseAt = Date.now();
    pauseBtn.textContent = '▶ Resume';
    mapStatus.textContent = 'Paused';
  } else {
    if (pauseAt) pausedMs += Date.now() - pauseAt;
    pauseAt = null;
    pauseBtn.textContent = 'Ⅱ Pause';
    mapStatus.textContent = 'Recording live';
  }
  updateTrack();
}

function finishActivity() {
  if (!recording) return;
  if (paused && pauseAt) {
    pausedMs += Date.now() - pauseAt;
    pauseAt = null;
  }
  const seconds = Math.round(elapsedMs() / 1000);
  const miles = trackMeters() * MI_PER_M;
  const defaultName = `${activityType} — ${new Date().toLocaleDateString()}`;
  const name = prompt('Name this activity', defaultName) || defaultName;
  activities.unshift({
    id: Date.now(),
    name,
    type: activityType,
    date: new Date().toISOString(),
    distanceMiles: round(miles, 3),
    elapsedSeconds: seconds,
    paceSecondsPerMile: miles > .02 ? Math.round(seconds / miles) : null,
    coords: trackPoints.map(point => [round(point.lat, 6), round(point.lng, 6)])
  });
  persist();
  recording = false;
  paused = false;
  clearInterval(timerId);
  timerId = null;
  releaseWakeLock();
  startWrap.classList.remove('hidden');
  startBtn.disabled = !gpsReady;
  recordControls.classList.add('hidden');
  pauseBtn.textContent = 'Ⅱ Pause';
  document.querySelectorAll('.typeBtn').forEach(button => button.disabled = false);
  goalInput.disabled = false;
  mapStatus.textContent = 'Saved — nice work';
  toast('Activity saved');
  renderHistory();
  renderStats();
}

function elapsedMs() {
  if (!startedAt) return 0;
  const currentPause = paused && pauseAt ? Date.now() - pauseAt : 0;
  return Math.max(0, Date.now() - startedAt - pausedMs - currentPause);
}

function trackMeters() {
  return pathMeters(trackPoints.map(point => [point.lat, point.lng]), map);
}

function drawTrack() {
  if (trackLine) trackLine.remove();
  if (trackPoints.length) trackLine = L.polyline(trackPoints.map(point => [point.lat, point.lng]), { color: '#ff5a1f', weight: 6, opacity: .95, lineJoin: 'round' }).addTo(map);
}

function updateTrack() {
  const meters = trackMeters();
  const seconds = Math.round(elapsedMs() / 1000);
  const distance = displayMeters(meters);
  distanceMetric.textContent = distance.toFixed(2);
  timeMetric.textContent = formatDuration(seconds);
  paceMetric.textContent = meters > 25 ? formatPace(settings.units === 'km' ? seconds / (meters * KM_PER_M) : seconds / (meters * MI_PER_M)) : '--:--';
  const goal = Number(goalInput.value || 0);
  if (goal > 0 && distance >= goal && recording) mapStatus.textContent = 'Goal reached — great job!';
}

function announceIfNeeded() {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  const distance = displayMeters(trackMeters());
  const whole = Math.floor(distance);
  if (whole > lastAnnounced && whole > 0) {
    lastAnnounced = whole;
    const unit = settings.units === 'km' ? 'kilometer' : 'mile';
    speechSynthesis.speak(new SpeechSynthesisUtterance(`${whole} ${unit}${whole === 1 ? '' : 's'}. Pace ${paceMetric.textContent}.`));
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch {}
  wakeLock = null;
}

function centerOnMe() {
  if (lastPosition) map.setView([lastPosition.lat, lastPosition.lng], 17, { animate: true });
  else enableGPS();
}

function fitActive() {
  const layer = trackLine || shownLayer;
  if (layer) map.fitBounds(layer.getBounds(), { padding: [24, 24] });
  else centerOnMe();
}

function clearShown() {
  if (shownLayer) {
    shownLayer.remove();
    shownLayer = null;
  }
}

function planCenterOnMe() {
  if (lastPosition) planMap.setView([lastPosition.lat, lastPosition.lng], 16, { animate: true });
  else enableGPS();
}

function addMyLocationToPlan() {
  if (!lastPosition) {
    enableGPS();
    toast('Turn on GPS first');
    return;
  }
  planPoints.push([lastPosition.lat, lastPosition.lng]);
  renderPlan();
}

function undoPlan() { planPoints.pop(); renderPlan(); }
function reversePlan() { planPoints.reverse(); renderPlan(); }

function closePlan() {
  if (planPoints.length < 3) return;
  if (planMap.distance(planPoints[0], planPoints[planPoints.length - 1]) > 3) planPoints.push([...planPoints[0]]);
  renderPlan();
}

function clearPlan() {
  planPoints = [];
  routeName.value = '';
  renderPlan();
}

function renderPlan() {
  if (planLine) planLine.remove();
  planMarkers.forEach(marker => marker.remove());
  planMarkers = [];
  if (planPoints.length) {
    planLine = L.polyline(planPoints, { color: '#16a34a', weight: 6, opacity: .95, lineJoin: 'round' }).addTo(planMap);
    planPoints.forEach((point, index) => planMarkers.push(L.circleMarker(point, {
      radius: index === 0 ? 7 : 5,
      color: '#fff', weight: 2,
      fillColor: index === 0 ? '#16a34a' : '#111827', fillOpacity: 1
    }).addTo(planMap)));
  }
  const meters = pathMeters(planPoints, planMap);
  planDistance.textContent = `${displayMeters(meters).toFixed(2)} ${settings.units}`;
  planPointsCount.textContent = planPoints.length;
  planBadge.textContent = `${planPoints.length} point${planPoints.length === 1 ? '' : 's'}`;
}

function savePlan() {
  if (planPoints.length < 2) {
    toast('Add at least two points');
    return;
  }
  const miles = pathMeters(planPoints, planMap) * MI_PER_M;
  const name = routeName.value.trim() || `Route — ${displayMiles(miles).toFixed(1)} ${settings.units}`;
  routes.unshift({ id: Date.now(), name, date: new Date().toISOString(), distanceMiles: round(miles, 3), coords: planPoints.map(point => [round(point[0], 6), round(point[1], 6)]) });
  persist();
  routeName.value = '';
  toast('Route saved');
  renderHistory();
}

function fitPlan() {
  if (planLine) planMap.fitBounds(planLine.getBounds(), { padding: [24, 24] });
  else planCenterOnMe();
}

function setHistoryFilter(filter, button) {
  historyFilter = filter;
  document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
  button.classList.add('active');
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  const rows = [];
  activities.forEach((activity, index) => {
    if (historyFilter === 'all' || historyFilter === activity.type) rows.push({ kind: 'activity', index, date: new Date(activity.date), data: activity });
  });
  routes.forEach((route, index) => {
    if (historyFilter === 'all' || historyFilter === 'Route') rows.push({ kind: 'route', index, date: new Date(route.date), data: route });
  });
  rows.sort((a, b) => b.date - a.date);

  if (!rows.length) {
    historyList.innerHTML = '<div class="panel hint">Nothing here yet. Track an activity or save a route.</div>';
    return;
  }

  rows.forEach(row => {
    const element = document.createElement('div');
    element.className = 'historyItem';
    if (row.kind === 'activity') {
      const activity = row.data;
      const distance = displayMiles(Number(activity.distanceMiles || 0));
      const pace = activity.paceSecondsPerMile ? convertPace(activity.paceSecondsPerMile) : null;
      element.innerHTML = `<div class="historyTop"><div><div class="historyTitle">${esc(activity.name)}</div><div class="historyMeta">${esc(activity.type || 'Activity')} • ${new Date(activity.date).toLocaleString()}</div></div></div><div class="miniMetrics"><div class="mini"><b>${distance.toFixed(2)}</b><span>${settings.units}</span></div><div class="mini"><b>${formatDuration(activity.elapsedSeconds || 0)}</b><span>Time</span></div><div class="mini"><b>${pace ? formatPace(pace) : '--:--'}</b><span>Pace</span></div></div><div class="smallActions"><button class="btn secondary" onclick="showActivity(${row.index})">Map</button><button class="btn shareWide" onclick="shareActivity(${row.index})">Share</button><button class="btn danger" onclick="deleteActivity(${row.index})">Delete</button></div>`;
    } else {
      const route = row.data;
      const distance = displayMiles(Number(route.distanceMiles || 0));
      element.innerHTML = `<div class="historyTop"><div><div class="historyTitle">${esc(route.name)}</div><div class="historyMeta">Saved route • ${new Date(route.date).toLocaleDateString()}</div></div></div><div class="miniMetrics"><div class="mini"><b>${distance.toFixed(2)}</b><span>${settings.units}</span></div><div class="mini"><b>${(route.coords || []).length}</b><span>Points</span></div><div class="mini"><b>Route</b><span>Type</span></div></div><div class="smallActions"><button class="btn secondary" onclick="loadRoute(${row.index})">Use</button><button class="btn shareWide" onclick="shareRoute(${row.index})">Share</button><button class="btn danger" onclick="deleteRoute(${row.index})">Delete</button></div>`;
    }
    historyList.appendChild(element);
  });
}

function showActivity(index) {
  const activity = activities[index];
  if (!activity || !activity.coords?.length) return;
  showScreen('track');
  clearShown();
  shownLayer = L.polyline(activity.coords, { color: '#7c3aed', weight: 6, opacity: .9 }).addTo(map);
  map.fitBounds(shownLayer.getBounds(), { padding: [24, 24] });
  mapStatus.textContent = activity.name;
}

function loadRoute(index) {
  const route = routes[index];
  if (!route) return;
  planPoints = (route.coords || []).map(point => [point[0], point[1]]);
  routeName.value = route.name;
  showScreen('plan');
  renderPlan();
  setTimeout(fitPlan, 70);
}

function deleteActivity(index) {
  if (confirm('Delete this activity?')) {
    activities.splice(index, 1);
    persist();
    renderHistory();
    renderStats();
  }
}

function deleteRoute(index) {
  if (confirm('Delete this route?')) {
    routes.splice(index, 1);
    persist();
    renderHistory();
  }
}

function renderStats() {
  const now = Date.now(), day = 86400000;
  const sum = days => activities.filter(activity => now - new Date(activity.date).getTime() <= days * day).reduce((total, activity) => total + Number(activity.distanceMiles || 0), 0);
  const total = activities.reduce((value, activity) => value + Number(activity.distanceMiles || 0), 0);
  const longest = activities.reduce((value, activity) => Math.max(value, Number(activity.distanceMiles || 0)), 0);
  const runs = activities.filter(activity => activity.type === 'Run' && activity.paceSecondsPerMile);
  const average = runs.length ? runs.reduce((value, activity) => value + Number(activity.paceSecondsPerMile || 0), 0) / runs.length : null;
  stat7.textContent = displayMiles(sum(7)).toFixed(1) + ' ' + settings.units;
  stat30.textContent = displayMiles(sum(30)).toFixed(1) + ' ' + settings.units;
  statTotal.textContent = displayMiles(total).toFixed(1) + ' ' + settings.units;
  statCount.textContent = activities.length;
  statLongest.textContent = displayMiles(longest).toFixed(1) + ' ' + settings.units;
  statPace.textContent = average ? formatPace(convertPace(average)) : '--:--';
}

async function sharePayload(data) {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }
  }
  const value = data.url || `${data.title || ''}\n${data.text || ''}`.trim();
  try {
    await navigator.clipboard.writeText(value);
    toast('Copied to clipboard');
    return true;
  } catch {
    prompt('Copy this', value);
    return true;
  }
}

function cleanBaseUrl() { return location.origin + location.pathname; }
function shareApp() { sharePayload({ title: 'Stride FW', text: 'Track runs, plan routes and train with me on Stride FW.', url: cleanBaseUrl() }); }

function shareCoords(coords, maxPoints = 120) {
  const list = Array.isArray(coords) ? coords : [];
  if (list.length <= maxPoints) return list;
  const step = (list.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => list[Math.round(index * step)]);
}

function routeShareUrl(route) {
  const payload = { v: 2, type: 'route', name: route.name || 'Shared route', coords: shareCoords(route.coords || []), distanceMiles: Number(route.distanceMiles || 0) };
  return cleanBaseUrl() + '#share=' + encodeShare(payload);
}

function activityShareUrl(activity) {
  const payload = {
    v: 2,
    type: 'activity',
    name: activity.name || 'Shared activity',
    activityType: activity.type || 'Activity',
    coords: shareCoords(activity.coords || []),
    distanceMiles: Number(activity.distanceMiles || 0),
    elapsedSeconds: Number(activity.elapsedSeconds || 0),
    paceSecondsPerMile: activity.paceSecondsPerMile ? Number(activity.paceSecondsPerMile) : null
  };
  return cleanBaseUrl() + '#share=' + encodeShare(payload);
}

function shareRoute(index) {
  const route = routes[index];
  if (!route) return;
  sharePayload({ title: route.name || 'Stride FW route', text: `${route.name || 'Route'} • ${displayMiles(Number(route.distanceMiles || 0)).toFixed(2)} ${settings.units}`, url: routeShareUrl(route) });
}

function shareCurrentPlan() {
  if (planPoints.length < 2) {
    toast('Add at least two route points first');
    return;
  }
  const miles = pathMeters(planPoints, planMap) * MI_PER_M;
  const route = { name: routeName.value.trim() || 'Shared Stride FW route', distanceMiles: miles, coords: planPoints };
  sharePayload({ title: route.name, text: `${displayMiles(miles).toFixed(2)} ${settings.units} route`, url: routeShareUrl(route) });
}

function shareActivity(index) {
  const activity = activities[index];
  if (!activity) return;
  const distance = displayMiles(Number(activity.distanceMiles || 0)).toFixed(2);
  const pace = activity.paceSecondsPerMile ? formatPace(convertPace(activity.paceSecondsPerMile)) : '--:--';
  sharePayload({ title: activity.name || 'Stride FW activity', text: `${activity.type || 'Activity'} • ${distance} ${settings.units} • ${formatDuration(activity.elapsedSeconds || 0)} • pace ${pace}`, url: activityShareUrl(activity) });
}

function encodeShare(object) {
  const bytes = new TextEncoder().encode(JSON.stringify(object));
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(value) {
  try {
    const base = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - base.length % 4) % 4);
    const binary = atob(base + pad);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function importSharedItem() {
  const match = location.hash.match(/(?:^#|&)share=([^&]+)/);
  if (!match) return;
  const data = decodeShare(match[1]);
  if (!data || !Array.isArray(data.coords) || data.coords.length < 2) return;
  const coords = data.coords.map(point => [Number(point[0]), Number(point[1])]).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (coords.length < 2) return;

  if (data.type === 'route') {
    planPoints = coords;
    routeName.value = data.name || 'Shared route';
    showScreen('plan');
    renderPlan();
    setTimeout(fitPlan, 80);
    toast('Shared route loaded');
    return;
  }

  if (data.type === 'activity') {
    showScreen('track');
    clearShown();
    shownLayer = L.polyline(coords, { color: '#7c3aed', weight: 6, opacity: .9 }).addTo(map);
    map.fitBounds(shownLayer.getBounds(), { padding: [24, 24] });
    distanceMetric.textContent = displayMiles(Number(data.distanceMiles || 0)).toFixed(2);
    timeMetric.textContent = formatDuration(data.elapsedSeconds || 0);
    paceMetric.textContent = data.paceSecondsPerMile ? formatPace(convertPace(Number(data.paceSecondsPerMile))) : '--:--';
    mapStatus.textContent = `${data.activityType || 'Activity'} • ${data.name || 'Shared activity'}`;
    toast('Shared activity loaded');
  }
}

function crewCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function normalizeCrewCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

function createCrew() {
  const name = crewNameInput.value.trim() || 'Member';
  const typedCode = normalizeCrewCode(crewCodeInput.value);
  if (typedCode && typedCode.length < 4) {
    toast('Crew codes need at least 4 characters');
    return;
  }
  const code = typedCode || crewCode();
  crew = { code, name, createdAt: new Date().toISOString() };
  localStorage.setItem(KEYS.c, JSON.stringify(crew));
  renderCrew();
  toast('Crew created');
}

function joinCrew() {
  const code = normalizeCrewCode(crewCodeInput.value);
  const name = crewNameInput.value.trim() || 'Member';
  if (code.length < 4) {
    toast('Enter a valid crew code');
    return;
  }
  crew = { code, name, joinedAt: new Date().toISOString() };
  localStorage.setItem(KEYS.c, JSON.stringify(crew));
  renderCrew();
  toast('Crew joined');
}

function renderCrew() {
  if (!crew) {
    crewTitle.textContent = 'No crew yet';
    crewStatus.textContent = 'Create a crew or join one with an invite code.';
    return;
  }
  crewNameInput.value = crew.name || '';
  crewCodeInput.value = crew.code || '';
  crewTitle.textContent = `Crew ${crew.code}`;
  crewStatus.textContent = `You are in this crew as ${crew.name || 'Member'}.`;
}

function shareCrew() {
  if (!crew) {
    toast('Create or join a crew first');
    return;
  }
  const url = cleanBaseUrl() + '#crew=' + encodeURIComponent(crew.code);
  sharePayload({ title: `Stride FW Crew ${crew.code}`, text: `Join my Stride FW crew. Crew code: ${crew.code}`, url });
}

function shareMySpot() {
  if (!crew) {
    toast('Create or join a crew first');
    return;
  }
  if (!lastPosition) {
    enableGPS();
    toast('Turn on GPS, then tap Share my spot again');
    return;
  }
  const lat = Number(lastPosition.lat).toFixed(6);
  const lng = Number(lastPosition.lng).toFixed(6);
  const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  sharePayload({ title: `My location • Crew ${crew.code}`, text: `${crew.name || 'Crew member'} shared a one-time location with Crew ${crew.code}.`, url });
}

function importCrewInvite() {
  const match = location.hash.match(/(?:^#|&)crew=([^&]+)/);
  if (!match) return;
  const code = normalizeCrewCode(decodeURIComponent(match[1]));
  if (code.length < 4) return;
  showScreen('crew');
  crewCodeInput.value = code;
  toast(`Crew invite ${code} ready`);
}

function leaveCrew() {
  if (!crew) return;
  if (confirm('Leave this crew on this device?')) {
    crew = null;
    localStorage.removeItem(KEYS.c);
    crewCodeInput.value = '';
    renderCrew();
    toast('Crew left');
  }
}

function renderHealth() {
  if (!healthSummary) {
    healthStatus.textContent = HEALTH_BACKEND ? 'Ready to connect' : 'Backend needed';
    healthSteps.textContent = '—';
    healthHeart.textContent = '—';
    healthSleep.textContent = '—';
    healthSpO2.textContent = '—';
    healthHRV.textContent = '—';
    healthVO2.textContent = '—';
    return;
  }
  healthStatus.textContent = healthSummary.connected ? 'Connected' : 'Saved data';
  healthSteps.textContent = healthSummary.steps ?? '—';
  healthHeart.textContent = healthSummary.restingHeartRate ? `${healthSummary.restingHeartRate} bpm` : '—';
  healthSleep.textContent = healthSummary.sleepMinutes ? formatSleep(healthSummary.sleepMinutes) : '—';
  healthSpO2.textContent = healthSummary.spo2 ? `${healthSummary.spo2}%` : '—';
  healthHRV.textContent = healthSummary.hrvRmssd ? `${healthSummary.hrvRmssd} ms` : (healthSummary.hrv ? `${healthSummary.hrv} ms` : '—');
  healthVO2.textContent = healthSummary.vo2Max ? String(healthSummary.vo2Max) : '—';
}

function formatSleep(minutes) {
  const hours = Math.floor(Number(minutes) / 60);
  const remainder = Math.round(Number(minutes) % 60);
  return `${hours}h ${remainder}m`;
}

function startHealthConnect() {
  if (!HEALTH_BACKEND) {
    toast('Google Health secure sync backend is not connected yet');
    return;
  }
  location.href = HEALTH_BACKEND.replace(/\/$/, '') + '/health/login?return=' + encodeURIComponent(location.href);
}

async function refreshHealth() {
  if (!HEALTH_BACKEND) {
    renderHealth();
    toast('Google Health backend is not connected yet');
    return;
  }
  try {
    healthStatus.textContent = 'Syncing…';
    const response = await fetch(HEALTH_BACKEND.replace(/\/$/, '') + '/health/summary', { credentials: 'include' });
    if (!response.ok) throw new Error('Sync failed');
    healthSummary = await response.json();
    localStorage.setItem(KEYS.h, JSON.stringify(healthSummary));
    renderHealth();
    toast('Health data updated');
  } catch (error) {
    healthStatus.textContent = 'Sync error';
    toast(error.message || 'Health sync failed');
  }
}

// Backward-compatible aliases for any cached build-3 markup.
function startFitbitConnect() { startHealthConnect(); }
function refreshFitbit() { refreshHealth(); }
function renderFitbit() { renderHealth(); }

function exportData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), activities, routes, settings, crew, healthSummary }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stride-fw-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clearAllData() {
  if (confirm('Delete every saved activity, route, crew and cached health summary?')) {
    activities = [];
    routes = [];
    crew = null;
    healthSummary = null;
    persist();
    localStorage.removeItem(KEYS.c);
    localStorage.removeItem(KEYS.h);
    localStorage.removeItem(KEYS.f);
    renderHistory();
    renderStats();
    renderCrew();
    renderHealth();
    toast('Data cleared');
  }
}

function pathMeters(points, leafletMap) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += leafletMap.distance(points[index - 1], points[index]);
  return total;
}

function displayMeters(meters) { return settings.units === 'km' ? meters * KM_PER_M : meters * MI_PER_M; }
function displayMiles(miles) { return settings.units === 'km' ? miles * 1.609344 : miles; }
function convertPace(secondsPerMile) { return settings.units === 'km' ? secondsPerMile / 1.609344 : secondsPerMile; }

function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), remainder = seconds % 60;
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatPace(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('show');
  clearTimeout(toastBox._t);
  toastBox._t = setTimeout(() => toastBox.classList.remove('show'), 1800);
}

window.addEventListener('load', () => {
  migrate();
  applySettings();
  initMaps();
  renderPlan();
  renderHistory();
  renderStats();
  renderCrew();
  renderHealth();
  updateTrack();
  importSharedItem();
  importCrewInvite();
});