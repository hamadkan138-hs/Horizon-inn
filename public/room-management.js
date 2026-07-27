/* ---------------- Auth plumbing (shared horizonAdminAuth key) ---------------- */
function getAuthHeader() {
    const token = localStorage.getItem('horizonAdminAuth');
    return token ? { Authorization: `Basic ${token}` } : {};
}

async function apiGet(path) {
    const res = await fetch(path, { headers: getAuthHeader() });
    if (res.status === 401) { localStorage.removeItem('horizonAdminAuth'); showLogin(); throw new Error('Unauthorized'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
}

async function apiSend(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
    });
    if (res.status === 401) { localStorage.removeItem('horizonAdminAuth'); showLogin(); throw new Error('Unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

/* ---------------- Helpers ---------------- */
function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }) + ' PKT';
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

/* ---------------- Status metadata ---------------- */
const STATUS_META = {
    available: { label: 'Vacant', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', border: 'border-emerald-400/40' },
    occupied: { label: 'Occupied', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', border: 'border-rose-400/40' },
    reserved: { label: 'Reserved', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', border: 'border-amber-400/40' },
    cleaning: { label: 'Cleaning', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', border: 'border-sky-400/40' },
    maintenance: { label: 'Maintenance', dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', chip: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', border: 'border-orange-400/40' },
    inactive: { label: 'Inactive', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400', border: 'border-slate-400/40' }
};

/* ---------------- Theme ---------------- */
function initTheme() {
    const saved = localStorage.getItem('horizonDashboardTheme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved ? saved === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', dark);
}

document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('horizonDashboardTheme', isDark ? 'dark' : 'light');
});

/* ---------------- Login ---------------- */
const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');

function showLogin() {
    loginPanel.classList.remove('hidden');
    dashboard.classList.add('hidden');
    stopPolling();
}

async function showDashboard() {
    try {
        const me = await apiGet('/api/auth/me');
        document.getElementById('whoami').textContent = me.username;
        loginPanel.classList.add('hidden');
        dashboard.classList.remove('hidden');
        await loadDashboard(true);
        startPolling();
    } catch (err) {
        showLogin();
    }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('rmUser').value;
    const pass = document.getElementById('rmPass').value;
    const token = btoa(`${user}:${pass}`);
    const msg = document.getElementById('loginMessage');
    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) { msg.textContent = 'Invalid username or password.'; return; }
        localStorage.setItem('horizonAdminAuth', token);
        msg.textContent = '';
        showDashboard();
    } catch (err) {
        msg.textContent = 'Network error. Please try again.';
    }
});

document.getElementById('logoutLink').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('horizonAdminAuth');
    showLogin();
});

/* ---------------- Dashboard data ---------------- */
let boardData = [];
let pollTimer = null;
const filters = { search: '', status: 'all', roomType: '' };

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadDashboard(false), 15000);
}
function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
}

async function loadDashboard(populateFilters) {
    try {
        boardData = await apiGet('/api/rooms/dashboard');
        if (populateFilters) populateRoomTypeFilter();
        renderAll();
        document.getElementById('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) { /* handled by apiGet */ }
}

function populateRoomTypeFilter() {
    const select = document.getElementById('roomTypeFilter');
    const current = select.value;
    select.innerHTML = '<option value="">All Room Types</option>' +
        boardData.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    select.value = current;
}

function flattenSlots() {
    const slots = [];
    boardData.forEach((room) => {
        room.slots.forEach((slot) => {
            slots.push({
                roomId: room.id, roomName: room.name, price: room.price, totalUnits: room.totalUnits,
                unit: slot.unit, status: slot.status, booking: slot.booking,
                physicalRoomId: slot.physicalRoomId, roomNumber: slot.roomNumber, floor: slot.floor
            });
        });
    });
    return slots;
}

function matchesSearch(slot, term) {
    if (!term) return true;
    const b = slot.booking;
    const haystack = [slot.roomName, slot.roomNumber, b?.guestName, b?.phone, b?.cnic, b?.invoiceNumber].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(term);
}

function filteredSlots() {
    const term = filters.search.trim().toLowerCase();
    return flattenSlots().filter((slot) => {
        if (filters.status !== 'all' && slot.status !== filters.status) return false;
        if (filters.roomType && String(slot.roomId) !== String(filters.roomType)) return false;
        if (!matchesSearch(slot, term)) return false;
        return true;
    });
}

/* ---------------- Rendering ---------------- */
function renderAll() {
    renderSummary();
    renderStatusChips();
    renderGrid();
}

function renderSummary() {
    const all = flattenSlots();
    const counts = { available: 0, occupied: 0, reserved: 0, cleaning: 0, maintenance: 0, inactive: 0 };
    all.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });

    const cards = [
        { key: 'available', icon: 'fa-door-open', label: 'Vacant' },
        { key: 'occupied', icon: 'fa-bed', label: 'Occupied' },
        { key: 'reserved', icon: 'fa-calendar-check', label: 'Reserved' },
        { key: 'cleaning', icon: 'fa-broom', label: 'Cleaning' },
        { key: 'maintenance', icon: 'fa-screwdriver-wrench', label: 'Maintenance' }
    ];

    document.getElementById('summaryStrip').innerHTML = cards.map((c) => `
        <div class="glass rounded-2xl p-4 flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl flex items-center justify-center ${STATUS_META[c.key].chip}">
                <i class="fa-solid ${c.icon}"></i>
            </div>
            <div>
                <p class="text-2xl font-bold leading-none">${counts[c.key]}</p>
                <p class="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400 mt-1">${c.label}</p>
            </div>
        </div>
    `).join('');
}

