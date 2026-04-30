// ===== CONFIGURATIE =====
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyVTNetR-qmK4I_1MQqxNYa9BAHKhjfxGGUDI9kzI4x5BhtD_Yx9rugsqAv_lFTpx0/exec';

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
const DEFAULT_CENTER = [50.85, 4.35]; // België

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
        button.addEventListener('click', () => incrementItem(item.id));
        button.addEventListener('mousedown', startLongPress);
        button.addEventListener('touchstart', startLongPress, { passive: true });
        button.addEventListener('mouseup', cancelLongPress);
        button.addEventListener('mouseleave', cancelLongPress);
        button.addEventListener('touchend', cancelLongPress);
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

function startLongPress(e) { longPressTimer = setTimeout(() => openMenu(e.currentTarget.dataset.id), 500); }
function cancelLongPress() { clearTimeout(longPressTimer); }

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

function stuurData() {
    const btn = document.getElementById('saveBtn');
    const msg = document.getElementById('msg');
    if (!document.getElementById('naam').value || !document.getElementById('email').value) {
        alert("Vul aub naam en e-mail in."); return;
    }
    btn.disabled = true;
    msg.innerText = '⏳ Bezig met opslaan...';
    const payload = {
        naam: document.getElementById('naam').value,
        email: document.getElementById('email').value,
        adres: document.getElementById('adres').value,
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
    document.getElementById('adres').value = '';
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

// ===== KAART =====
function initMap() {
    map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    loadRoutes();
    loadVisitedCells();
}

// ===== GPS TRACKING =====
function toggleTracking() {
    if (isTracking) stopTracking();
    else startTracking();
}

function startTracking() {
    if (!navigator.geolocation) { alert('GPS niet beschikbaar'); return; }
    if (!userName) {
        userName = prompt('Wat is je naam?', '') || 'Onbekend';
        localStorage.setItem('afrikaWafelUser', userName);
        updateUserDisplay();
    }
    isTracking = true;
    currentRoute = [];
    trackingDistance = 0;
    trackingStartTime = Date.now();
    const btn = document.getElementById('trackBtn');
    btn.className = 'rh-start-btn stop';
    btn.innerHTML = '⏹ Stop Rondhaling';
    document.getElementById('trackingInfo').style.display = 'flex';

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
    document.getElementById('trackingInfo').style.display = 'none';
}

function onGpsUpdate(lat, lng) {
    currentPosition = { lat, lng };

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
        currentRoute.push({ lat, lng, t: Date.now() });

        // Update route line
        const latlngs = currentRoute.map(p => [p.lat, p.lng]);
        if (currentRouteLine) currentRouteLine.setLatLngs(latlngs);
        else currentRouteLine = L.polyline(latlngs, { color: '#e67e22', weight: 5, opacity: 0.9 }).addTo(map);

        // Mark grid cell visited
        markCellVisited(lat, lng);
        updateTrackingStats();
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
        currentRouteLine.setStyle({ color: '#27ae60', weight: 5, opacity: 0.8 });
        pastRouteLines.push(currentRouteLine);
        currentRouteLine = null;
    }
    currentRoute = [];
    updateGlobalStats();
}

async function loadRoutes() {
    let routes = [];
    if (useFirebase) {
        try {
            const snap = await db.collection('routes').orderBy('startTime', 'desc').limit(100).get();
            routes = snap.docs.map(d => d.data());
        } catch (e) { console.error(e); }
    }
    if (routes.length === 0) {
        routes = JSON.parse(localStorage.getItem('awRoutes') || '[]');
    }

    routes.forEach(r => {
        if (r.coordinates && r.coordinates.length > 1) {
            const latlngs = r.coordinates.map(p => [p.lat, p.lng]);
            const line = L.polyline(latlngs, { color: '#27ae60', weight: 5, opacity: 0.8 }).addTo(map);
            pastRouteLines.push(line);
            r.coordinates.forEach(p => markCellVisited(p.lat, p.lng, true));
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

function markCellVisited(lat, lng, skipSave) {
    const id = getCellId(lat, lng);
    if (!visitedCells[id]) {
        visitedCells[id] = { count: 0, lastVisited: null, user: userName };
    }
    visitedCells[id].count++;
    visitedCells[id].lastVisited = Date.now();

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
