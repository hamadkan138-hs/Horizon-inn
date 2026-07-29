const loginPanel = document.getElementById('loginPanel');
const kiosk = document.getElementById('kiosk');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

const states = {
    idInput: document.getElementById('stateIdInput'),
    guestFound: document.getElementById('stateGuestFound'),
    newGuest: document.getElementById('stateNewGuest'),
    checkedIn: document.getElementById('stateCheckedIn')
};

let activeBooking = null; // currently checked-in booking shown in stateCheckedIn

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

function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function whatsappLink(booking) {
    let digits = (booking.phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
    const text = `Hello ${booking.name}, this is Horizon Inn regarding your booking request for ${booking.room_name}, ${booking.checkin} to ${booking.checkout}. Total: ${money(booking.total_amount)}.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Every timestamp is stored in UTC (SQLite's datetime('now')); Horizon Inn
// runs on Pakistan time, so always render it explicitly in that zone.
function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }) + ' PKT';
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

/* ---------------- Login ---------------- */
function showLogin() {
    loginPanel.style.display = 'block';
    kiosk.style.display = 'none';
}

async function showKiosk() {
    try {
        const me = await apiGet('/api/auth/me');
        document.getElementById('whoami').textContent = me.username;
        loginPanel.style.display = 'none';
        kiosk.style.display = 'block';
        goToIdInput();
        startRequestsPolling();
    } catch (err) {
        showLogin();
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('fdUser').value;
    const pass = document.getElementById('fdPass').value;
    const token = btoa(`${user}:${pass}`);
    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) {
            loginMessage.textContent = res.status === 429
                ? (await res.json().catch(() => ({}))).error || 'Too many failed attempts. Please try again later.'
                : 'Invalid username or password.';
            return;
        }
        localStorage.setItem('horizonAdminAuth', token);
        loginMessage.textContent = '';
        showKiosk();
    } catch (err) {
        loginMessage.textContent = 'Network error. Please try again.';
    }
});

document.getElementById('switchAccountLink').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('horizonAdminAuth');
    showLogin();
});

/* ---------------- New booking requests (online bookings awaiting review) ---------------- */
let requestsPollTimer = null;

async function refreshRequestsBadge() {
    try {
        const data = await apiGet('/api/bookings?status=pending');
        const badge = document.getElementById('fdRequestsBadge');
        badge.textContent = data.total;
        badge.style.display = data.total > 0 ? 'flex' : 'none';
    } catch (err) { /* best-effort */ }
}

function startRequestsPolling() {
    refreshRequestsBadge();
    clearInterval(requestsPollTimer);
    requestsPollTimer = setInterval(refreshRequestsBadge, 60000);
}

function requestRowHtml(b) {
    return `
        <div class="kiosk-request-card">
            <div>
                <strong>${escapeHtml(b.name)}</strong> &middot; ${escapeHtml(b.room_name)}<br>
                <span style="color: var(--text-light); font-size: 0.85rem;">
                    ${b.checkin} &rarr; ${b.checkout} &middot; ${b.guests} guest(s) &middot; ${money(b.total_amount)} &middot; ${escapeHtml(b.phone)}
                </span>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <a class="action-btn confirm" href="${whatsappLink(b)}" target="_blank" rel="noopener">WhatsApp</a>
                <button class="action-btn confirm fd-accept-btn" data-id="${b.id}">Accept</button>
                <button class="action-btn cancel fd-reject-btn" data-id="${b.id}" data-name="${escapeHtml(b.name)}">Reject</button>
            </div>
        </div>
    `;
}

async function loadRequestsModal() {
    const list = document.getElementById('fdRequestsList');
    list.innerHTML = '<p style="color: var(--text-light);">Loading&hellip;</p>';
    try {
        const data = await apiGet('/api/bookings?status=pending');
        list.innerHTML = data.bookings.map(requestRowHtml).join('') || '<p style="color: var(--text-light);">No new booking requests right now.</p>';

        list.querySelectorAll('.fd-accept-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await apiSend('PATCH', `/api/bookings/${btn.dataset.id}`, { status: 'confirmed' });
                    loadRequestsModal();
                    refreshRequestsBadge();
                } catch (err) { alert(err.message); btn.disabled = false; }
            });
        });
        list.querySelectorAll('.fd-reject-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Reject ${btn.dataset.name}'s booking request? This can't be undone from here.`)) return;
                const reason = prompt('Reason for rejecting (optional):', '') || '';
                btn.disabled = true;
                try {
                    await apiSend('PATCH', `/api/bookings/${btn.dataset.id}`, { status: 'cancelled', reason });
                    loadRequestsModal();
                    refreshRequestsBadge();
                } catch (err) { alert(err.message); btn.disabled = false; }
            });
        });
    } catch (err) {
        list.innerHTML = `<p class="form-message error">${escapeHtml(err.message)}</p>`;
    }
}