function renderStatusChips() {
    const container = document.getElementById('statusChips');
    const options = [
        { key: 'all', label: 'All' },
        { key: 'available', label: 'Vacant' },
        { key: 'occupied', label: 'Occupied' },
        { key: 'reserved', label: 'Reserved' },
        { key: 'cleaning', label: 'Cleaning' },
        { key: 'maintenance', label: 'Maintenance' }
    ];
    container.innerHTML = options.map((o) => {
        const active = filters.status === o.key;
        const base = 'px-3 py-2 rounded-xl transition cursor-pointer select-none';
        const cls = active
            ? 'bg-ink dark:bg-gold text-white dark:text-ink'
            : 'glass hover:bg-black/5 dark:hover:bg-white/10';
        return `<button data-status="${o.key}" class="status-chip ${base} ${cls}">${o.label}</button>`;
    }).join('');
    container.querySelectorAll('.status-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            filters.status = btn.dataset.status;
            renderAll();
        });
    });
}

function slotCardHtml(slot, index) {
    const meta = STATUS_META[slot.status];
    const b = slot.booking;
    const isPhysical = !!slot.physicalRoomId;
    const isOutOfService = slot.status === 'maintenance' || slot.status === 'inactive';

    let body = '';
    if (b) {
        body = `
            <p class="font-semibold truncate">${escapeHtml(b.guestName)}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtml(b.phone || '')}</p>
            <div class="mt-3 text-xs space-y-1 text-slate-500 dark:text-slate-400">
                <div class="flex justify-between"><span>Check-in</span><span class="font-medium text-slate-700 dark:text-slate-200">${b.checkin}</span></div>
                <div class="flex justify-between"><span>Check-out</span><span class="font-medium text-slate-700 dark:text-slate-200">${b.checkout}</span></div>
                ${slot.status === 'occupied' ? `<div class="flex justify-between"><span>Balance</span><span class="font-medium text-slate-700 dark:text-slate-200">${money(Math.max(0, b.totalAmount - b.paidTotal))}</span></div>` : ''}
            </div>
        `;
    } else if (isOutOfService) {
        body = `<p class="font-semibold text-slate-400 dark:text-slate-500">${slot.status === 'maintenance' ? 'Under maintenance' : 'Marked inactive'}</p>`;
    } else {
        body = `
            <p class="font-semibold text-slate-400 dark:text-slate-500">No active booking</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${money(slot.price)} / night</p>
        `;
    }

    const actions = [];
    actions.push(`<button data-action="details" class="flex-1 text-xs font-semibold py-2 rounded-lg glass hover:bg-black/5 dark:hover:bg-white/10">View Details</button>`);
    if (isOutOfService) {
        actions.push(`<button data-action="editRoom" class="flex-1 text-xs font-semibold py-2 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink hover:opacity-90">Edit Room</button>`);
    } else if (slot.status === 'available') {
        actions.push(`<button data-action="assign" class="flex-1 text-xs font-semibold py-2 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink hover:opacity-90">Quick Assign</button>`);
    } else {
        actions.push(`<button data-action="manage" class="flex-1 text-xs font-semibold py-2 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink hover:opacity-90">Manage</button>`);
    }

    const subtitle = isPhysical
        ? `Room ${escapeHtml(slot.roomNumber)}${slot.floor ? ` &middot; Floor ${escapeHtml(slot.floor)}` : ''}`
        : `Unit ${slot.unit} of ${slot.totalUnits}`;

    return `
        <div class="card-enter glass rounded-2xl p-5 border-l-4 ${meta.border} flex flex-col justify-between"
             style="animation-delay:${Math.min(index * 25, 300)}ms"
             data-room-id="${slot.roomId}" data-unit="${slot.unit}" data-status="${slot.status}"
             data-booking-id="${b ? b.id : ''}" data-physical-room-id="${slot.physicalRoomId || ''}">
            <div>
                <div class="flex items-start justify-between mb-2">
                    <div>
                        <p class="text-sm font-semibold">${escapeHtml(slot.roomName)}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">${subtitle}</p>
                    </div>
                    <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${meta.chip}">
                        <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}
                    </span>
                </div>
                ${body}
            </div>
            <div class="flex gap-2 mt-4">${actions.join('')}</div>
        </div>
    `;
}

