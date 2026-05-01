// ===== CONFIGURATIE =====
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzLfS2vpTe5RHBDqKIQk1P5qMUmcPHZWZ1ZajBv1OoJ5qYLYsTDAiT2NKlen9La_ZjO/exec';

// Firebase configuratie - VERVANG met jouw eigen project!
// Ga naar https://console.firebase.google.com om een project aan te maken
const firebaseConfig = {
    apiKey: "AIzaSyCTsXndhDPHx_DtZfCD9YwiwskBD_mAjF0",
    authDomain: "bitl-haven.firebaseapp.com",
    projectId: "bitl-haven",
    storageBucket: "bitl-haven.firebasestorage.app",
    messagingSenderId: "736149991862",
    appId: "1:736149991862:web:07bc675b2dfa0d8c9c1117",
    measurementId: "G-1XLPHBBMXR"
};

const GRID_SIZE_LAT = 0.00135; // ~150m
const GRID_SIZE_LNG = 0.00214; // ~150m at 51°N
const DEFAULT_CENTER = [51.2678, 4.7077]; // Zoersel 2980

// ===== STATE =====
const items = [
    { id: 'v', name: 'Vanille', price: 7 },
    { id: 's', name: 'Suikervrij', price: 10 },
    { id: 'm', name: 'Mix', price: 8 },
    { id: 'c', name: 'Choco', price: 7 },
    { id: 'f', name: 'Frangipane', price: 8 }
];

const order = items.reduce((acc, item) => ({ ...acc, [item.id]: 0 }), {});
let longPressTimer = null;
let isLongPress = false;
let activeItem = null;

// Rondhaling state
let map = null;
let gpsMarker = null;
let gpsWatchId = null;
let isTracking = false;
let currentRoute = [];
let currentRouteLine = null;
let pastRouteLines = [];
let suggestedRouteLine = null;
let currentNavUrl = null;
let generatedRouteOptions = [];
let visitedCells = {};
let currentPosition = null;
let trackingStartTime = null;
let trackingDistance = 0;
let useFirebase = false;
let db = null;
let userName = localStorage.getItem('afrikaWafelUser') || '';

// ===== FIREBASE INIT =====
function initFirebase() {
    try {
        if (firebaseConfig.apiKey === 'JOUW-API-KEY') {
            document.getElementById('firebaseBanner').style.display = 'block';
            return;
        }
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        useFirebase = true;
        document.getElementById('firebaseBanner').style.display = 'none';
    } catch (e) {
        console.warn('Firebase niet beschikbaar, localStorage wordt gebruikt', e);
        document.getElementById('firebaseBanner').style.display = 'block';
    }
}

// ===== BESTELLING LOGICA =====
const itemGrid = document.getElementById('itemGrid');
const totalEl = document.getElementById('totaal');
const menuOverlay = document.getElementById('menuOverlay');
const menuItemLabel = document.getElementById('menuItemLabel');
const menuCount = document.getElementById('menuCount');
const menuManualCount = document.getElementById('menuManualCount');

function formatCurrency(value) { return '€' + value.toFixed(2).replace('.', ','); }

function renderItems() {
    itemGrid.innerHTML = '';
    items.forEach(item => {
        const button = document.createElement('button');
        button.className = 'item-card';
        button.type = 'button';
        button.dataset.id = item.id;
        button.innerHTML = `
            <div class="item-title">${item.name}</div>
            <div class="item-price">€${item.price.toFixed(2).replace('.', ',')}</div>
            <div class="item-count" id="count-${item.id}">${order[item.id]}</div>
        `;
        button.addEventListener('click', (e) => {
            if (isLongPress) return;
            incrementItem(item.id);
        });
        button.addEventListener('mousedown', startLongPress);
        button.addEventListener('touchstart', startLongPress, { passive: true });
        button.addEventListener('mouseup', cancelLongPress);
        button.addEventListener('mouseleave', cancelLongPress);
        button.addEventListener('touchend', cancelLongPress);
        button.addEventListener('touchmove', cancelLongPress, { passive: true });
        button.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(item.id); });
        itemGrid.appendChild(button);
    });
}

function incrementItem(id) { order[id]++; updateItem(id); updateTotal(); }
function updateItem(id) { const el = document.getElementById(`count-${id}`); if (el) el.innerText = order[id]; }
function updateTotal() {
    const total = items.reduce((sum, item) => sum + order[item.id] * item.price, 0);
    totalEl.innerText = formatCurrency(total);
}