document.getElementById('fdRequestsBtn').addEventListener('click', () => {
    document.getElementById('fdRequestsModalOverlay').style.display = 'flex';
    loadRequestsModal();
});
document.getElementById('fdCloseRequestsModalBtn').addEventListener('click', () => {
    document.getElementById('fdRequestsModalOverlay').style.display = 'none';
});

/* ---------------- Room availability board ---------------- */
const FD_ROOM_STATUS_META = {
    available: { label: 'Available', icon: 'fa-circle-check' },
    occupied: { label: 'Occupied', icon: 'fa-bed' },
    booked: { label: 'Booked (Locked)', icon: 'fa-lock' }
};

async function loadAvailabilityBoard() {
    const board = document.getElementById('fdAvailabilityBoard');
    board.innerHTML = '<p style="color: var(--text-light);">Loading&hellip;</p>';
    try {
        const rooms = await apiGet('/api/rooms/status-board');
        board.innerHTML = rooms.map((r) => {
            const meta = FD_ROOM_STATUS_META[r.status];
            const dates = r.booking ? `${r.booking.checkin} &rarr; ${r.booking.checkout}` : 'No upcoming stay';
            const guestLine = r.booking && r.status !== 'available' ? `<div class="room-status-dates">${escapeHtml(r.booking.guestName)}</div>` : '';
            return `
                <div class="room-status-card ${r.status}">
                    <h4>${escapeHtml(r.name)}</h4>
                    <span class="room-status-badge ${r.status}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>
                    <div class="room-status-dates">${dates}</div>
                    ${guestLine}
                </div>
            `;
        }).join('');
    } catch (err) {
        board.innerHTML = `<p class="form-message error">${escapeHtml(err.message)}</p>`;
    }
}

document.getElementById('fdAvailabilityBtn').addEventListener('click', () => {
    document.getElementById('fdAvailabilityModalOverlay').style.display = 'flex';
    loadAvailabilityBoard();
});
document.getElementById('fdCloseAvailabilityModalBtn').addEventListener('click', () => {
    document.getElementById('fdAvailabilityModalOverlay').style.display = 'none';
});

/* ---------------- State machine ---------------- */
function showState(name) {
    Object.values(states).forEach((el) => { el.style.display = 'none'; });
    states[name].style.display = 'block';
}

function goToIdInput() {
    showState('idInput');
    activeBooking = null;
    const form = document.getElementById('idForm');
    form.reset();
    document.getElementById('idMessage').textContent = '';
    document.getElementById('idInput').focus();
}

async function populateRoomSelect(selectEl, checkin, checkout) {
    selectEl.innerHTML = '<option value="">Loading rooms&hellip;</option>';
    try {
        const rooms = await apiGet(`/api/rooms?checkin=${checkin}&checkout=${checkout}`);
        const available = rooms.filter((r) => r.available);
        if (!available.length) {
            selectEl.innerHTML = '<option value="">No rooms available for these dates</option>';
            return;
        }
        selectEl.innerHTML = available.map((r) =>
            `<option value="${r.id}">${r.name}${r.price ? ` &mdash; ${money(r.price)}/night` : ''}</option>`
        ).join('');
    } catch (err) {
        selectEl.innerHTML = '<option value="">Failed to load rooms</option>';
    }
}