function renderGrid() {
    const slots = filteredSlots();
    const grid = document.getElementById('roomGrid');
    const empty = document.getElementById('emptyState');

    if (!slots.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = slots.map((slot, i) => slotCardHtml(slot, i)).join('');

    grid.querySelectorAll('[data-action]').forEach((btn) => {
        const card = btn.closest('[data-room-id]');
        const roomId = card.dataset.roomId;
        const unit = Number(card.dataset.unit);
        const slot = boardData.find((r) => String(r.id) === roomId)?.slots.find((s) => s.unit === unit);
        const room = boardData.find((r) => String(r.id) === roomId);

        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'details') openDetailsModal(room, slot);
            if (action === 'manage') openManageDrawer(room, slot);
            if (action === 'assign') openAssignModal(room, slot);
            if (action === 'editRoom') openRoomFormForPhysicalId(slot.physicalRoomId);
        });
    });
}

document.getElementById('searchInput').addEventListener('input', (e) => {
    filters.search = e.target.value;
    renderGrid();
});
document.getElementById('roomTypeFilter').addEventListener('change', (e) => {
    filters.roomType = e.target.value;
    renderGrid();
});

/* ---------------- View Details modal ---------------- */
const detailsOverlay = document.getElementById('detailsModalOverlay');
function openDetailsModal(room, slot) {
    const b = slot.booking;
    const meta = STATUS_META[slot.status];
    const box = document.getElementById('detailsModalBox');

    const subtitle = slot.physicalRoomId
        ? `Room ${escapeHtml(slot.roomNumber)}${slot.floor ? ` · Floor ${escapeHtml(slot.floor)}` : ''}`
        : `Unit ${slot.unit} of ${room.totalUnits}`;

    box.innerHTML = `
        <div class="flex items-start justify-between mb-4">
            <div>
                <h3 class="font-display text-xl font-bold">${escapeHtml(room.name)}</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">${subtitle}</p>
            </div>
            <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${meta.chip}">
                <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}
            </span>
        </div>
        ${b ? `
            <div class="space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Guest</span><span class="font-semibold">${escapeHtml(b.guestName)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Phone</span><span class="font-semibold">${escapeHtml(b.phone || '—')}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">CNIC</span><span class="font-semibold">${escapeHtml(b.cnic || '—')}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Invoice #</span><span class="font-semibold">${escapeHtml(b.invoiceNumber || '—')}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Check-in</span><span class="font-semibold">${b.checkin}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Check-out</span><span class="font-semibold">${b.checkout}</span></div>
                ${slot.status === 'occupied' ? `<div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Checked in at</span><span class="font-semibold">${formatPKT(b.createdAt)}</span></div>` : ''}
                ${slot.status === 'cleaning' ? `<div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Checked out at</span><span class="font-semibold">${formatPKT(b.checkedOutAt)}</span></div>` : ''}
                <div class="border-t border-black/10 dark:border-white/10 pt-2 mt-2 flex justify-between"><span class="text-slate-500 dark:text-slate-400">Total</span><span class="font-semibold">${money(b.totalAmount)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Paid</span><span class="font-semibold">${money(b.paidTotal)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Balance</span><span class="font-semibold">${money(Math.max(0, b.totalAmount - b.paidTotal))}</span></div>
            </div>
        ` : slot.status === 'maintenance' ? `
            <p class="text-sm text-slate-500 dark:text-slate-400">This room is currently under maintenance and won't be offered for booking.</p>
        ` : slot.status === 'inactive' ? `
            <p class="text-sm text-slate-500 dark:text-slate-400">This room is marked inactive.</p>
        ` : `
            <p class="text-sm text-slate-500 dark:text-slate-400">This unit is vacant and ready for a new guest.</p>
            <p class="text-sm mt-3"><span class="text-slate-500 dark:text-slate-400">Rate</span> <span class="font-semibold">${money(room.price)} / night</span></p>
        `}
        <button id="closeDetailsBtn" class="w-full mt-6 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-black/5 dark:hover:bg-white/10">Close</button>
    `;
    box.querySelector('#closeDetailsBtn').addEventListener('click', () => detailsOverlay.classList.add('hidden'));
    detailsOverlay.classList.remove('hidden');
    detailsOverlay.classList.add('flex');
}
detailsOverlay.addEventListener('click', (e) => { if (e.target === detailsOverlay) detailsOverlay.classList.add('hidden'); });

/* ---------------- Manage drawer ---------------- */
const manageOverlay = document.getElementById('manageOverlay');
const manageDrawer = document.getElementById('manageDrawer');

function closeManageDrawer() {
    manageDrawer.classList.add('translate-x-full');
    setTimeout(() => manageOverlay.classList.add('hidden'), 250);
}

function openManageDrawer(room, slot) {
    const b = slot.booking;
    const meta = STATUS_META[slot.status];
    let actionsHtml = '';

    if (slot.status === 'occupied') {
        actionsHtml = `<button id="manageCheckoutBtn" class="w-full py-3 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink font-semibold hover:opacity-90 transition">Check-Out Guest</button>`;
    } else if (slot.status === 'reserved') {
        actionsHtml = `
            <button id="manageCheckinBtn" class="w-full py-3 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink font-semibold hover:opacity-90 transition">Check-In Now</button>
            <button id="manageCancelBtn" class="w-full py-3 rounded-lg border border-red-400 text-red-500 font-semibold hover:bg-red-500/10 transition">Cancel Reservation</button>
        `;
    } else if (slot.status === 'cleaning') {
        actionsHtml = `<button id="manageCleanBtn" class="w-full py-3 rounded-lg bg-ink dark:bg-gold text-white dark:text-ink font-semibold hover:opacity-90 transition">Mark Room Clean</button>`;
    }

    manageDrawer.innerHTML = `
        <div class="flex items-start justify-between mb-6">
            <div>
                <h3 class="font-display text-xl font-bold">${escapeHtml(room.name)}</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">Unit ${slot.unit} &middot; ${meta.label}</p>
            </div>
            <button id="closeManageBtn" class="w-8 h-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${b ? `
            <div class="rounded-xl bg-black/5 dark:bg-white/5 p-4 mb-6 space-y-1.5 text-sm">
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Guest</span><span class="font-semibold">${escapeHtml(b.guestName)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Phone</span><span class="font-semibold">${escapeHtml(b.phone || '—')}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Stay</span><span class="font-semibold">${b.checkin} &rarr; ${b.checkout}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Total</span><span class="font-semibold">${money(b.totalAmount)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Paid</span><span class="font-semibold">${money(b.paidTotal)}</span></div>
            </div>
        ` : ''}
        <div class="space-y-3">${actionsHtml}</div>
        <p id="manageMessage" class="text-sm mt-4 min-h-[1.2em]"></p>
    `;

    manageDrawer.querySelector('#closeManageBtn').addEventListener('click', closeManageDrawer);

    const msg = manageDrawer.querySelector('#manageMessage');

    const checkoutBtn = manageDrawer.querySelector('#manageCheckoutBtn');
    if (checkoutBtn) checkoutBtn.addEventListener('click', () => { closeManageDrawer(); openCheckoutModal(room, slot); });

    const checkinBtn = manageDrawer.querySelector('#manageCheckinBtn');
    if (checkinBtn) checkinBtn.addEventListener('click', async () => {
        checkinBtn.disabled = true;
        try {
            await apiSend('PATCH', `/api/bookings/${b.id}`, { status: 'checked_in' });
            closeManageDrawer();
            loadDashboard(false);
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'text-sm mt-4 text-red-500';
            checkinBtn.disabled = false;
        }
    });

    const cancelBtn = manageDrawer.querySelector('#manageCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this reservation? This frees the room immediately.')) return;
        cancelBtn.disabled = true;
        try {
            await apiSend('PATCH', `/api/bookings/${b.id}`, { status: 'cancelled' });
            closeManageDrawer();
            loadDashboard(false);
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'text-sm mt-4 text-red-500';
            cancelBtn.disabled = false;
        }
    });

    const cleanBtn = manageDrawer.querySelector('#manageCleanBtn');
    if (cleanBtn) cleanBtn.addEventListener('click', async () => {
        cleanBtn.disabled = true;
        try {
            await apiSend('PATCH', `/api/bookings/${b.id}/cleaning`, {});
            closeManageDrawer();
            loadDashboard(false);
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'text-sm mt-4 text-red-500';
            cleanBtn.disabled = false;
        }
    });

    manageOverlay.classList.remove('hidden');
    requestAnimationFrame(() => manageDrawer.classList.remove('translate-x-full'));
}
manageOverlay.addEventListener('click', (e) => { if (e.target === manageOverlay) closeManageDrawer(); });

/* ---------------- Quick Assign modal (auto-suggest) ---------------- */
const assignOverlay = document.getElementById('assignOverlay');
let assignPreferredRoomId = null;

function openAssignModal(room, slot) {
    assignPreferredRoomId = room ? room.id : null;
    document.getElementById('assignForm').reset();
    document.getElementById('assignCheckin').value = todayStr();
    document.getElementById('assignCheckout').value = tomorrowStr();
    document.getElementById('assignCheckInNow').checked = true;
    document.getElementById('assignRoomId').value = '';
    document.getElementById('assignSubmitBtn').disabled = true;
    document.getElementById('assignMessage').textContent = '';
    refreshSuggestions();
    assignOverlay.classList.remove('hidden');
    assignOverlay.classList.add('flex');
}

document.getElementById('closeAssignBtn').addEventListener('click', () => assignOverlay.classList.add('hidden'));
assignOverlay.addEventListener('click', (e) => { if (e.target === assignOverlay) assignOverlay.classList.add('hidden'); });

['assignCheckin', 'assignCheckout', 'assignGuests'].forEach((id) => {
    document.getElementById(id).addEventListener('change', refreshSuggestions);
});

async function refreshSuggestions() {
    const checkin = document.getElementById('assignCheckin').value;
    const checkout = document.getElementById('assignCheckout').value;
    const guests = document.getElementById('assignGuests').value || 1;
    const list = document.getElementById('suggestionList');

    if (!checkin || !checkout || checkin >= checkout) {
        list.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Enter valid dates to see suggestions.</p>';
        return;
    }

    list.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Finding available rooms&hellip;</p>';
    try {
        const rooms = await apiGet(`/api/rooms?checkin=${checkin}&checkout=${checkout}&guests=${guests}`);
        let available = rooms.filter((r) => r.available);
        available = available.sort((a, b) => {
            if (assignPreferredRoomId) {
                if (a.id === assignPreferredRoomId) return -1;
                if (b.id === assignPreferredRoomId) return 1;
            }
            return a.price - b.price;
        });

        if (!available.length) {
            list.innerHTML = '<p class="text-sm text-red-500">No rooms available for these dates.</p>';
            document.getElementById('assignRoomId').value = '';
            document.getElementById('assignSubmitBtn').disabled = true;
            return;
        }

        list.innerHTML = available.map((r) => `
            <label class="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-gold transition suggestion-row" data-room-id="${r.id}">
                <div class="flex items-center gap-2">
                    <input type="radio" name="suggestedRoom" value="${r.id}" class="accent-gold" ${r.id === assignPreferredRoomId ? 'checked' : ''}>
                    <div>
                        <p class="text-sm font-semibold">${escapeHtml(r.name)}${r.id === assignPreferredRoomId ? ' <span class=\"text-[10px] uppercase text-gold\">Selected</span>' : ''}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400">${money(r.price)} / night</p>
                    </div>
                </div>
                <i class="fa-solid fa-circle-check text-gold ${r.id === assignPreferredRoomId ? '' : 'opacity-0'}"></i>
            </label>
        `).join('');

        list.querySelectorAll('.suggestion-row').forEach((row) => {
            row.addEventListener('click', () => {
                document.getElementById('assignRoomId').value = row.dataset.roomId;
                list.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = String(r.value) === row.dataset.roomId; });
                list.querySelectorAll('.fa-circle-check').forEach((icon) => icon.classList.add('opacity-0'));
                row.querySelector('.fa-circle-check').classList.remove('opacity-0');
                document.getElementById('assignSubmitBtn').disabled = false;
            });
        });

        if (available.some((r) => r.id === assignPreferredRoomId)) {
            document.getElementById('assignRoomId').value = assignPreferredRoomId;
            document.getElementById('assignSubmitBtn').disabled = false;
        } else {
            document.getElementById('assignRoomId').value = '';
            document.getElementById('assignSubmitBtn').disabled = true;
        }
    } catch (err) {
        list.innerHTML = `<p class="text-sm text-red-500">${err.message}</p>`;
    }
}

