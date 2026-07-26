const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const STATUS_LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    checked_in: 'Checked In',
    checked_out: 'Checked Out',
    cancelled: 'Cancelled'
};
const PAYMENT_METHOD_LABELS = {
    pay_at_property: 'Pay at Property',
    bank_transfer: 'Bank Transfer',
    easypaisa: 'EasyPaisa',
    jazzcash: 'JazzCash'
};

function getAuthHeader() {
    const token = sessionStorage.getItem('horizonAdminAuth');
    return token ? { Authorization: `Basic ${token}` } : {};
}

async function apiGet(path) {
    const res = await fetch(path, { headers: getAuthHeader() });
    if (res.status === 401) {
        sessionStorage.removeItem('horizonAdminAuth');
        showLogin();
        throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error('Request failed');
    return res.json();
}

async function apiPatch(path, body) {
    const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
    });
    if (res.status === 401) {
        sessionStorage.removeItem('horizonAdminAuth');
        showLogin();
        throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error('Request failed');
    return res.json();
}

function showLogin() {
    loginPanel.style.display = 'block';
    dashboard.style.display = 'none';
}

function showDashboard() {
    loginPanel.style.display = 'none';
    dashboard.style.display = 'block';
    loadBookings();
    loadMessages();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function detailField(label, value) {
    return `<div class="detail-field"><strong>${label}:</strong> ${escapeHtml(value) || '&mdash;'}</div>`;
}

async function loadBookings() {
    try {
        const bookings = await apiGet('/api/bookings');
        const body = document.getElementById('bookingsBody');
        body.innerHTML = bookings.map((b) => `
            <tr>
                <td>${b.id}</td>
                <td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.email)} &middot; ${escapeHtml(b.phone)}</small></td>
                <td>${escapeHtml(b.room_name)}</td>
                <td>${b.checkin}</td>
                <td>${b.checkout}</td>
                <td>${b.guests}</td>
                <td>
                    <select class="status-select status-${b.status}" data-id="${b.id}">
                        ${BOOKING_STATUSES.map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <div class="payment-method-label">${PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method}</div>
                    <span class="status-pill ${b.payment_status}">${b.payment_status}</span>
                    <button class="action-btn payment-toggle ${b.payment_status === 'paid' ? 'cancel' : 'confirm'}"
                        data-id="${b.id}" data-payment="${b.payment_status === 'paid' ? 'unpaid' : 'paid'}">
                        Mark ${b.payment_status === 'paid' ? 'Unpaid' : 'Paid'}
                    </button>
                </td>
                <td><button class="action-btn details-toggle" data-target="details-${b.id}">View</button></td>
            </tr>
            <tr class="detail-row" id="details-${b.id}" style="display: none;">
                <td colspan="9">
                    <div class="detail-grid">
                        ${detailField('CNIC / Passport', b.cnic)}
                        ${detailField('Marital Status', b.marital_status)}
                        ${detailField('Arriving From', b.arrival_from)}
                        ${detailField('Departing To', b.departure_to)}
                        ${detailField('Arrival Time', b.arrival_time)}
                        ${detailField('Purpose of Stay', b.purpose_of_stay)}
                        ${detailField('Vehicle Number', b.vehicle_number)}
                        ${detailField('Payment Method', PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method)}
                        ${detailField('Transaction ID', b.transaction_id)}
                        ${detailField('Special Requests', b.special_requests)}
                        ${detailField('Terms Accepted', b.terms_accepted ? 'Yes' : 'No')}
                        ${detailField('Booked At', b.created_at)}
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="9">No bookings yet.</td></tr>';

        body.querySelectorAll('.status-select').forEach((select) => {
            select.addEventListener('change', async () => {
                select.disabled = true;
                try {
                    await apiPatch(`/api/bookings/${select.dataset.id}`, { status: select.value });
                    loadBookings();
                } catch (err) {
                    select.disabled = false;
                }
            });
        });

        body.querySelectorAll('.payment-toggle').forEach((btn) => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                await apiPatch(`/api/bookings/${btn.dataset.id}`, { paymentStatus: btn.dataset.payment });
                loadBookings();
            });
        });

        body.querySelectorAll('.details-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = document.getElementById(btn.dataset.target);
                const isOpen = row.style.display !== 'none';
                row.style.display = isOpen ? 'none' : 'table-row';
                btn.textContent = isOpen ? 'View' : 'Hide';
            });
        });
    } catch (err) {
        // handled by apiGet (login redirect) or ignored
    }
}

async function loadMessages() {
    try {
        const messages = await apiGet('/api/contact');
        const body = document.getElementById('messagesBody');
        body.innerHTML = messages.map((m) => `
            <tr>
                <td>${m.id}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.email)}</td>
                <td>${escapeHtml(m.message)}</td>
                <td>${m.created_at}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">No messages yet.</td></tr>';
    } catch (err) {
        // handled by apiGet
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('adminUser').value;
    const pass = document.getElementById('adminPass').value;
    const token = btoa(`${user}:${pass}`);

    try {
        const res = await fetch('/api/bookings', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) {
            loginMessage.textContent = 'Invalid username or password.';
            return;
        }
        sessionStorage.setItem('horizonAdminAuth', token);
        loginMessage.textContent = '';
        showDashboard();
    } catch (err) {
        loginMessage.textContent = 'Network error. Please try again.';
    }
});

if (sessionStorage.getItem('horizonAdminAuth')) {
    showDashboard();
} else {
    showLogin();
}