/* STATE 1: ID input */
document.getElementById('idForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cnic = document.getElementById('idInput').value.trim();
    const msg = document.getElementById('idMessage');
    msg.textContent = '';
    if (!cnic) return;

    try {
        const result = await apiGet(`/api/guests/lookup?cnic=${encodeURIComponent(cnic)}`);

        if (result.activeBooking) {
            showCheckedInState(result.activeBooking, result.name || cnic);
            return;
        }

        if (result.found) {
            showGuestFoundState(cnic, result);
        } else {
            showNewGuestState(cnic);
        }
    } catch (err) {
        msg.textContent = err.message;
    }
});

document.getElementById('backFromFound').addEventListener('click', goToIdInput);
document.getElementById('backFromNew').addEventListener('click', goToIdInput);
document.getElementById('backFromCheckedIn').addEventListener('click', goToIdInput);

/* STATE 2a: Existing guest found, not currently staying */
function showGuestFoundState(cnic, info) {
    showState('guestFound');
    document.getElementById('foundName').textContent = info.name || '—';
    document.getElementById('foundPhone').textContent = info.phone || '—';
    document.getElementById('foundVisits').textContent = info.visitCount || 0;
    document.getElementById('foundLastStay').textContent = info.lastStay || '—';
    document.getElementById('foundMessage').textContent = '';

    const form = document.getElementById('foundCheckinForm');
    form.dataset.cnic = cnic;
    form.dataset.name = info.name || '';
    form.dataset.phone = info.phone || '';
    form.dataset.address = info.address || '';

    const checkinInput = document.getElementById('foundCheckin');
    const checkoutInput = document.getElementById('foundCheckout');
    checkinInput.value = today();
    checkoutInput.value = tomorrow();

    const roomSelect = document.getElementById('foundRoomId');
    populateRoomSelect(roomSelect, checkinInput.value, checkoutInput.value);

    const refreshRooms = () => {
        if (checkinInput.value && checkoutInput.value && checkinInput.value < checkoutInput.value) {
            populateRoomSelect(roomSelect, checkinInput.value, checkoutInput.value);
        }
    };
    checkinInput.onchange = refreshRooms;
    checkoutInput.onchange = refreshRooms;
}

document.getElementById('foundCheckinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('foundMessage');
    const roomId = document.getElementById('foundRoomId').value;
    const checkin = document.getElementById('foundCheckin').value;
    const checkout = document.getElementById('foundCheckout').value;
    msg.textContent = '';

    if (!roomId) { msg.textContent = 'Please select an available room.'; return; }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
        const result = await apiSend('POST', '/api/bookings/quick', {
            guestName: form.dataset.name,
            phone: form.dataset.phone,
            cnic: form.dataset.cnic,
            address: form.dataset.address,
            roomId, checkin, checkout,
            checkInNow: true
        });
        showCheckedInState({
            id: result.booking.id,
            roomName: '',
            roomId,
            checkin: result.booking.checkin,
            checkout: result.booking.checkout,
            createdAt: result.booking.created_at,
            totalAmount: Number(result.booking.total_amount),
            paidTotal: 0
        }, result.booking.name);
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        submitBtn.disabled = false;
    }
});