document.getElementById('assignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('assignMessage');
    const roomId = document.getElementById('assignRoomId').value;
    if (!roomId) { msg.textContent = 'Select an available room first.'; msg.className = 'text-sm min-h-[1.2em] text-red-500'; return; }

    const submitBtn = document.getElementById('assignSubmitBtn');
    submitBtn.disabled = true;
    msg.textContent = '';
    try {
        await apiSend('POST', '/api/bookings/quick', {
            guestName: document.getElementById('assignName').value,
            phone: document.getElementById('assignPhone').value,
            cnic: document.getElementById('assignCnic').value,
            roomId,
            checkin: document.getElementById('assignCheckin').value,
            checkout: document.getElementById('assignCheckout').value,
            checkInNow: document.getElementById('assignCheckInNow').checked
        });
        assignOverlay.classList.add('hidden');
        loadDashboard(false);
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm min-h-[1.2em] text-red-500';
        submitBtn.disabled = false;
    }
});

/* ---------------- Checkout modal ---------------- */
const checkoutOverlay = document.getElementById('checkoutOverlay');
let checkoutBookingId = null;

function renderCheckoutSummary(b) {
    const balance = Math.max(0, b.totalAmount - b.paidTotal);
    document.getElementById('checkoutSummary').innerHTML = `
        <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Total Charges</span><span class="font-semibold">${money(b.totalAmount)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500 dark:text-slate-400">Already Paid</span><span class="font-semibold">${money(b.paidTotal)}</span></div>
        <div class="flex justify-between border-t border-black/10 dark:border-white/10 pt-1.5 mt-1"><span class="font-semibold">Balance Due</span><span class="font-bold">${money(balance)}</span></div>
    `;
    document.getElementById('checkoutAmount').value = balance > 0 ? balance.toFixed(2) : 0;
}