function startLongPress(e) {
    if (e.type === 'touchstart') window.isTouch = true;
    if (e.type === 'mousedown' && window.isTouch) return;

    isLongPress = false;
    const id = e.currentTarget.dataset.id;
    longPressTimer = setTimeout(() => {
        isLongPress = true;
        openMenu(id);
        if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
}

function cancelLongPress(e) {
    if (e && e.type === 'mouseup' && window.isTouch) return;
    clearTimeout(longPressTimer);
}

function openMenu(id) {
    activeItem = items.find(i => i.id === id);
    if (!activeItem) return;
    menuItemLabel.innerText = `${activeItem.name} — €${activeItem.price.toFixed(2).replace('.', ',')}`;
    menuManualCount.value = order[id];
    menuCount.innerText = order[id];
    menuOverlay.classList.add('open');
}

function closeMenu() { menuOverlay.classList.remove('open'); activeItem = null; }

function changeCount(delta) {
    if (!activeItem) return;
    order[activeItem.id] = Math.max(0, order[activeItem.id] + delta);
    menuCount.innerText = order[activeItem.id];
    menuManualCount.value = order[activeItem.id];
}

function applyManualCount() {
    if (!activeItem) return;
    const v = parseInt(menuManualCount.value, 10);
    order[activeItem.id] = isNaN(v) ? order[activeItem.id] : Math.max(0, v);
    updateItem(activeItem.id); updateTotal(); closeMenu();
}

function clearItem() {
    if (!activeItem) return;
    order[activeItem.id] = 0;
    updateItem(activeItem.id); updateTotal(); closeMenu();
}

function toggleBetaalOpties() {
    const status = document.getElementById('betaalstatus').value;
    document.getElementById('betaald_opties').style.display = status === 'betaald' ? 'block' : 'none';
    toggleQrBtn();
}

function toggleQrBtn() {
    const methode = document.getElementById('betaalmethode').value;
    const btn = document.getElementById('btnQr');
    if (btn) {
        btn.style.display = methode === 'kaart' ? 'block' : 'none';
    }
}

function openQr() {
    document.getElementById('qrOverlay').classList.add('open');
}

function closeQr() {
    document.getElementById('qrOverlay').classList.remove('open');
}

function stuurData() {
    const btn = document.getElementById('saveBtn');
    const msg = document.getElementById('msg');

    const naam = document.getElementById('naam').value;
    const email = document.getElementById('email').value;
    const telefoon = document.getElementById('telefoon').value;

    if (!naam || (!email && !telefoon)) {
        alert("Vul aub naam en e-mail (of telefoonnummer) in."); return;
    }

    const status = document.getElementById('betaalstatus').value;
    let betaalmethode = '';
    let notitie = document.getElementById('notitie').value;

    if (status === 'betaald') {
        betaalmethode = document.getElementById('betaalmethode').value;
    }

    btn.disabled = true;
    msg.innerText = '⏳ Bezig met opslaan...';

    const payload = {
        naam: naam,
        email: email,
        telefoon: telefoon,
        adres: document.getElementById('adres').value,
        betaalstatus: status,
        betaalmethode: betaalmethode,
        notitie: notitie,
        vanille: order['v'] || 0, suikervrij: order['s'] || 0,
        mix: order['m'] || 0, choco: order['c'] || 0, frangipane: order['f'] || 0
    };

    fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(() => { msg.innerText = '✅ Gelukt!'; resetOrder(); btn.disabled = false; })
        .catch(err => { console.error(err); msg.innerText = '❌ Fout!'; btn.disabled = false; });
}

function resetOrder() {
    items.forEach(i => { order[i.id] = 0; updateItem(i.id); });
    document.getElementById('naam').value = '';
    document.getElementById('email').value = '';
    document.getElementById('telefoon').value = '';
    document.getElementById('adres').value = '';
    document.getElementById('betaalstatus').value = '';
    document.getElementById('betaalmethode').value = 'cash';
    document.getElementById('notitie').value = '';
    toggleBetaalOpties();
    updateTotal();
}

// ===== TAB NAVIGATIE =====
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    if (tabId === 'rondhaling' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// ===== TRACKING STATE & COLORS =====
const userColors = [
    '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000',
    '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9'
];

function getUserColor(name) {
    if (!name) return '#27ae60';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return userColors[Math.abs(hash) % userColors.length];
}

function saveTrackingState() {
    localStorage.setItem('awTrackingState', JSON.stringify({
        isTracking, currentRoute, trackingDistance, trackingStartTime
    }));
}

function initTrackingState() {
    try {
        const state = JSON.parse(localStorage.getItem('awTrackingState') || '{}');
        if (state.isTracking) {
            isTracking = true;
            currentRoute = state.currentRoute || [];
            trackingDistance = state.trackingDistance || 0;
            trackingStartTime = state.trackingStartTime || Date.now();

            if (currentRoute.length > 0 && map) {
                const latlngs = currentRoute.map(p => [p.lat, p.lng]);
                currentRouteLine = L.polyline(latlngs, { color: getUserColor(userName), weight: 6, opacity: 1.0 }).addTo(map);
                const lastPos = latlngs[latlngs.length - 1];
                map.panTo(lastPos);
                currentPosition = { lat: lastPos[0], lng: lastPos[1] };
            }
            startTracking(true);
        }
    } catch (e) { console.error("Error resuming tracking state", e); }
}

// ===== KAART =====
function initMap() {
    map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async pos => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                currentPosition = { lat, lng, t: Date.now() };
                map.setView([lat, lng], 14);

                if (!gpsMarker) {
                    const icon = L.divIcon({ className: 'gps-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
                    gpsMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
                } else {
                    gpsMarker.setLatLng([lat, lng]);
                }

                await loadVisitedCells();
                await loadRoutes(lat, lng, 4); // 4 km radius
                initTrackingState();
            },
            async err => {
                console.warn('GPS error on init:', err);
                await loadVisitedCells();
                await loadRoutes();
                initTrackingState();
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    } else {
        loadVisitedCells().then(() => loadRoutes()).then(() => initTrackingState());
    }
}

// ===== GPS TRACKING =====
function toggleTracking() {
    if (isTracking) stopTracking();
    else startTracking();
}

function startTracking(resume = false) {
    if (!navigator.geolocation) { alert('GPS niet beschikbaar'); return; }
    if (!userName) {
        userName = prompt('Wat is je naam?', '') || 'Onbekend';
        localStorage.setItem('afrikaWafelUser', userName);
        updateUserDisplay();
    }

    isTracking = true;

    if (!resume) {
        currentRoute = [];
        trackingDistance = 0;
        trackingStartTime = Date.now();
        saveTrackingState();
    }

    const btn = document.getElementById('trackBtn');
    btn.className = 'rh-start-btn stop';
    btn.innerHTML = '⏹ Stop Rondhaling';
    document.getElementById('trackingInfo').style.display = 'flex';
    updateTrackingStats();

    gpsWatchId = navigator.geolocation.watchPosition(
        pos => onGpsUpdate(pos.coords.latitude, pos.coords.longitude),
        err => { console.error(err); alert('GPS fout: ' + err.message); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
}

function stopTracking() {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    isTracking = false;
    const btn = document.getElementById('trackBtn');
    btn.className = 'rh-start-btn start';
    btn.innerHTML = '▶ Start Rondhaling';

    if (currentRoute.length > 1) saveCurrentRoute();
    else { currentRoute = []; saveTrackingState(); }
    document.getElementById('trackingInfo').style.display = 'none';
}

function onGpsUpdate(lat, lng) {
    const now = Date.now();

    // Uitschieter (GPS glitch) filter
    if (currentPosition && currentPosition.t) {
        const dist = haversine(currentPosition.lat, currentPosition.lng, lat, lng);
        const timeDiff = (now - currentPosition.t) / 1000; // in seconden

        if (timeDiff > 0) {
            const speed = dist / timeDiff; // m/s
            // Als snelheid > 25 m/s (90 km/u) en afstand > 20m, negeer (waarschijnlijk GPS glitch)
            if (speed > 25 && dist > 20) {
                console.warn(`GPS outlier genegeerd: ${dist.toFixed(1)}m in ${timeDiff.toFixed(1)}s (${speed.toFixed(1)}m/s)`);
                return;
            }
        } else if (dist > 20) {
            return; // onmogelijke sprong in 0 seconden
        }
    }

    currentPosition = { lat, lng, t: now };

    // Update marker
    if (!gpsMarker) {
        const icon = L.divIcon({ className: 'gps-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
        gpsMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
        gpsMarker.setLatLng([lat, lng]);
    }
    map.panTo([lat, lng]);

    if (isTracking) {
        const prev = currentRoute[currentRoute.length - 1];
        if (prev) trackingDistance += haversine(prev.lat, prev.lng, lat, lng);
        currentRoute.push({ lat, lng, t: now });

        // Update route line
        const latlngs = currentRoute.map(p => [p.lat, p.lng]);
        if (currentRouteLine) currentRouteLine.setLatLngs(latlngs);
        else currentRouteLine = L.polyline(latlngs, { color: getUserColor(userName), weight: 6, opacity: 1.0 }).addTo(map);

        // Mark grid cell visited
        markCellVisited(lat, lng);
        updateTrackingStats();
        saveTrackingState();
    }
}

function updateTrackingStats() {
    document.getElementById('statDist').innerText = (trackingDistance / 1000).toFixed(2) + ' km';
    const elapsed = Math.floor((Date.now() - trackingStartTime) / 60000);
    document.getElementById('statTime').innerText = elapsed + ' min';
    document.getElementById('statPoints').innerText = currentRoute.length;
}

// ===== ROUTE OPSLAG =====
async function saveCurrentRoute() {
    const routeData = {
        user: userName,
        startTime: new Date(trackingStartTime).toISOString(),
        endTime: new Date().toISOString(),
        distance: Math.round(trackingDistance),
        pointCount: currentRoute.length,
        coordinates: currentRoute
    };

    if (useFirebase) {
        try { await db.collection('routes').add(routeData); }
        catch (e) { console.error('Firebase save failed', e); }
    }

    const routes = JSON.parse(localStorage.getItem('awRoutes') || '[]');
    routes.push(routeData);
    localStorage.setItem('awRoutes', JSON.stringify(routes));

    // Reset current route line to a "past" style
    if (currentRouteLine) {
        currentRouteLine.setStyle({ color: getUserColor(userName), weight: 6, opacity: 1.0 });
        pastRouteLines.push(currentRouteLine);
        currentRouteLine = null;
    }
    currentRoute = [];
    saveTrackingState();
    updateGlobalStats();
}

async function loadRoutes(userLat = null, userLng = null, radiusKm = null) {
    let routes = [];
    if (useFirebase) {
        try {
            const snap = await db.collection('routes').orderBy('startTime', 'desc').get();
            routes = snap.docs.map(d => d.data());
        } catch (e) { console.error(e); }
    }
    if (routes.length === 0) {
        routes = JSON.parse(localStorage.getItem('awRoutes') || '[]');
    }

    routes.forEach(r => {
        if (r.coordinates && r.coordinates.length > 1) {
            let inRadius = true;
            if (userLat !== null && userLng !== null && radiusKm !== null) {
                inRadius = false;
                for (let p of r.coordinates) {
                    if (haversine(userLat, userLng, p.lat, p.lng) <= radiusKm * 1000) {
                        inRadius = true;
                        break;
                    }
                }
            }

            r.coordinates.forEach(p => markCellVisited(p.lat, p.lng, true, p.t, r.user));

            if (inRadius) {
                const latlngs = r.coordinates.map(p => [p.lat, p.lng]);
                const routeColor = r.user ? getUserColor(r.user) : '#27ae60';
                const line = L.polyline(latlngs, { color: routeColor, weight: 6, opacity: 1.0 }).addTo(map);
                pastRouteLines.push(line);
            }
        }
    });
    updateGlobalStats();
}

// ===== GRID & DEKKING =====
function getCellId(lat, lng) {
    return Math.floor(lat / GRID_SIZE_LAT) + '_' + Math.floor(lng / GRID_SIZE_LNG);
}

function getCellBounds(cellId) {
    const [latIdx, lngIdx] = cellId.split('_').map(Number);
    return L.latLngBounds(
        [latIdx * GRID_SIZE_LAT, lngIdx * GRID_SIZE_LNG],
        [(latIdx + 1) * GRID_SIZE_LAT, (lngIdx + 1) * GRID_SIZE_LNG]
    );
}

function markCellVisited(lat, lng, skipSave, timestamp = null, routeUser = null) {
    const id = getCellId(lat, lng);
    if (!visitedCells[id]) {
        visitedCells[id] = { count: 0, lastVisited: null, user: routeUser || userName };
    }
    visitedCells[id].count++;
    visitedCells[id].lastVisited = timestamp || Date.now();
    if (routeUser && !visitedCells[id].user) visitedCells[id].user = routeUser;

    if (!skipSave) {
        localStorage.setItem('awGrid', JSON.stringify(visitedCells));
        if (useFirebase) {
            db.collection('visitedGrid').doc(id).set(visitedCells[id], { merge: true }).catch(() => { });
        }
    }
}

async function loadVisitedCells() {
    if (useFirebase) {
        try {
            const snap = await db.collection('visitedGrid').get();
            snap.docs.forEach(d => {
                const id = d.id;
                visitedCells[id] = d.data();
            });
        } catch (e) { console.error(e); }
    }

    const local = JSON.parse(localStorage.getItem('awGrid') || '{}');
    Object.keys(local).forEach(id => {
        if (!visitedCells[id]) {
            visitedCells[id] = local[id];
        }
    });
    updateGlobalStats();
}

// ===== ROUTE GENERATIE =====
async function generateRoute(lengthKm) {
    if (!currentPosition) {
        alert('Wacht op GPS-positie...');
        navigator.geolocation.getCurrentPosition(
            pos => { onGpsUpdate(pos.coords.latitude, pos.coords.longitude); generateRoute(lengthKm); },
            () => alert('GPS niet beschikbaar')
        );
        return;
    }

    const btn = event.target;
    btn.innerHTML = '<span class="loading-spinner"></span>Berekenen...';
    btn.disabled = true;

    try {
        // Find unvisited cells nearby
        const radiusDeg = (lengthKm / 111) * 0.5;
        const candidates = [];
        const { lat, lng } = currentPosition;

        for (let dLat = -radiusDeg; dLat <= radiusDeg; dLat += GRID_SIZE_LAT) {
            for (let dLng = -radiusDeg; dLng <= radiusDeg; dLng += GRID_SIZE_LNG) {
                const cLat = lat + dLat;
                const cLng = lng + dLng;
                const id = getCellId(cLat, cLng);
                if (!visitedCells[id]) {
                    candidates.push({ lat: cLat, lng: cLng, dist: haversine(lat, lng, cLat, cLng) });
                }
            }
        }

        if (candidates.length === 0) {
            alert('Alle gebieden in de buurt zijn al bezocht! Probeer een langere route.');
            return;
        }

        // Sort by distance and pick waypoints
        candidates.sort((a, b) => a.dist - b.dist);
        const waypoints = selectWaypoints(currentPosition, candidates, lengthKm);

        // Get route from OSRM using Trip API for optimal ordering (TSP)
        const coords = [currentPosition, ...waypoints];
        const coordStr = coords.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/trip/v1/foot/${coordStr}?source=first&roundtrip=true&overview=full&geometries=geojson`;

        const resp = await fetch(url);
        const data = await resp.json();

        if (data.trips && data.trips[0]) {
            if (suggestedRouteLine) map.removeLayer(suggestedRouteLine);
            const geojson = data.trips[0].geometry;
            suggestedRouteLine = L.geoJSON(geojson, {
                style: { color: '#3498db', weight: 5, opacity: 0.8, dashArray: '10 8' }
            }).addTo(map);
            map.fitBounds(suggestedRouteLine.getBounds(), { padding: [40, 40] });

            const dist = (data.trips[0].distance / 1000).toFixed(1);
            const time = Math.round(data.trips[0].duration / 60);

            // Build Google Maps Link
            const optimalWaypoints = [];
            if (data.waypoints) {
                data.waypoints.forEach((wp, i) => {
                    optimalWaypoints[wp.waypoint_index] = coords[i];
                });
            } else {
                optimalWaypoints.push(...coords);
            }

            const waypointsForGoogle = optimalWaypoints.slice(1).map(w => `${w.lat},${w.lng}`).join('|');
            currentNavUrl = `https://www.google.com/maps/dir/?api=1&origin=${currentPosition.lat},${currentPosition.lng}&destination=${currentPosition.lat},${currentPosition.lng}&waypoints=${waypointsForGoogle}&travelmode=walking`;

            const navCont = document.getElementById('navContainer');
            if (navCont) navCont.style.display = 'block';

            alert(`Logische route gevonden: ${dist} km, ±${time} minuten lopen`);
        } else {
            alert('Kon geen route berekenen. Probeer opnieuw.');
        }
    } catch (e) {
        console.error(e);
        alert('Fout bij route berekenen: ' + e.message);
    } finally {
        document.querySelectorAll('.rh-route-btn').forEach(b => { b.disabled = false; });
        document.querySelector('[data-km="2"]').innerHTML = '🚶 Kort<br><small>±2 km</small>';
        document.querySelector('[data-km="5"]').innerHTML = '🚶 Middel<br><small>±5 km</small>';
        document.querySelector('[data-km="10"]').innerHTML = '🚶 Lang<br><small>±10 km</small>';
    }
}

function selectWaypoints(start, candidates, targetKm) {
    const waypoints = [];
    let current = start;
    let totalDist = 0;
    const halfTarget = (targetKm * 1000) / 2;
    const used = new Set();
    const maxWp = 8;

    for (let i = 0; i < maxWp && totalDist < halfTarget; i++) {
        let best = null, bestDist = Infinity, bestIdx = -1;
        for (let j = 0; j < candidates.length; j++) {
            if (used.has(j)) continue;
            const d = haversine(current.lat, current.lng, candidates[j].lat, candidates[j].lng);
            if (d < bestDist && d > 50) { // min 50m between waypoints
                bestDist = d; best = candidates[j]; bestIdx = j;
            }
        }
        if (!best || bestDist > targetKm * 400) break;
        used.add(bestIdx);
        waypoints.push(best);
        totalDist += bestDist;
        current = best;
    }
    return waypoints;
}

// ===== GEBIEDSVERKENNING =====
async function generateRoutesInRadius() {
    if (!currentPosition) {
        alert('Wacht op GPS-positie...');
        navigator.geolocation.getCurrentPosition(
            pos => { onGpsUpdate(pos.coords.latitude, pos.coords.longitude); generateRoutesInRadius(); },
            () => alert('GPS niet beschikbaar')
        );
        return;
    }

    const radiusInput = document.getElementById('areaRadius').value;
    const radiusKm = parseFloat(radiusInput);
    if (isNaN(radiusKm) || radiusKm <= 0) {
        alert('Voer een geldige straal in.');
        return;
    }

    const btn = document.getElementById('btnAreaRoutes');
    btn.innerHTML = '<span class="loading-spinner"></span>...';
    btn.disabled = true;
    const listContainer = document.getElementById('routeListContainer');
    listContainer.innerHTML = '<div style="padding:10px; text-align:center;">Routes berekenen...</div>';
    listContainer.style.display = 'block';

    try {
        const radiusDeg = (radiusKm / 111);
        const candidates = [];
        const { lat, lng } = currentPosition;

        for (let dLat = -radiusDeg; dLat <= radiusDeg; dLat += GRID_SIZE_LAT) {
            for (let dLng = -radiusDeg; dLng <= radiusDeg; dLng += GRID_SIZE_LNG) {
                const cLat = lat + dLat;
                const cLng = lng + dLng;
                const id = getCellId(cLat, cLng);
                const dist = haversine(lat, lng, cLat, cLng);
                if (!visitedCells[id] && dist <= radiusKm * 1000) {
                    candidates.push({ lat: cLat, lng: cLng, dist: dist });
                }
            }
        }

        if (candidates.length === 0) {
            listContainer.innerHTML = '<div style="padding:10px; text-align:center;">Geen onbezochte gebieden in deze straal.</div>';
            return;
        }

        const routePromises = [];
        const targetLengths = [2, 5, Math.max(8, radiusKm * 1.5)];

        candidates.sort((a, b) => a.dist - b.dist);

        for (let i = 0; i < targetLengths.length; i++) {
            const tLen = targetLengths[i];
            const shuffled = [...candidates].sort(() => 0.5 - Math.random());
            const wps = selectWaypoints(currentPosition, shuffled, tLen);

            if (wps.length > 0) {
                const coords = [currentPosition, ...wps];
                const coordStr = coords.map(p => `${p.lng},${p.lat}`).join(';');
                const url = `https://router.project-osrm.org/trip/v1/foot/${coordStr}?source=first&roundtrip=true&overview=full&geometries=geojson`;
                routePromises.push(fetch(url).then(r => r.json()).catch(() => null));
            }
        }

        const results = await Promise.all(routePromises);
        generatedRouteOptions = [];

        results.forEach(data => {
            if (data && data.trips && data.trips[0]) {
                generatedRouteOptions.push(data);
            }
        });

        const uniqueRoutes = [];
        const dists = new Set();
        generatedRouteOptions.forEach(r => {
            const d = Math.round(r.trips[0].distance / 100);
            if (!dists.has(d)) {
                dists.add(d);
                uniqueRoutes.push(r);
            }
        });

        uniqueRoutes.sort((a, b) => a.trips[0].distance - b.trips[0].distance);
        generatedRouteOptions = uniqueRoutes;

        if (generatedRouteOptions.length > 0) {
            renderRouteList();
        } else {
            listContainer.innerHTML = '<div style="padding:10px; text-align:center;">Kon geen routes berekenen.</div>';
        }

    } catch (e) {
        console.error(e);
        listContainer.innerHTML = '<div style="padding:10px; text-align:center; color:red;">Fout bij berekenen.</div>';
    } finally {
        btn.innerHTML = 'Vind Routes';
        btn.disabled = false;
    }
}

function renderRouteList() {
    const listContainer = document.getElementById('routeListContainer');
    listContainer.innerHTML = '';

    generatedRouteOptions.forEach((data, index) => {
        const dist = (data.trips[0].distance / 1000).toFixed(1);
        const time = Math.round(data.trips[0].duration / 60);

        const item = document.createElement('div');
        item.className = 'route-list-item';

        let label = "Kort";
        if (dist > 3.5 && dist <= 7) label = "Middel";
        else if (dist > 7) label = "Lang";

        item.innerHTML = `
            <div>
                <strong style="color: var(--primary);">Route ${index + 1} (${label})</strong><br>
                <small style="color: var(--text-light);">${dist} km • ±${time} min lopen</small>
            </div>
            <button style="padding: 8px 16px; border-radius: 8px; background: var(--secondary); color: white; border: none; font-weight: bold; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--primary)'" onmouseout="this.style.background='var(--secondary)'">Toon</button>
        `;

        item.onclick = () => showSelectedRoute(data);
        listContainer.appendChild(item);
    });
}

function showSelectedRoute(data) {
    if (suggestedRouteLine) map.removeLayer(suggestedRouteLine);
    const geojson = data.trips[0].geometry;
    suggestedRouteLine = L.geoJSON(geojson, {
        style: { color: '#3498db', weight: 5, opacity: 0.8, dashArray: '10 8' }
    }).addTo(map);
    map.fitBounds(suggestedRouteLine.getBounds(), { padding: [40, 40] });

    const wpsForGoogle = data.waypoints.slice(1).map(w => `${w.location[1]},${w.location[0]}`).join('|');
    currentNavUrl = `https://www.google.com/maps/dir/?api=1&origin=${currentPosition.lat},${currentPosition.lng}&destination=${currentPosition.lat},${currentPosition.lng}&waypoints=${wpsForGoogle}&travelmode=walking`;

    const navCont = document.getElementById('navContainer');
    if (navCont) navCont.style.display = 'block';
}

// ===== STATISTIEKEN =====
function updateGlobalStats() {
    const routes = JSON.parse(localStorage.getItem('awRoutes') || '[]');
    const totalDist = routes.reduce((s, r) => s + (r.distance || 0), 0);
    const el1 = document.getElementById('globalDist');
    const el2 = document.getElementById('globalRoutes');
    const el3 = document.getElementById('globalCells');
    if (el1) el1.innerText = (totalDist / 1000).toFixed(1) + ' km';
    if (el2) el2.innerText = routes.length;
    if (el3) el3.innerText = Object.keys(visitedCells).length;
}

// ===== HELPERS =====
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateUserDisplay() {
    const el = document.getElementById('userBtn');
    if (el) el.innerText = userName ? '👤 ' + userName : '👤 Naam instellen';
}

function changeUser() {
    const name = prompt('Wat is je naam?', userName);
    if (name !== null) {
        userName = name || 'Onbekend';
        localStorage.setItem('afrikaWafelUser', userName);
        updateUserDisplay();
    }
}

function clearSuggestedRoute() {
    if (suggestedRouteLine) { map.removeLayer(suggestedRouteLine); suggestedRouteLine = null; }
    const navCont = document.getElementById('navContainer');
    if (navCont) navCont.style.display = 'none';
    currentNavUrl = null;
}

function openNavigation() {
    if (currentNavUrl) {
        window.open(currentNavUrl, '_blank');
    }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    renderItems();
    updateTotal();
    initFirebase();
    initMap();
    updateUserDisplay();
    updateGlobalStats();
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
});