/* STATE 2b: New guest */
function showNewGuestState(cnic) {
    showState('newGuest');
    document.getElementById('newCnic').value = cnic;
    document.getElementById('newGuestForm').reset();
    document.getElementById('newCnic').value = cnic;
    document.getElementById('newGuestMessage').textContent = '';

    const checkinInput = document.getElementById('newCheckin');
    const checkoutInput = document.getElementById('newCheckout');
    checkinInput.value = today();
    checkoutInput.value = tomorrow();

    const roomSelect = document.getElementById('newRoomId');
    populateRoomSelect(roomSelect, checkinInput.value, checkoutInput.value);

    const refreshRooms = () => {
        if (checkinInput.value && checkoutInput.value && checkinInput.value < checkoutInput.value) {
            populateRoomSelect(roomSelect, checkinInput.value, checkoutInput.value);
        }
    };
    checkinInput.onchange = refreshRooms;
    checkoutInput.onchange = refreshRooms;
}

document.getElementById('newGuestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('newGuestMessage');
    const roomId = document.getElementById('newRoomId').value;
    const checkin = document.getElementById('newCheckin').value;
    const checkout = document.getElementById('newCheckout').value;
    msg.textContent = '';

    if (!roomId) { msg.textContent = 'Please select an available room.'; return; }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
        const result = await apiSend('POST', '/api/bookings/quick', {
            guestName: document.getElementById('newName').value,
            email: document.getElementById('newEmail').value,
            phone: document.getElementById('newPhone').value,
            cnic: document.getElementById('newCnic').value,
            maritalStatus: document.getElementById('newMaritalStatus').value,
            guests: document.getElementById('newGuestsCount').value,
            address: document.getElementById('newAddress').value,
            purposeOfStay: document.getElementById('newPurposeOfStay').value,
            arrivalTime: document.getElementById('newArrivalTime').value,
            vehicleNumber: document.getElementById('newVehicleNumber').value,
            arrivalFrom: document.getElementById('newArrivalFrom').value,
            departureTo: document.getElementById('newDepartureTo').value,
            roomId, checkin, checkout,
            checkInNow: true
        });
        showCheckedInState({
            id: result.booking.id,
            roomName: '',
            roomId,
            checkin: result.booking.checkin,
            checkout: result.booking.checkout,
            createdAt: result.booking.created_at,
            totalAmount: Number(result.booking.total_amount),
            paidTotal: 0
        }, result.booking.name);
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        submitBtn.disabled = false;
    }
});

/* STATE 3: Already checked in */
async function showCheckedInState(booking, guestName) {
    showState('checkedIn');
    activeBooking = booking;

    let roomName = booking.roomName;
    if (!roomName && booking.roomId) {
        try {
            const rooms = await apiGet('/api/rooms');
            const room = rooms.find((r) => String(r.id) === String(booking.roomId));
            roomName = room ? room.name : `Room #${booking.roomId}`;
        } catch (err) { roomName = `Room #${booking.roomId}`; }
    }
    booking.roomName = roomName;

    document.getElementById('checkedInGuestName').textContent = guestName || '';
    document.getElementById('checkedInRoom').textContent = roomName || '—';
    document.getElementById('checkedInTime').textContent = formatPKT(booking.createdAt);
    document.getElementById('checkedInExpected').textContent = booking.checkout || '—';
    document.getElementById('sendInvoiceMessage').textContent = '';
}