function openCheckoutModal(room, slot) {
    const b = slot.booking;
    checkoutBookingId = b.id;
    document.getElementById('checkoutSubtitle').textContent = `${b.guestName} — ${room.name} (${b.checkin} to ${b.checkout})`;
    document.getElementById('checkoutMessage').textContent = '';
    renderCheckoutSummary(b);
    checkoutOverlay.classList.remove('hidden');
    checkoutOverlay.classList.add('flex');
}

document.getElementById('closeCheckoutBtn').addEventListener('click', () => checkoutOverlay.classList.add('hidden'));
checkoutOverlay.addEventListener('click', (e) => { if (e.target === checkoutOverlay) checkoutOverlay.classList.add('hidden'); });

document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('checkoutMessage');
    const amount = Number(document.getElementById('checkoutAmount').value || 0);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    msg.textContent = '';
    try {
        const result = await apiSend('POST', `/api/bookings/${checkoutBookingId}/checkout`, {
            amount: amount > 0 ? amount : undefined,
            method: document.getElementById('checkoutMethod').value
        });
        checkoutOverlay.classList.add('hidden');
        loadDashboard(false);
        const when = formatPKT(result.booking.checked_out_at);
        msg.textContent = '';
        setTimeout(() => alert(`Payment recorded successfully at ${when}`), 100);
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm min-h-[1.2em] text-red-500';
    } finally {
        submitBtn.disabled = false;
    }
});

