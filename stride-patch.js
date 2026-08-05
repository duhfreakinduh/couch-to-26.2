/* Stride FW — reliability patch (2026.07.29)
 *
 * Load this LAST, after navigation.js. It overrides broken functions in place,
 * the same way plans-storage.js already overrides app.js. No other file changes.
 *
 * Fixes, in order of severity:
 *   1. Crash recovery — a killed tab no longer loses the whole activity
 *   2. Quota-safe writes — localStorage full no longer silently eats a run
 *   3. Pause/resume no longer inflates distance with a bridge segment
 *   4. START requires a fresh fix, so stale pre-run drift isn't counted
 *   5. Accuracy gate tightened 70m -> 25m; cold-start fixes discarded
 *   6. Wake lock re-acquired when the tab comes back (it never was)
 *   7. Speech primed on the START gesture, so iOS mile alerts actually speak
 *   8. Polyline drawn incrementally instead of rebuilt every fix
 *   9. Manual map pan suspends follow-mode instead of fighting the user
 *  10. Haptics on splits and goal
 *  11. Activity saved BEFORE the rename prompt, not after
 *  12. GPX export + JSON import
 */
(function () {
  'use strict';

  var LIVE_KEY = 'stridefw.live.v1';
  var MIN_ACCURACY_M = 25;
  var WARMUP_FIXES = 3;
  var AUTOSAVE_MS = 10000;

  var segment = 0;
  var warmup = 0;
  var autosaveId = null;
  var segLines = [];
  var followSuspended = false;

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  window.persist = function () {
    var attempt = 0;
    for (;;) {
      try {
        localStorage.setItem(KEYS.a, JSON.stringify(activities));
        localStorage.setItem(KEYS.r, JSON.stringify(routes));
        return true;
      } catch (err) {
        var quota = err && (err.name === 'QuotaExceededError' ||
                            err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                            err.code === 22);
        if (!quota) { console.error('persist failed', err); return false; }

        var trimmed = false;
        for (var i = activities.length - 1; i >= 0; i--) {
          if (activities[i].coords && activities[i].coords.length) {
            activities[i].coords = [];
            activities[i].trimmed = true;
            trimmed = true;
            break;
          }
        }
        if (!trimmed) {
          toast('Storage full — export your data');
          return false;
        }
        if (++attempt === 1) toast('Storage nearly full — trimming old maps');
        if (attempt > 200) return false;
      }
    }
  };

  function writeLive() {
    if (!recording) return;
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify({
        startedAt: startedAt,
        pausedMs: pausedMs,
        type: activityType,
        points: trackPoints
      }));
    } catch (e) {}
  }

  function clearLive() {
    try { localStorage.removeItem(LIVE_KEY); } catch (e) {}
  }

  function recoverLive() {
    var raw;
    try { raw = localStorage.getItem(LIVE_KEY); } catch (e) { return; }
    if (!raw) return;
    var live;
    try { live = JSON.parse(raw); } catch (e) { clearLive(); return; }
    if (!live || !Array.isArray(live.points) || live.points.length < 3) {
      clearLive();
      return;
    }

    var meters = segmentMeters(live.points);
    var miles = meters * MI_PER_M;
    var seconds = Math.round(Math.max(0, (
      live.points[live.points.length - 1].timestamp - live.startedAt - (live.pausedMs || 0)
    )) / 1000);
    if (miles < 0.02) { clearLive(); return; }

    var when = new Date(live.startedAt).toLocaleString();
    if (!confirm('Stride FW closed during a ' + displayMiles(miles).toFixed(2) + ' ' +
                 settings.units + ' ' + (live.type || 'activity') + ' from ' + when +
                 '.\n\nSave it?')) {
      clearLive();
      return;
    }

    activities.unshift({
      id: live.startedAt || Date.now(),
      name: (live.type || 'Activity') + ' — ' + new Date(live.startedAt).toLocaleDateString() + ' (recovered)',
      type: live.type || 'Run',
      date: new Date(live.startedAt).toISOString(),
      distanceMiles: round(miles, 3),
      elapsedSeconds: seconds,
      paceSecondsPerMile: miles > 0.02 ? Math.round(seconds / miles) : null,
      coords: live.points.map(function (p) { return [round(p.lat, 5), round(p.lng, 5)]; })
    });
    persist();
    clearLive();
    renderHistory();
    renderStats();
    toast('Recovered activity saved');
  }

  function segmentMeters(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if ((a.seg || 0) !== (b.seg || 0)) continue;
      total += map.distance([a.lat, a.lng], [b.lat, b.lng]);
    }
    return total;
  }

  window.trackMeters = function () { return segmentMeters(trackPoints); };

  window.shouldRecord = function (point) {
    if (point.accuracy != null && point.accuracy > MIN_ACCURACY_M) return false;
    if (warmup < WARMUP_FIXES) { warmup++; return false; }
    if (!trackPoints.length) return true;

    var prev = trackPoints[trackPoints.length - 1];
    if ((prev.seg || 0) !== segment) return true;

    var meters = map.distance([prev.lat, prev.lng], [point.lat, point.lng]);
    var seconds = Math.max(1, (point.timestamp - prev.timestamp) / 1000);
    var floor = Math.max(3, (point.accuracy || 10) * 0.5);
    if (meters < floor) return false;
    return meters / seconds <= 18;
  };

  window.enableGPS = function () {
    if (!navigator.geolocation) { toast('GPS is not supported here'); return; }
    gpsBtn.disabled = true;
    mapStatus.textContent = 'Requesting precise location…';
    if (watchId !== null) { gpsReady = true; startBtn.disabled = false; return; }
    watchId = navigator.geolocation.watchPosition(
      function (pos) { window.handlePosition(pos); },
      function (err) { window.handleGpsError(err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  };

  var basePosition = window.handlePosition;
  window.handlePosition = function (position) {
    var wasRecording = recording && !paused;
    var before = trackPoints.length;
    var follow = settings.follow;
    if (followSuspended) settings.follow = false;
    basePosition(position);
    settings.follow = follow;

    if (wasRecording && trackPoints.length > before) {
      trackPoints[trackPoints.length - 1].seg = segment;
      appendToLine(trackPoints[trackPoints.length - 1]);
    }
  };

  function resetLines() {
    segLines.forEach(function (line) { try { line.remove(); } catch (e) {} });
    segLines = [];
    if (trackLine) { try { trackLine.remove(); } catch (e) {} trackLine = null; }
  }

  function appendToLine(point) {
    var latlng = [point.lat, point.lng];
    var line = segLines[point.seg || 0];
    if (!line) {
      line = L.polyline([latlng], {
        color: '#ff5a1f', weight: 6, opacity: 0.95, lineJoin: 'round'
      }).addTo(map);
      segLines[point.seg || 0] = line;
      if (!trackLine) trackLine = line;
    } else {
      line.addLatLng(latlng);
    }
  }

  window.drawTrack = function () {
    if (segLines.length) return;
    resetLines();
    var bySeg = {};
    trackPoints.forEach(function (p) {
      (bySeg[p.seg || 0] = bySeg[p.seg || 0] || []).push(p);
    });
    Object.keys(bySeg).forEach(function (key) {
      var line = L.polyline(bySeg[key].map(function (p) { return [p.lat, p.lng]; }), {
        color: '#ff5a1f', weight: 6, opacity: 0.95, lineJoin: 'round'
      }).addTo(map);
      segLines[key] = line;
      if (!trackLine) trackLine = line;
    });
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (recording && settings.wake) requestWakeLock();
    if (recording) updateTrack();
  });

  function wireFollowRelease() {
    if (!map) return;
    map.on('dragstart', function () { followSuspended = true; });
    var container = map.getContainer && map.getContainer();
    if (!container) return;
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (eventName) {
      container.addEventListener(eventName, function () { followSuspended = true; }, { passive: true });
    });
  }

  var baseCenter = window.centerOnMe;
  window.centerOnMe = function () { followSuspended = false; baseCenter(); };

  window.fitActive = function () {
    followSuspended = true;
    var live = segLines.filter(Boolean);
    if (live.length) {
      var bounds = live[0].getBounds();
      live.slice(1).forEach(function (l) { bounds.extend(l.getBounds()); });
      map.fitBounds(bounds, { padding: [24, 24] });
      return;
    }
    if (shownLayer) { map.fitBounds(shownLayer.getBounds(), { padding: [24, 24] }); return; }
    centerOnMe();
  };

  var baseStart = window.startActivity;
  window.startActivity = function () {
    if (!gpsReady || !lastPosition) { enableGPS(); return; }

    var age = Date.now() - (lastPosition.timestamp || 0);
    if (age > 15000) {
      toast('Waiting for a fresh GPS fix…');
      return;
    }
    if (lastPosition.accuracy != null && lastPosition.accuracy > MIN_ACCURACY_M) {
      toast('GPS accuracy is ±' + Math.round(lastPosition.accuracy) + ' m — wait a moment');
      return;
    }

    try {
      if (settings.voice && 'speechSynthesis' in window) {
        var speechWarmup = new SpeechSynthesisUtterance(' ');
        speechWarmup.volume = 0;
        speechSynthesis.speak(speechWarmup);
      }
    } catch (e) {}

    segment = 0;
    warmup = 0;
    var result = baseStart();

    resetLines();
    if (trackPoints.length) {
      trackPoints[0].seg = 0;
      trackPoints[0].timestamp = lastPosition.timestamp || Date.now();
      appendToLine(trackPoints[0]);
    }
    followSuspended = false;
    vibrate(40);
    clearInterval(autosaveId);
    autosaveId = setInterval(writeLive, AUTOSAVE_MS);
    writeLive();
    return result;
  };

  var basePause = window.togglePause;
  window.togglePause = function () {
    if (!recording) return;
    var wasPaused = paused;
    basePause();
    if (!wasPaused && paused) {
      segment++;
      warmup = 0;
      writeLive();
    }
    vibrate(wasPaused ? 40 : [30, 60, 30]);
  };

  var baseAnnounce = window.announceIfNeeded;
  window.announceIfNeeded = function () {
    var before = lastAnnounced;
    baseAnnounce();
    if (lastAnnounced > before) vibrate([80, 80, 80]);
  };

  var goalHit = false;
  var baseUpdate = window.updateTrack;
  window.updateTrack = function () {
    baseUpdate();
    var goal = Number(goalInput.value || 0);
    if (recording && goal > 0 && !goalHit && displayMeters(trackMeters()) >= goal) {
      goalHit = true;
      vibrate([120, 80, 120, 80, 120]);
    }
  };

  window.finishActivity = function () {
    if (!recording) return;
    if (paused && pauseAt) { pausedMs += Date.now() - pauseAt; pauseAt = null; }

    var seconds = Math.round(elapsedMs() / 1000);
    var miles = trackMeters() * MI_PER_M;
    var defaultName = activityType + ' — ' + new Date().toLocaleDateString();

    var record = {
      id: Date.now(),
      name: defaultName,
      type: activityType,
      date: new Date().toISOString(),
      distanceMiles: round(miles, 3),
      elapsedSeconds: seconds,
      paceSecondsPerMile: miles > 0.02 ? Math.round(seconds / miles) : null,
      coords: trackPoints.map(function (p) { return [round(p.lat, 5), round(p.lng, 5)]; })
    };
    activities.unshift(record);
    persist();
    clearLive();
    clearInterval(autosaveId);
    autosaveId = null;

    recording = false;
    paused = false;
    goalHit = false;
    clearInterval(timerId);
    timerId = null;
    releaseWakeLock();
    startWrap.classList.remove('hidden');
    startBtn.disabled = !gpsReady;
    recordControls.classList.add('hidden');
    pauseBtn.textContent = 'Ⅱ Pause';
    document.querySelectorAll('.typeBtn').forEach(function (b) { b.disabled = false; });
    goalInput.disabled = false;
    mapStatus.textContent = 'Saved — nice work';
    vibrate([60, 40, 60]);
    toast('Activity saved');
    renderHistory();
    renderStats();

    setTimeout(function () {
      var name;
      try { name = prompt('Name this activity', defaultName); } catch (e) { return; }
      if (name && name.trim() && name.trim() !== defaultName) {
        record.name = name.trim();
        persist();
        renderHistory();
      }
    }, 150);
  };

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.exportGPX = function (index) {
    var act = activities[index];
    if (!act || !act.coords || !act.coords.length) { toast('No map trace to export'); return; }
    var start = new Date(act.date).getTime();
    var perPoint = (act.elapsedSeconds || 0) * 1000 / Math.max(1, act.coords.length - 1);
    var pts = act.coords.map(function (c, i) {
      return '   <trkpt lat="' + c[0] + '" lon="' + c[1] + '"><time>' +
        new Date(start + i * perPoint).toISOString() + '</time></trkpt>';
    }).join('\n');
    download(
      (act.name || 'activity').replace(/[^\w-]+/g, '-').toLowerCase() + '.gpx',
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Stride FW" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      ' <trk><name>' + esc(act.name || 'Activity') + '</name><type>' + esc(act.type || 'Run') + '</type><trkseg>\n' +
      pts + '\n </trkseg></trk>\n</gpx>',
      'application/gpx+xml'
    );
    toast('GPX exported');
  };

  window.importData = function () {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('That file is not valid Stride FW data'); return; }
        if (!data || (!Array.isArray(data.activities) && !Array.isArray(data.routes))) {
          toast('No activities or routes in that file');
          return;
        }
        var seen = {};
        activities.forEach(function (a) { seen[a.id] = true; });
        var addedA = 0;
        (data.activities || []).forEach(function (a) {
          if (a && a.id && !seen[a.id]) { activities.push(a); seen[a.id] = true; addedA++; }
        });
        var seenR = {};
        routes.forEach(function (r) { seenR[r.id] = true; });
        var addedR = 0;
        (data.routes || []).forEach(function (r) {
          if (r && r.id && !seenR[r.id]) { routes.push(r); seenR[r.id] = true; addedR++; }
        });
        activities.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        persist();
        renderHistory();
        renderStats();
        toast('Imported ' + addedA + ' activities, ' + addedR + ' routes');
      };
      reader.readAsText(file);
    };
    input.click();
  };

  var baseRenderHistory = window.renderHistory;
  window.renderHistory = function () {
    baseRenderHistory();
    document.querySelectorAll('#historyList .smallActions').forEach(function (row) {
      if (row.querySelector('.gpxBtn')) return;
      var share = row.querySelector('[onclick^="shareActivity"]');
      if (!share) return;
      var idx = (share.getAttribute('onclick').match(/\d+/) || [])[0];
      if (idx === undefined) return;
      var btn = document.createElement('button');
      btn.className = 'btn secondary gpxBtn';
      btn.textContent = 'GPX';
      btn.setAttribute('onclick', 'exportGPX(' + idx + ')');
      share.insertAdjacentElement('afterend', btn);
    });
  };

  window.addEventListener('load', function () {
    wireFollowRelease();
    recoverLive();
    renderHistory();

    window.addEventListener('beforeunload', function (e) {
      if (!recording) return;
      writeLive();
      e.preventDefault();
      e.returnValue = '';
    });
  });

  var baseShowScreen = window.showScreen;
  window.showScreen = function (name) {
    baseShowScreen(name);
    if (name === 'more') renderStats();
  };
})();