/* ---------------- Send invoice (email / WhatsApp) ---------------- */
document.getElementById('sendInvoiceEmailBtn').addEventListener('click', async () => {
    if (!activeBooking) return;
    const btn = document.getElementById('sendInvoiceEmailBtn');
    const msg = document.getElementById('sendInvoiceMessage');
    btn.disabled = true;
    msg.className = 'form-message';
    msg.textContent = 'Sending…';
    try {
        await apiSend('POST', `/api/bookings/${activeBooking.id}/send-invoice-email`, {});
        msg.className = 'form-message success';
        msg.textContent = 'Invoice emailed to the guest.';
    } catch (err) {
        msg.className = 'form-message error';
        msg.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});

document.getElementById('sendInvoiceWhatsappBtn').addEventListener('click', async () => {
    if (!activeBooking) return;
    const btn = document.getElementById('sendInvoiceWhatsappBtn');
    const msg = document.getElementById('sendInvoiceMessage');
    btn.disabled = true;
    try {
        const info = await apiGet(`/api/bookings/${activeBooking.id}/invoice-link`);
        let digits = (info.phone || '').replace(/\D/g, '');
        if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
        const text = `Hello ${info.name}, here's your Horizon Inn invoice (${info.invoiceNumber}): ${info.link}`;
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        msg.className = 'form-message success';
        msg.textContent = 'WhatsApp opened with the invoice link ready to send.';
    } catch (err) {
        msg.className = 'form-message error';
        msg.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});

document.getElementById('openCheckoutBtn').addEventListener('click', () => {
    if (activeBooking) openFdCheckoutModal(activeBooking);
});

/* ---------------- Checkout modal ---------------- */
const fdOverlay = document.getElementById('fdCheckoutModalOverlay');

function fdRenderSummary(booking) {
    const paidTotal = Number(booking.paidTotal || 0);
    const total = Number(booking.totalAmount || 0);
    const balance = Math.max(0, total - paidTotal);
    document.getElementById('fdCheckoutSummary').innerHTML = `
        <div><span>Check-In</span><span>${booking.checkin}</span></div>
        <div><span>Check-Out</span><span>${booking.checkout}</span></div>
        <div><span>Total Charges</span><span>${money(total)}</span></div>
        <div><span>Already Paid</span><span>${money(paidTotal)}</span></div>
        <div class="grand"><span>Balance Due</span><span>${money(balance)}</span></div>
    `;
    document.getElementById('fdCheckoutAmount').value = balance > 0 ? balance.toFixed(2) : 0;
}

async function openFdCheckoutModal(booking) {
    document.getElementById('fdCheckoutSubtitle').textContent = `Room ${booking.roomName || ''} · checked in ${formatPKT(booking.createdAt)}`;
    document.getElementById('fdCheckoutDate').value = booking.checkout || today();
    document.getElementById('fdCheckoutMessage').textContent = '';
    document.getElementById('fdCheckoutForm').dataset.id = booking.id;
    fdRenderSummary(booking);
    fdOverlay.style.display = 'flex';

    document.getElementById('fdCheckoutDate').onchange = async () => {
        const newCheckout = document.getElementById('fdCheckoutDate').value;
        if (!newCheckout || newCheckout <= booking.checkin) return;
        try {
            const updated = await apiSend('PATCH', `/api/bookings/${booking.id}/details`, { checkout: newCheckout });
            booking.checkout = updated.checkout;
            booking.totalAmount = Number(updated.total_amount);
            fdRenderSummary(booking);
        } catch (err) {
            document.getElementById('fdCheckoutMessage').textContent = err.message;
            document.getElementById('fdCheckoutMessage').className = 'form-message error';
        }
    };
}

document.getElementById('fdCloseCheckoutModalBtn').addEventListener('click', () => {
    fdOverlay.style.display = 'none';
});
fdOverlay.addEventListener('click', (e) => {
    if (e.target === fdOverlay) fdOverlay.style.display = 'none';
});

document.getElementById('fdCheckoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.dataset.id;
    const msg = document.getElementById('fdCheckoutMessage');
    const amount = Number(document.getElementById('fdCheckoutAmount').value || 0);
    const submitBtn = e.target.querySelector('button[type="submit"]');

    msg.textContent = '';
    msg.className = 'form-message';
    submitBtn.disabled = true;
    try {
        const result = await apiSend('POST', `/api/bookings/${id}/checkout`, {
            amount: amount > 0 ? amount : undefined,
            method: document.getElementById('fdCheckoutMethod').value,
            transactionId: ''
        });
        fdOverlay.style.display = 'none';
        const when = formatPKT(result.booking.checked_out_at);
        alert(`Payment recorded successfully at ${when}`);
        goToIdInput();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    } finally {
        submitBtn.disabled = false;
    }
});

/* ---------------- Boot ---------------- */
if (localStorage.getItem('horizonAdminAuth')) {
    showKiosk();
} else {
    showLogin();
}