/* ---------------- Room Inventory (CRUD) ---------------- */
let inventoryRooms = [];
let roomTypeOptionsCache = [];

async function fetchRoomTypeOptions() {
    roomTypeOptionsCache = await apiGet('/api/rooms?includeInactive=1');
    return roomTypeOptionsCache;
}

function populateRoomFormTypeSelect(selectedId) {
    const select = document.getElementById('roomFormType');
    select.innerHTML = roomTypeOptionsCache.map((r) =>
        `<option value="${r.id}">${escapeHtml(r.name)} (${money(r.price)}/night)</option>`
    ).join('');
    if (selectedId) select.value = selectedId;
}

const inventoryOverlay = document.getElementById('inventoryOverlay');

async function openInventory() {
    inventoryOverlay.classList.remove('hidden');
    inventoryOverlay.classList.add('flex');
    await loadInventory();
}
function closeInventory() {
    inventoryOverlay.classList.add('hidden');
}
document.getElementById('manageRoomsBtn').addEventListener('click', openInventory);
document.getElementById('closeInventoryBtn').addEventListener('click', closeInventory);
inventoryOverlay.addEventListener('click', (e) => { if (e.target === inventoryOverlay) closeInventory(); });

async function loadInventory() {
    try {
        inventoryRooms = await apiGet('/api/physical-rooms');
        renderInventoryTable();
    } catch (err) { /* handled by apiGet */ }
}

function inventoryRowHtml(r) {
    const meta = STATUS_META[r.status] || STATUS_META.available;
    const rate = r.priceOverride !== null ? money(r.priceOverride) : `${money(r.categoryPrice)} <span class="text-slate-400">(default)</span>`;
    const amenities = r.amenities.length ? r.amenities.join(', ') : '—';
    return `
        <tr class="border-b border-black/5 dark:border-white/5" data-id="${r.id}">
            <td class="py-2.5 pr-3 font-semibold">${escapeHtml(r.roomNumber)}</td>
            <td class="py-2.5 pr-3">${escapeHtml(r.roomTypeName)}</td>
            <td class="py-2.5 pr-3">${escapeHtml(r.floor || '—')}</td>
            <td class="py-2.5 pr-3">${rate}</td>
            <td class="py-2.5 pr-3 max-w-[180px] truncate" title="${escapeHtml(amenities)}">${escapeHtml(amenities)}</td>
            <td class="py-2.5 pr-3">
                <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.chip}">
                    <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}
                </span>
            </td>
            <td class="py-2.5 pr-3 text-right whitespace-nowrap">
                <button data-edit="${r.id}" class="text-xs font-semibold px-2.5 py-1.5 rounded-lg glass hover:bg-black/5 dark:hover:bg-white/10 mr-1.5">Edit</button>
                <button data-delete="${r.id}" class="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-400 text-red-500 hover:bg-red-500/10">Delete</button>
            </td>
        </tr>
    `;
}

function renderInventoryTable() {
    const body = document.getElementById('inventoryBody');
    const empty = document.getElementById('inventoryEmpty');
    if (!inventoryRooms.length) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    body.innerHTML = inventoryRooms.map(inventoryRowHtml).join('');

    body.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const room = inventoryRooms.find((r) => String(r.id) === btn.dataset.edit);
            if (room) openRoomForm('edit', room);
        });
    });
    body.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', () => handleDeleteRoom(btn.dataset.delete));
    });
}

async function handleDeleteRoom(id) {
    const room = inventoryRooms.find((r) => String(r.id) === String(id));
    const label = room ? `Room ${room.roomNumber}` : 'this room';
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
        await apiSend('DELETE', `/api/physical-rooms/${id}`, {});
        await loadInventory();
        loadDashboard(false);
    } catch (err) {
        alert(err.message);
    }
}

/* ---------------- Add / Edit Room modal ---------------- */
const roomFormOverlay = document.getElementById('roomFormOverlay');

function validateRoomForm() {
    const number = document.getElementById('roomFormNumber').value.trim();
    const typeId = document.getElementById('roomFormType').value;
    const numberError = document.getElementById('roomFormNumberError');
    const typeError = document.getElementById('roomFormTypeError');

    let valid = true;
    if (!number) { numberError.textContent = 'Room number is required.'; valid = false; } else { numberError.textContent = ''; }
    if (!typeId) { typeError.textContent = 'Select a category.'; valid = false; } else { typeError.textContent = ''; }

    document.getElementById('roomFormSubmitBtn').disabled = !valid;
    return valid;
}

document.getElementById('roomFormNumber').addEventListener('input', validateRoomForm);
document.getElementById('roomFormType').addEventListener('change', validateRoomForm);

async function openRoomForm(mode, room) {
    document.getElementById('roomForm').reset();
    document.getElementById('roomFormMessage').textContent = '';
    document.getElementById('roomFormNumberError').textContent = '';
    document.getElementById('roomFormTypeError').textContent = '';
    document.getElementById('roomFormId').value = room ? room.id : '';
    document.getElementById('roomFormTitle').textContent = mode === 'edit' ? `Edit Room ${room.roomNumber}` : 'Add New Room';
    document.getElementById('roomFormSubmitBtn').textContent = mode === 'edit' ? 'Save Changes' : 'Add Room';

    await fetchRoomTypeOptions();
    populateRoomFormTypeSelect(room ? room.roomTypeId : (roomTypeOptionsCache[0] && roomTypeOptionsCache[0].id));

    if (room) {
        document.getElementById('roomFormNumber').value = room.roomNumber;
        document.getElementById('roomFormFloor').value = room.floor || '';
        document.getElementById('roomFormPrice').value = room.priceOverride !== null ? room.priceOverride : '';
        document.getElementById('roomFormAmenities').value = room.amenities.join(', ');
        document.getElementById('roomFormStatus').value = room.status;
    }

    validateRoomForm();
    roomFormOverlay.classList.remove('hidden');
    roomFormOverlay.classList.add('flex');
}

async function openRoomFormForPhysicalId(id) {
    if (!id) return;
    let room = inventoryRooms.find((r) => String(r.id) === String(id));
    if (!room) {
        await loadInventory();
        room = inventoryRooms.find((r) => String(r.id) === String(id));
    }
    if (room) openRoomForm('edit', room);
}

document.getElementById('addRoomBtn').addEventListener('click', () => openRoomForm('add', null));
document.getElementById('inventoryAddBtn').addEventListener('click', () => openRoomForm('add', null));
document.getElementById('closeRoomFormBtn').addEventListener('click', () => roomFormOverlay.classList.add('hidden'));
roomFormOverlay.addEventListener('click', (e) => { if (e.target === roomFormOverlay) roomFormOverlay.classList.add('hidden'); });

document.getElementById('roomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateRoomForm()) return;

    const id = document.getElementById('roomFormId').value;
    const msg = document.getElementById('roomFormMessage');
    const submitBtn = document.getElementById('roomFormSubmitBtn');
    const amenities = document.getElementById('roomFormAmenities').value
        .split(',').map((a) => a.trim()).filter(Boolean);
    const priceValue = document.getElementById('roomFormPrice').value;

    const payload = {
        roomNumber: document.getElementById('roomFormNumber').value.trim(),
        roomTypeId: Number(document.getElementById('roomFormType').value),
        floor: document.getElementById('roomFormFloor').value.trim(),
        priceOverride: priceValue === '' ? '' : Number(priceValue),
        amenities,
        status: document.getElementById('roomFormStatus').value
    };

    submitBtn.disabled = true;
    msg.textContent = '';
    msg.className = 'text-sm min-h-[1.2em]';
    try {
        if (id) {
            await apiSend('PATCH', `/api/physical-rooms/${id}`, payload);
        } else {
            await apiSend('POST', '/api/physical-rooms', payload);
        }
        roomFormOverlay.classList.add('hidden');
        await loadInventory();
        loadDashboard(true);
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm min-h-[1.2em] text-red-500';
    } finally {
        submitBtn.disabled = false;
    }
});

/* ---------------- Boot ---------------- */
initTheme();
if (localStorage.getItem('horizonAdminAuth')) {
    showDashboard();
} else {
    showLogin();
}
