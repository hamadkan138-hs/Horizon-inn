const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    checked_out: 'Checked Out', cancelled: 'Cancelled'
};
const PAYMENT_METHOD_LABELS = {
    pay_at_property: 'Pay at Property', bank_transfer: 'Bank Transfer',
    easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', cash: 'Cash'
};

let currentUser = null;
let allBookings = [];
let allRooms = [];
let allRoomsForPanel = [];
let calendarDate = new Date();

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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function showLogin() {
    loginPanel.style.display = 'block';
    dashboard.style.display = 'none';
}

async function showDashboard() {
    loginPanel.style.display = 'none';
    dashboard.style.display = 'block';
    try {
        currentUser = await apiGet('/api/auth/me');
        document.getElementById('whoami').textContent = `${currentUser.username} (${currentUser.role})`;
        document.getElementById('staffTabBtn').style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
        document.getElementById('mediaTabBtn').style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
        document.getElementById('contentTabBtn').style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
    } catch (err) { return; }

    loadBookings();
    loadMessages();
    updateNotifyBell();
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.admin-panel').forEach((p) => { p.style.display = 'none'; });
        document.getElementById(`panel-${btn.dataset.tab}`).style.display = 'block';

        if (btn.dataset.tab === 'payments') loadTransactionsPanel();
        if (btn.dataset.tab === 'daily') loadDailySummary();
        if (btn.dataset.tab === 'availability') loadAvailability();
        if (btn.dataset.tab === 'handover') loadHandoverPanel();
        if (btn.dataset.tab === 'guests') loadGuests();
        if (btn.dataset.tab === 'rooms') loadRoomsPanel();
        if (btn.dataset.tab === 'expenses') loadExpenses();
        if (btn.dataset.tab === 'reports') loadReports();
        if (btn.dataset.tab === 'staff') loadStaff();
        if (btn.dataset.tab === 'media') loadMediaLibrary();
        if (btn.dataset.tab === 'content') loadSiteContent();
        if (btn.dataset.tab === 'bookings') { localStorage.setItem('horizonLastSeen', new Date().toISOString()); updateNotifyBell(); }
    });
});

/* ---------------- Notification bell ---------------- */
function updateNotifyBell() {
    const lastSeen = localStorage.getItem('horizonLastSeen') || '1970-01-01';
    const newCount = allBookings.filter((b) => b.created_at > lastSeen).length;
    const badge = document.getElementById('bellBadge');
    badge.textContent = newCount;
    badge.style.display = newCount > 0 ? 'flex' : 'none';
}
document.getElementById('notifyBell').addEventListener('click', () => {
    localStorage.setItem('horizonLastSeen', new Date().toISOString());
    updateNotifyBell();
    document.querySelector('.admin-tab[data-tab="bookings"]').click();
});

/* ---------------- Bookings ---------------- */
function whatsappLink(booking) {
    let digits = (booking.phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
    const text = `Hello ${booking.name}, this is Horizon Inn confirming booking #${booking.id} for ${booking.room_name}, ${booking.checkin} to ${booking.checkout}. Status: ${STATUS_LABELS[booking.status]}. Total: ${money(booking.total_amount)}. Thank you!`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function emailLink(booking) {
    const subject = `Horizon Inn — Booking #${booking.id} ${STATUS_LABELS[booking.status]}`;
    const body = `Hello ${booking.name},\n\nThis confirms your Horizon Inn booking:\n\nRoom: ${booking.room_name}\nCheck-in: ${booking.checkin}\nCheck-out: ${booking.checkout}\nStatus: ${STATUS_LABELS[booking.status]}\nTotal: ${money(booking.total_amount)}\n\nThank you for choosing Horizon Inn.`;
    return `mailto:${booking.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function detailField(label, value) {
    return `<div class="detail-field"><strong>${label}:</strong> ${escapeHtml(value) || '&mdash;'}</div>`;
}

function bookingRowHtml(b) {
    const balance = Math.max(0, Number(b.total_amount) - (b._paidTotal || 0));
    return `
        <tr>
            <td>${b.id}</td>
            <td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.email)} &middot; ${escapeHtml(b.phone)}</small></td>
            <td>${escapeHtml(b.room_name)}</td>
            <td>${b.checkin}</td>
            <td>${b.checkout}</td>
            <td>${b.guests}</td>
            <td>
                <select class="status-select" data-id="${b.id}">
                    ${BOOKING_STATUSES.map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
                </select>
            </td>
            <td>
                <div class="payment-method-label">${PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method}</div>
                <span class="status-pill ${b.payment_status}">${b.payment_status}</span>
                <div style="font-size: 0.78rem; color: var(--text-light); margin-top: 4px;">Total ${money(b.total_amount)}</div>
            </td>
            <td>
                <button class="action-btn details-toggle" data-target="details-${b.id}" data-id="${b.id}">View</button><br><br>
                <a class="action-btn confirm" href="${whatsappLink(b)}" target="_blank" rel="noopener">WhatsApp</a>
                <a class="action-btn confirm" href="${emailLink(b)}">Email</a>
                <a class="action-btn details-toggle" href="invoice.html?id=${b.id}" target="_blank" rel="opener">Invoice</a>
            </td>
        </tr>
        <tr class="detail-row" id="details-${b.id}" style="display: none;">
            <td colspan="9"><div class="detail-loading" data-id="${b.id}">Loading details&hellip;</div></td>
        </tr>
    `;
}

async function renderBookingDetail(id) {
    const cell = document.querySelector(`#details-${id} td`);
    try {
        const b = await apiGet(`/api/bookings/${id}`);
        const paidTotal = b.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const balance = Math.max(0, Number(b.total_amount) - paidTotal);
        const chargesTotal = b.charges.reduce((sum, c) => sum + Number(c.amount), 0);

        const needsVerification = b.payment_method !== 'pay_at_property' && b.transaction_id && b.payment_status === 'unpaid';
        const verifyBanner = needsVerification ? `
            <div class="verify-banner">
                <i class="fas fa-circle-exclamation"></i>
                Guest submitted a <strong>${PAYMENT_METHOD_LABELS[b.payment_method]}</strong> transaction ID
                (<strong>${escapeHtml(b.transaction_id)}</strong>) for ${money(b.total_amount)} but no payment has been verified yet.
                <button type="button" class="action-btn confirm verify-btn" data-id="${id}"
                    data-amount="${b.total_amount}" data-method="${b.payment_method}" data-txn="${escapeHtml(b.transaction_id)}">
                    Verify &amp; Record Payment
                </button>
            </div>
        ` : '';

        cell.innerHTML = `
            ${verifyBanner}
            <div class="detail-grid">
                ${detailField('CNIC / Passport', b.cnic)}
                ${detailField('Marital Status', b.marital_status)}
                ${detailField('Address', b.address)}
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

            <div class="detail-subsection">
                <h4>Invoice &mdash; ${escapeHtml(b.invoice_number)}</h4>
                <form class="inline-form invoice-fields-form" data-id="${id}">
                    <input type="text" name="roomNumber" value="${escapeHtml(b.room_number)}" placeholder="Room number (e.g. 12)">
                    <input type="text" name="invoiceNotes" value="${escapeHtml(b.invoice_notes)}" placeholder="Notes to print on invoice">
                    <button type="submit" class="action-btn confirm">Save</button>
                    <a class="action-btn details-toggle" href="invoice.html?id=${id}" target="_blank" rel="opener">Open Invoice</a>
                    <button type="button" class="action-btn details-toggle copy-link-btn" data-id="${id}" data-token="${b.invoice_token}">Copy Guest Link</button>
                </form>
                <p class="form-message" id="invoiceFieldsMessage-${id}"></p>
            </div>

            <div class="detail-subsection">
                <h4>Charges &mdash; Room ${money(b.room_amount)}, Extras ${money(chargesTotal)}, Tax ${b.tax_percent}%</h4>
                <table class="admin-table mini-table">
                    <thead><tr><th>Description</th><th>Amount</th><th></th></tr></thead>
                    <tbody>
                        <tr><td>${escapeHtml(b.room_name)} (room charge)</td><td>${money(b.room_amount)}</td><td></td></tr>
                        ${b.charges.map((c) => `<tr ${c.amount < 0 ? 'class="discount-row"' : ''}><td>${escapeHtml(c.description)}</td><td>${money(c.amount)}</td><td><button class="action-btn cancel remove-charge-btn" data-booking="${id}" data-charge="${c.id}">Remove</button></td></tr>`).join('')}
                    </tbody>
                </table>
                <form class="inline-form charge-form" data-id="${id}">
                    <input type="text" name="description" placeholder="Extra service or discount (e.g. Breakfast, Loyalty Discount)" required>
                    <input type="number" name="amount" placeholder="Amount (negative = discount)" step="0.01" required>
                    <button type="submit" class="action-btn confirm">Add Charge</button>
                </form>
                <form class="inline-form tax-form" data-id="${id}">
                    <label style="font-size: 0.85rem; color: var(--text-light);">Tax rate:</label>
                    <input type="number" name="taxPercent" value="${b.tax_percent}" min="0" max="100" step="0.1" style="max-width: 100px;">
                    <button type="submit" class="action-btn confirm">Update Tax %</button>
                </form>
            </div>

            <div class="detail-subsection">
                <h4>Payments &mdash; Total ${money(b.total_amount)}, Paid ${money(paidTotal)}, Balance ${money(balance)}</h4>
                <table class="admin-table mini-table">
                    <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Txn ID</th><th>Note</th><th>By</th></tr></thead>
                    <tbody>
                        ${b.payments.map((p) => `<tr><td>${p.recorded_at}</td><td>${money(p.amount)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.transaction_id)}</td><td>${escapeHtml(p.note)}</td><td>${escapeHtml(p.recorded_by)}</td></tr>`).join('') || '<tr><td colspan="6">No payments recorded yet.</td></tr>'}
                    </tbody>
                </table>
                <form class="inline-form payment-form" data-id="${id}">
                    <input type="number" name="amount" placeholder="Amount (Rs.)" min="0.01" step="0.01" required>
                    <select name="method">
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="easypaisa">EasyPaisa</option>
                        <option value="jazzcash">JazzCash</option>
                    </select>
                    <input type="text" name="transactionId" placeholder="Transaction ID (optional)">
                    <input type="text" name="note" placeholder="Note (optional)">
                    <button type="submit" class="action-btn confirm">Record Payment</button>
                </form>
            </div>

            <div class="detail-subsection">
                <h4>Edit Booking</h4>
                <form class="inline-form edit-booking-form" data-id="${id}">
                    <input type="text" name="name" value="${escapeHtml(b.name)}" placeholder="Name">
                    <input type="email" name="email" value="${escapeHtml(b.email)}" placeholder="Email">
                    <input type="tel" name="phone" value="${escapeHtml(b.phone)}" placeholder="Phone">
                    <input type="number" name="guests" value="${b.guests}" min="1" max="10" placeholder="Guests">
                    <input type="date" name="checkin" value="${b.checkin}">
                    <input type="date" name="checkout" value="${b.checkout}">
                    <input type="text" name="specialRequests" value="${escapeHtml(b.special_requests)}" placeholder="Special requests">
                    <button type="submit" class="action-btn confirm">Save Changes</button>
                </form>
                <p class="form-message" id="editMessage-${id}"></p>
            </div>
        `;

        const paymentForm = cell.querySelector('.payment-form');
        paymentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            try {
                await apiSend('POST', `/api/bookings/${id}/payments`, {
                    amount: Number(form.amount.value),
                    method: form.method.value,
                    transactionId: form.transactionId.value,
                    note: form.note.value
                });
                loadBookings(true, id);
            } catch (err) {
                alert(err.message);
            }
        });

        const verifyBtn = cell.querySelector('.verify-btn');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => {
                paymentForm.amount.value = verifyBtn.dataset.amount;
                paymentForm.method.value = verifyBtn.dataset.method;
                paymentForm.transactionId.value = verifyBtn.dataset.txn;
                paymentForm.note.value = 'Verified guest-submitted transaction ID';
                paymentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                paymentForm.amount.focus();
            });
        }

        cell.querySelector('.charge-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            try {
                await apiSend('POST', `/api/bookings/${id}/charges`, {
                    description: form.description.value,
                    amount: Number(form.amount.value)
                });
                loadBookings(true, id);
            } catch (err) {
                alert(err.message);
            }
        });

        cell.querySelectorAll('.remove-charge-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this charge?')) return;
                try {
                    await apiSend('DELETE', `/api/bookings/${btn.dataset.booking}/charges/${btn.dataset.charge}`, {});
                    loadBookings(true, id);
                } catch (err) {
                    alert(err.message);
                }
            });
        });

        cell.querySelector('.tax-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            try {
                await apiSend('PATCH', `/api/bookings/${id}/tax`, { taxPercent: Number(form.taxPercent.value) });
                loadBookings(true, id);
            } catch (err) {
                alert(err.message);
            }
        });

        cell.querySelector('.invoice-fields-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const msg = document.getElementById(`invoiceFieldsMessage-${id}`);
            try {
                await apiSend('PATCH', `/api/bookings/${id}/invoice-fields`, {
                    roomNumber: form.roomNumber.value,
                    invoiceNotes: form.invoiceNotes.value
                });
                msg.textContent = 'Saved.';
                msg.className = 'form-message success';
            } catch (err) {
                msg.textContent = err.message;
                msg.className = 'form-message error';
            }
        });

        cell.querySelector('.copy-link-btn').addEventListener('click', async () => {
            const btn = cell.querySelector('.copy-link-btn');
            const link = `${window.location.origin}/invoice.html?id=${btn.dataset.id}&token=${btn.dataset.token}`;
            try {
                await navigator.clipboard.writeText(link);
                btn.textContent = 'Link Copied!';
            } catch (err) {
                prompt('Copy this link to send to the guest:', link);
            }
            setTimeout(() => { btn.textContent = 'Copy Guest Link'; }, 2000);
        });

        cell.querySelector('.edit-booking-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const msg = document.getElementById(`editMessage-${id}`);
            try {
                await apiSend('PATCH', `/api/bookings/${id}/details`, {
                    name: form.name.value, email: form.email.value, phone: form.phone.value,
                    guests: Number(form.guests.value), checkin: form.checkin.value, checkout: form.checkout.value,
                    specialRequests: form.specialRequests.value
                });
                msg.textContent = 'Saved.';
                msg.className = 'form-message success';
                loadBookings(true, id);
            } catch (err) {
                msg.textContent = err.message;
                msg.className = 'form-message error';
            }
        });
    } catch (err) {
        cell.innerHTML = `<p class="error-text">Failed to load details.</p>`;
    }
}

async function loadBookings(keepOpen, reopenId) {
    try {
        allBookings = await apiGet('/api/bookings');
        applyBookingFilters();
        updateNotifyBell();
        if (keepOpen && reopenId) {
            const row = document.getElementById(`details-${reopenId}`);
            if (row) { row.style.display = 'table-row'; renderBookingDetail(reopenId); }
        }
    } catch (err) { /* handled by apiGet */ }
}

function applyBookingFilters() {
    const search = document.getElementById('bookingSearch').value.toLowerCase();
    const statusFilter = document.getElementById('bookingStatusFilter').value;
    const paymentFilter = document.getElementById('bookingPaymentFilter').value;
    const filtered = allBookings.filter((b) => {
        const matchesSearch = !search || [b.name, b.email, b.phone, b.cnic].some((f) => (f || '').toLowerCase().includes(search));
        const matchesStatus = !statusFilter || b.status === statusFilter;
        const matchesPayment = !paymentFilter || b.payment_status === paymentFilter;
        return matchesSearch && matchesStatus && matchesPayment;
    });

    const body = document.getElementById('bookingsBody');
    body.innerHTML = filtered.map(bookingRowHtml).join('') || '<tr><td colspan="9">No bookings match.</td></tr>';

    body.querySelectorAll('.status-select').forEach((select) => {
        select.addEventListener('change', async () => {
            select.disabled = true;
            try { await apiSend('PATCH', `/api/bookings/${select.dataset.id}`, { status: select.value }); loadBookings(); }
            catch (err) { alert(err.message); select.disabled = false; }
        });
    });

    body.querySelectorAll('.details-toggle[data-target]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const row = document.getElementById(btn.dataset.target);
            const isOpen = row.style.display !== 'none';
            row.style.display = isOpen ? 'none' : 'table-row';
            btn.textContent = isOpen ? 'View' : 'Hide';
            if (!isOpen) renderBookingDetail(btn.dataset.id);
        });
    });
}

document.getElementById('bookingSearch').addEventListener('input', applyBookingFilters);
document.getElementById('bookingStatusFilter').addEventListener('change', applyBookingFilters);
document.getElementById('bookingPaymentFilter').addEventListener('change', applyBookingFilters);

/* ---------------- Daily Summary ---------------- */
function dailyRowHtml(b) {
    return `<tr><td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.phone)}</small></td><td>${escapeHtml(b.room_name)}</td><td>${b.guests}</td><td><span class="status-pill ${b.status}">${STATUS_LABELS[b.status]}</span></td><td>${money(b.balance)}</td></tr>`;
}

async function loadDailySummary() {
    const dateInput = document.getElementById('dailyDate');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    try {
        const data = await apiGet(`/api/reports/daily-summary?date=${dateInput.value}`);

        document.getElementById('dailyCards').innerHTML = `
            <div class="summary-card"><span>Check-ins</span><strong>${data.checkins.length}</strong></div>
            <div class="summary-card"><span>Check-outs</span><strong>${data.checkouts.length}</strong></div>
            <div class="summary-card"><span>Cash Received Today</span><strong>${money(data.cashReceivedToday)}</strong></div>
            <div class="summary-card"><span>Total Outstanding</span><strong>${money(data.outstandingTotal)}</strong></div>
        `;

        document.getElementById('dailyCheckinsBody').innerHTML = data.checkins.map(dailyRowHtml).join('') || '<tr><td colspan="5">No check-ins scheduled.</td></tr>';
        document.getElementById('dailyCheckoutsBody').innerHTML = data.checkouts.map(dailyRowHtml).join('') || '<tr><td colspan="5">No check-outs scheduled.</td></tr>';

        document.getElementById('outstandingBody').innerHTML = data.outstandingBookings.map((b) => `
            <tr><td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.phone)}</small></td><td>${escapeHtml(b.room_name)}</td><td><span class="status-pill ${b.status}">${STATUS_LABELS[b.status]}</span></td><td>${money(b.total_amount)}</td><td>${money(b.balance)}</td></tr>
        `).join('') || '<tr><td colspan="5">No outstanding balances. 🎉</td></tr>';
    } catch (err) { /* handled */ }
}

document.getElementById('dailyDate').addEventListener('change', loadDailySummary);

/* ---------------- Cash & Handover (locked ledger) ---------------- */
let handoverDetailedVisible = false;

function paymentMethodBucketLabel(method) {
    if (method === 'bank_transfer') return 'Bank';
    if (method === 'easypaisa') return 'EasyPaisa';
    if (method === 'jazzcash') return 'JazzCash';
    return 'Cash';
}

async function loadHandoverPanel() {
    try {
        document.getElementById('handoverDateLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const [preview, allBookingsFresh, history] = await Promise.all([
            apiGet('/api/handovers/preview'),
            apiGet('/api/bookings'),
            apiGet('/api/handovers')
        ]);

        document.getElementById('handoverSummaryCards').innerHTML = `
            <div class="summary-card"><span>Total Cash Collected</span><strong>${money(preview.cashTotal)}</strong></div>
            <div class="summary-card"><span>Total Bank Transfers</span><strong>${money(preview.bankTotal)}</strong></div>
            <div class="summary-card"><span>Total Online Payments</span><strong>${money(preview.onlineTotal)}</strong></div>
            <div class="summary-card"><span>Grand Total (Pending Handover)</span><strong>${money(preview.cashTotal + preview.bankTotal + preview.onlineTotal)}</strong></div>
        `;

        document.getElementById('handoverSimpleList').innerHTML = preview.bookings.map((b) => `
            <li>
                <span class="item-label">${escapeHtml(b.name)} <span class="item-meta">${escapeHtml(b.invoice_number)} &middot; ${paymentMethodBucketLabel(b.payment_method)}</span></span>
                <span class="item-amount">${money(b.total_amount)}</span>
            </li>
        `).join('') || '<li class="empty-row">No completed checkouts awaiting handover.</li>';

        document.getElementById('handoverSimpleTotal').innerHTML = `
            <span class="label">Total Collection</span>
            <span class="value">${money(preview.cashTotal + preview.bankTotal + preview.onlineTotal)}</span>
        `;

        const checkedOutBookings = allBookingsFresh
            .filter((b) => b.status === 'checked_out')
            .sort((a, b) => (b.checkout > a.checkout ? 1 : -1));

        document.getElementById('handoverLedgerBody').innerHTML = checkedOutBookings.map((b) => `
            <tr>
                <td>${b.checkout}</td>
                <td>${escapeHtml(b.invoice_number)}</td>
                <td>${escapeHtml(b.name)}</td>
                <td>${b.room_number ? escapeHtml(b.room_number) : '&mdash;'}</td>
                <td>${b.checkin}</td>
                <td>${b.checkout}</td>
                <td>${money(b.total_amount)}</td>
                <td>${paymentMethodBucketLabel(b.payment_method)}</td>
                <td><span class="status-pill ${b.handover_id ? 'handed-over' : 'active-pending'}">${b.handover_id ? 'Handed Over' : 'Active'}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="9">No completed checkouts yet.</td></tr>';

        document.getElementById('handoverHistoryList').innerHTML = history.map((h) => `
            <li>
                <span class="item-label">
                    ${new Date(h.created_at.replace(' ', 'T')).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    <span class="item-meta">
                        ${h.booking_count} booking(s) &middot; Cash ${money(h.cash_total)} &middot; Bank ${money(h.bank_total)} &middot; Online ${money(h.online_total)}
                        &middot; Expenses ${money(h.expenses_total)} &middot; By ${escapeHtml(h.staff_name)} &rarr; ${escapeHtml(h.receiver_type)}: ${escapeHtml(h.receiver_name)}
                    </span>
                </span>
                <span class="item-amount">${money(h.net_cash_handed + h.bank_total + h.online_total)}</span>
            </li>
        `).join('') || '<li class="empty-row">No handovers recorded yet.</li>';
    } catch (err) { /* handled */ }
}

document.getElementById('handoverViewToggle').addEventListener('click', () => {
    handoverDetailedVisible = !handoverDetailedVisible;
    document.getElementById('handoverSimpleView').style.display = handoverDetailedVisible ? 'none' : 'block';
    document.getElementById('handoverDetailedView').style.display = handoverDetailedVisible ? 'block' : 'none';
    document.getElementById('handoverViewToggle').textContent = handoverDetailedVisible ? 'View Simple Summary' : 'View Full Details';
});

const RECEIVER_LABELS = { owner: 'Owner Name', bank: 'Bank Name', staff: 'Next Staff Name' };

async function openHandoverModal() {
    const msg = document.getElementById('handoverMessage');
    msg.textContent = '';
    msg.className = 'form-message';
    try {
        const preview = await apiGet('/api/handovers/preview');
        document.getElementById('handoverModalSummary').innerHTML = `
            <div><span>Cash Collected</span><span>${money(preview.cashTotal)}</span></div>
            <div><span>Bank Transfers</span><span>${money(preview.bankTotal)}</span></div>
            <div><span>Online Payments</span><span>${money(preview.onlineTotal)}</span></div>
            <div><span>Expenses Paid Out (cash)</span><span>-${money(preview.expensesTotal)}</span></div>
            <div class="grand"><span>Total Cash in Hand</span><span>${money(preview.netCashHanded)}</span></div>
        `;
        document.getElementById('handoverStaffName').value = currentUser.username;
        document.getElementById('handoverDateTime').value = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
        document.getElementById('handoverReceiverType').value = 'owner';
        document.getElementById('handoverReceiverNameLabel').textContent = RECEIVER_LABELS.owner;
        document.getElementById('handoverReceiverName').value = '';
        document.getElementById('handoverNote').value = '';
        document.getElementById('handoverModalOverlay').style.display = 'flex';
    } catch (err) {
        alert(err.message);
    }
}

document.getElementById('openHandoverModalBtn').addEventListener('click', openHandoverModal);
document.getElementById('closeHandoverModalBtn').addEventListener('click', () => {
    document.getElementById('handoverModalOverlay').style.display = 'none';
});
document.getElementById('handoverModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'handoverModalOverlay') document.getElementById('handoverModalOverlay').style.display = 'none';
});
document.getElementById('handoverReceiverType').addEventListener('change', (e) => {
    document.getElementById('handoverReceiverNameLabel').textContent = RECEIVER_LABELS[e.target.value];
});

document.getElementById('handoverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('handoverMessage');
    try {
        await apiSend('POST', '/api/handovers', {
            receiverType: document.getElementById('handoverReceiverType').value,
            receiverName: document.getElementById('handoverReceiverName').value,
            note: document.getElementById('handoverNote').value
        });
        document.getElementById('handoverModalOverlay').style.display = 'none';
        loadHandoverPanel();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

/* ---------------- Payments / Transactions ---------------- */
function isOverdue(b) {
    const today = new Date().toISOString().slice(0, 10);
    return ['unpaid', 'partial'].includes(b.payment_status) && b.status !== 'cancelled' && b.checkout < today;
}

async function loadTransactionsPanel() {
    if (!allRooms.length) allRooms = await apiGet('/api/rooms');
    const roomFilter = document.getElementById('txnRoomFilter');
    if (roomFilter.options.length <= 1) {
        roomFilter.innerHTML = '<option value="">All room types</option>' +
            allRooms.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
    }
    applyTransactionFilters();
}

function applyTransactionFilters() {
    const status = document.getElementById('txnStatusFilter').value;
    const method = document.getElementById('txnMethodFilter').value;
    const room = document.getElementById('txnRoomFilter').value;
    const from = document.getElementById('txnFrom').value;
    const to = document.getElementById('txnTo').value;
    const overdueOnly = document.getElementById('txnOverdueOnly').checked;

    const filtered = allBookings.filter((b) => {
        if (status && b.payment_status !== status) return false;
        if (method && b.payment_method !== method) return false;
        if (room && b.room_name !== room) return false;
        if (from && b.checkin < from) return false;
        if (to && b.checkin > to) return false;
        if (overdueOnly && !isOverdue(b)) return false;
        return true;
    });

    document.getElementById('transactionsBody').innerHTML = filtered.map((b) => `
        <tr class="${isOverdue(b) ? 'overdue-row' : ''}">
            <td>${escapeHtml(b.invoice_number)}</td>
            <td>#${b.id}</td>
            <td>${escapeHtml(b.name)}</td>
            <td>${escapeHtml(b.room_name)}</td>
            <td>${PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method}</td>
            <td>${money(b.total_amount)}</td>
            <td>${money(b.paid_total)}</td>
            <td>${money(b.balance)}</td>
            <td>
                <span class="status-pill ${b.payment_status}">${b.payment_status}</span>
                ${isOverdue(b) ? '<span class="status-pill unpaid" style="margin-left:4px;">Overdue</span>' : ''}
            </td>
            <td>${b.checkin}</td>
            <td>
                <a class="action-btn details-toggle" href="invoice.html?id=${b.id}" target="_blank" rel="opener">Invoice</a>
                <button class="action-btn confirm jump-to-booking-btn" data-id="${b.id}">Manage</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="11">No transactions match these filters.</td></tr>';

    document.querySelectorAll('.jump-to-booking-btn').forEach((btn) => {
        btn.addEventListener('click', () => jumpToBooking(btn.dataset.id));
    });
}

['txnStatusFilter', 'txnMethodFilter', 'txnRoomFilter', 'txnFrom', 'txnTo', 'txnOverdueOnly'].forEach((id) => {
    document.getElementById(id).addEventListener('change', applyTransactionFilters);
});

function jumpToBooking(id) {
    document.querySelector('.admin-tab[data-tab="bookings"]').click();
    setTimeout(() => {
        const toggleBtn = document.querySelector(`.details-toggle[data-target="details-${id}"]`);
        if (toggleBtn) {
            toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (document.getElementById(`details-${id}`).style.display === 'none') toggleBtn.click();
        }
    }, 100);
}

document.getElementById('txnExportBtn').addEventListener('click', () => {
    const rows = [['Invoice #', 'Booking ID', 'Customer', 'Email', 'Phone', 'Room', 'Method', 'Total', 'Paid', 'Balance', 'Payment Status', 'Booking Status', 'Check-in', 'Check-out']];
    allBookings.forEach((b) => {
        rows.push([b.invoice_number, b.id, b.name, b.email, b.phone, b.room_name, PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method,
            b.total_amount, b.paid_total, b.balance, b.payment_status, b.status, b.checkin, b.checkout]);
    });
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horizon-inn-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

/* ---------------- Availability calendar ---------------- */
async function loadAvailability() {
    if (!allRooms.length) allRooms = await apiGet('/api/rooms');
    const select = document.getElementById('availabilityRoom');
    if (!select.options.length) {
        select.innerHTML = allRooms.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
        select.addEventListener('change', renderCalendar);
    }
    const quickSelect = document.getElementById('quickRoomId');
    if (!quickSelect.options.length) {
        quickSelect.innerHTML = allRooms.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    }
    renderCalendar();
    loadRoomStatusBoard();
}

const ROOM_STATUS_META = {
    available: { label: 'Available', icon: 'fa-circle-check' },
    occupied: { label: 'Occupied', icon: 'fa-bed' },
    booked: { label: 'Booked (Locked)', icon: 'fa-lock' }
};

async function loadRoomStatusBoard() {
    try {
        const board = await apiGet('/api/rooms/status-board');
        document.getElementById('roomStatusBoard').innerHTML = board.map((r) => {
            const meta = ROOM_STATUS_META[r.status];
            const dates = r.booking ? `${r.booking.checkin} &rarr; ${r.booking.checkout}` : 'No upcoming stay';
            const guestLine = r.booking && r.status !== 'available' ? `<div class="room-status-dates">${escapeHtml(r.booking.guestName)}</div>` : '';
            return `
                <div class="room-status-card ${r.status}">
                    <h4>${escapeHtml(r.name)}</h4>
                    <span class="room-status-badge ${r.status}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>
                    <div class="room-status-dates">${dates}</div>
                    ${guestLine}
                    ${r.booking && r.booking.advancePaid ? '<span class="advance-paid-tag">Advance Paid</span>' : ''}
                </div>
            `;
        }).join('');
    } catch (err) { /* handled */ }
}

document.getElementById('quickBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('quickBookingMessage');
    msg.textContent = '';
    msg.className = 'form-message';
    try {
        const result = await apiSend('POST', '/api/bookings/quick', {
            guestName: document.getElementById('quickGuestName').value,
            phone: document.getElementById('quickPhone').value,
            roomId: Number(document.getElementById('quickRoomId').value),
            checkin: document.getElementById('quickCheckin').value,
            checkout: document.getElementById('quickCheckout').value,
            advanceAmount: Number(document.getElementById('quickAdvance').value),
            paymentMethod: document.getElementById('quickPaymentMethod').value,
            transactionId: document.getElementById('quickTransactionId').value
        });
        msg.textContent = `Room locked. Advance received: ${money(result.advanceAmount)} (tax included).`;
        msg.className = 'form-message success';
        document.getElementById('quickBookingForm').reset();
        allRooms = [];
        loadRoomStatusBoard();
        renderCalendar();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

function renderCalendar() {
    const roomId = Number(document.getElementById('availabilityRoom').value || allRooms[0]?.id);
    const room = allRooms.find((r) => r.id === roomId);
    if (!room) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    document.getElementById('availabilityMonthLabel').textContent = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay();

    const roomBookings = allBookings.filter((b) => b.room_id === roomId && b.status !== 'cancelled');

    let html = '<div class="calendar-weekdays">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div>${d}</div>`).join('') + '</div>';
    html += '<div class="calendar-days">';
    for (let i = 0; i < startWeekday; i++) html += '<div class="calendar-cell empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const occupied = roomBookings.filter((b) => b.checkin <= dateStr && b.checkout > dateStr).length;
        const ratio = occupied / room.total_units;
        const level = ratio === 0 ? 'low' : ratio < 1 ? 'mid' : 'full';
        html += `<div class="calendar-cell ${level}"><span class="cal-day">${day}</span><span class="cal-count">${occupied}/${room.total_units}</span></div>`;
    }
    html += '</div>';
    document.getElementById('calendarGrid').innerHTML = html;
}

document.getElementById('prevMonth').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); });
document.getElementById('nextMonth').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); });

/* ---------------- Guests ---------------- */
async function loadGuests() {
    try {
        const guests = await apiGet('/api/guests');
        const body = document.getElementById('guestsBody');
        body.innerHTML = guests.map((g, i) => `
            <tr>
                <td>${escapeHtml(g.name)}</td>
                <td>${escapeHtml(g.cnic)}</td>
                <td>${escapeHtml(g.email)}<br><small>${escapeHtml(g.phone)}</small></td>
                <td>${g.visit_count}</td>
                <td>${money(g.total_spent)}</td>
                <td>${g.last_stay || '&mdash;'}</td>
                <td><button class="action-btn details-toggle" data-guest="${encodeURIComponent(g.guest_key)}" data-row="guest-hist-${i}">View</button></td>
            </tr>
            <tr class="detail-row" id="guest-hist-${i}" style="display: none;"><td colspan="7"></td></tr>
        `).join('') || '<tr><td colspan="7">No guests yet.</td></tr>';

        body.querySelectorAll('[data-guest]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = document.getElementById(btn.dataset.row);
                const isOpen = row.style.display !== 'none';
                row.style.display = isOpen ? 'none' : 'table-row';
                btn.textContent = isOpen ? 'View' : 'Hide';
                if (!isOpen) {
                    const history = await apiGet(`/api/guests/${btn.dataset.guest}/bookings`);
                    row.querySelector('td').innerHTML = `
                        <table class="admin-table mini-table">
                            <thead><tr><th>Room</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Total</th></tr></thead>
                            <tbody>${history.map((h) => `<tr><td>${escapeHtml(h.room_name)}</td><td>${h.checkin}</td><td>${h.checkout}</td><td>${STATUS_LABELS[h.status]}</td><td>${money(h.total_amount)}</td></tr>`).join('')}</tbody>
                        </table>`;
                }
            });
        });
    } catch (err) { /* handled */ }
}

/* ---------------- Uploads ---------------- */
async function uploadImages(files, category) {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    form.append('category', category);
    const res = await fetch('/api/media/upload', { method: 'POST', headers: getAuthHeader(), body: form });
    if (res.status === 401) { localStorage.removeItem('horizonAdminAuth'); showLogin(); throw new Error('Unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data; // array of { id, url, filename, ... }
}

function roomPhotoStripHtml(room, canEdit) {
    const images = room.images || [];
    const thumbs = images.map((img, i) => {
        const src = img.startsWith('/') || img.startsWith('http') ? img : `/images/${img}`;
        return `
            <div class="room-photo-thumb" data-room="${room.id}" data-index="${i}">
                <img src="${src}" alt="">
                ${i === 0 ? '<span class="cover-badge">Cover</span>' : ''}
                ${canEdit ? '<button type="button" class="remove-photo-btn" title="Remove">&times;</button>' : ''}
            </div>
        `;
    }).join('');
    return `<div class="room-photo-strip" data-room="${room.id}">${thumbs}</div>`;
}

/* ---------------- Rooms & Pricing ---------------- */
async function loadRoomsPanel() {
    try {
        allRoomsForPanel = await apiGet('/api/rooms?includeInactive=1');
        const canEdit = currentUser.role === 'admin';

        document.getElementById('newRoomToggleBtn').style.display = canEdit ? 'inline-block' : 'none';

        document.getElementById('roomsSettingsList').innerHTML = allRoomsForPanel.map((r) => `
            <form class="room-edit-card" data-id="${r.id}" style="${r.active ? '' : 'opacity: 0.6;'}">
                <div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(r.name)}" ${canEdit ? '' : 'disabled'}></div>
                ${!r.active ? '<p style="color: var(--text-light); font-size: 0.8rem;">Inactive &mdash; hidden from the public site.</p>' : ''}

                <label style="font-size: 0.78rem; color: var(--text-light); display: block; margin-bottom: 6px;">Photos</label>
                ${roomPhotoStripHtml(r, canEdit)}
                ${canEdit ? `<input type="file" class="room-photo-input" data-id="${r.id}" accept="image/jpeg,image/png,image/webp" multiple style="margin-bottom: 14px;">` : ''}

                <div class="form-row form-row-3">
                    <div class="form-group"><label>Price / Night &mdash; 1 Guest (Rs.)</label><input type="number" name="price1p" value="${r.price_1p ?? ''}" min="0" step="1" placeholder="Same as 2-guest rate" ${canEdit ? '' : 'disabled'}></div>
                    <div class="form-group"><label>Price / Night &mdash; 2 Guests (Rs.)</label><input type="number" name="price" value="${r.price}" min="0" step="1" ${canEdit ? '' : 'disabled'}></div>
                    <div class="form-group"><label>Price / Night &mdash; 3 Guests (Rs.)</label><input type="number" name="price3p" value="${r.price_3p ?? ''}" min="0" step="1" placeholder="Same as 2-guest rate" ${canEdit ? '' : 'disabled'}></div>
                </div>
                <div class="form-group"><label>Description</label><textarea name="description" rows="2" ${canEdit ? '' : 'disabled'}>${escapeHtml(r.description)}</textarea></div>
                <div class="form-group"><label>Amenities (one per line)</label><textarea name="features" rows="3" ${canEdit ? '' : 'disabled'}>${escapeHtml((r.features || []).join('\n'))}</textarea></div>
                <div class="form-row">
                    <div class="form-group"><label>Total Units</label><input type="number" name="totalUnits" value="${r.total_units}" min="1" ${canEdit ? '' : 'disabled'}></div>
                    <div class="form-group"><label>Featured</label><select name="featured" ${canEdit ? '' : 'disabled'}><option value="0" ${!r.featured ? 'selected' : ''}>No</option><option value="1" ${r.featured ? 'selected' : ''}>Yes</option></select></div>
                </div>
                <div class="form-group"><label>Active (visible on site)</label><select name="active" ${canEdit ? '' : 'disabled'}><option value="1" ${r.active ? 'selected' : ''}>Yes</option><option value="0" ${!r.active ? 'selected' : ''}>No</option></select></div>
                ${canEdit ? `<button type="submit" class="action-btn confirm">Save Room</button> <button type="button" class="action-btn cancel delete-room-btn" data-id="${r.id}">Delete Room</button>` : '<p style="color: var(--text-light); font-size: 0.85rem;">Only admins can edit room settings.</p>'}
                <p class="form-message" id="roomMsg-${r.id}"></p>
            </form>
        `).join('');

        if (canEdit) {
            document.querySelectorAll('.room-edit-card[data-id]').forEach((form) => {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const id = form.dataset.id;
                    const msg = document.getElementById(`roomMsg-${id}`);
                    try {
                        await apiSend('PATCH', `/api/rooms/${id}`, {
                            name: form.name.value, description: form.description.value,
                            price: Number(form.price.value),
                            price1p: form.price1p.value === '' ? '' : Number(form.price1p.value),
                            price3p: form.price3p.value === '' ? '' : Number(form.price3p.value),
                            totalUnits: Number(form.totalUnits.value),
                            featured: form.featured.value === '1',
                            active: form.active.value === '1',
                            features: form.features.value.split('\n').map((s) => s.trim()).filter(Boolean)
                        });
                        allRooms = [];
                        msg.textContent = 'Saved.'; msg.className = 'form-message success';
                    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
                });
            });

            document.querySelectorAll('.delete-room-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Delete this room permanently? This cannot be undone.')) return;
                    try {
                        await apiSend('DELETE', `/api/rooms/${btn.dataset.id}`, {});
                        allRooms = [];
                        loadRoomsPanel();
                    } catch (err) { alert(err.message); }
                });
            });

            document.querySelectorAll('.room-photo-input').forEach((input) => {
                input.addEventListener('change', async () => {
                    if (!input.files.length) return;
                    const id = input.dataset.id;
                    const msg = document.getElementById(`roomMsg-${id}`);
                    try {
                        const uploaded = await uploadImages(input.files, 'room');
                        const room = allRoomsForPanel.find((r) => String(r.id) === String(id));
                        const nextImages = [...(room.images || []), ...uploaded.map((u) => u.url)];
                        await apiSend('PATCH', `/api/rooms/${id}`, { images: nextImages });
                        loadRoomsPanel();
                    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
                });
            });

            document.querySelectorAll('.remove-photo-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const wrap = btn.closest('.room-photo-thumb');
                    const id = wrap.dataset.room;
                    const index = Number(wrap.dataset.index);
                    const room = allRoomsForPanel.find((r) => String(r.id) === String(id));
                    const nextImages = (room.images || []).filter((_, i) => i !== index);
                    try {
                        await apiSend('PATCH', `/api/rooms/${id}`, { images: nextImages });
                        loadRoomsPanel();
                    } catch (err) { alert(err.message); }
                });
            });
        }

        document.getElementById('rateRuleForm').style.display = canEdit ? 'flex' : 'none';
        document.getElementById('rateRulesTable').closest('div').style.display = canEdit ? 'block' : 'none';
        if (!canEdit) return;

        const rateRoomSelect = document.getElementById('rateRoomId');
        rateRoomSelect.innerHTML = allRoomsForPanel.filter((r) => r.active).map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

        loadRateRules();
    } catch (err) { /* handled */ }
}

document.getElementById('newRoomToggleBtn').addEventListener('click', () => {
    document.getElementById('newRoomForm').style.display = 'block';
    document.getElementById('newRoomToggleBtn').style.display = 'none';
});
document.getElementById('newRoomCancelBtn').addEventListener('click', () => {
    document.getElementById('newRoomForm').style.display = 'none';
    document.getElementById('newRoomToggleBtn').style.display = 'inline-block';
    document.getElementById('newRoomForm').reset();
});
document.getElementById('newRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('newRoomMessage');
    try {
        await apiSend('POST', '/api/rooms', {
            name: form.name.value,
            description: form.description.value,
            price: Number(form.price.value),
            price1p: form.price1p.value === '' ? '' : Number(form.price1p.value),
            price3p: form.price3p.value === '' ? '' : Number(form.price3p.value),
            totalUnits: Number(form.totalUnits.value),
            featured: form.featured.value === '1',
            features: form.features.value.split('\n').map((s) => s.trim()).filter(Boolean),
            images: []
        });
        allRooms = [];
        msg.textContent = 'Room created. Add photos below once it appears in the list.';
        msg.className = 'form-message success';
        form.reset();
        form.style.display = 'none';
        document.getElementById('newRoomToggleBtn').style.display = 'inline-block';
        loadRoomsPanel();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

async function loadRateRules() {
    try {
        const rules = await apiGet('/api/rate-rules');
        document.getElementById('rateRulesBody').innerHTML = rules.map((r) => `
            <tr>
                <td>${escapeHtml(r.room_name)}</td>
                <td>${escapeHtml(r.name)}</td>
                <td>${r.start_date} &rarr; ${r.end_date}</td>
                <td>${r.price_override ? money(r.price_override) + '/night' : r.discount_percent + '% off'}</td>
                <td><button class="action-btn cancel" data-id="${r.id}">Delete</button></td>
            </tr>
        `).join('') || '<tr><td colspan="5">No seasonal rates set.</td></tr>';

        document.querySelectorAll('#rateRulesBody .action-btn.cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this rate rule?')) return;
                await apiSend('DELETE', `/api/rate-rules/${btn.dataset.id}`, {});
                loadRateRules();
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('rateRuleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('rateRuleMessage');
    try {
        await apiSend('POST', '/api/rate-rules', {
            roomId: Number(document.getElementById('rateRoomId').value),
            name: document.getElementById('rateName').value,
            startDate: document.getElementById('rateStart').value,
            endDate: document.getElementById('rateEnd').value,
            priceOverride: document.getElementById('ratePriceOverride').value ? Number(document.getElementById('ratePriceOverride').value) : null,
            discountPercent: document.getElementById('rateDiscount').value ? Number(document.getElementById('rateDiscount').value) : null
        });
        msg.textContent = 'Rate rule added.'; msg.className = 'form-message success';
        e.target.reset();
        loadRateRules();
    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
});

/* ---------------- Expenses ---------------- */
async function loadExpenses() {
    try {
        const expenses = await apiGet('/api/expenses');
        const canDelete = currentUser.role === 'admin';
        document.getElementById('expensesBody').innerHTML = expenses.map((ex) => `
            <tr>
                <td>${ex.expense_date}</td>
                <td>${escapeHtml(ex.category)}</td>
                <td>${escapeHtml(ex.description)}</td>
                <td>${money(ex.amount)}</td>
                <td>${canDelete ? `<button class="action-btn cancel" data-id="${ex.id}">Delete</button>` : ''}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">No expenses recorded.</td></tr>';

        document.querySelectorAll('#expensesBody .action-btn.cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this expense?')) return;
                await apiSend('DELETE', `/api/expenses/${btn.dataset.id}`, {});
                loadExpenses();
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('expenseMessage');
    try {
        await apiSend('POST', '/api/expenses', {
            category: document.getElementById('expenseCategory').value,
            description: document.getElementById('expenseDescription').value,
            amount: Number(document.getElementById('expenseAmount').value),
            expenseDate: document.getElementById('expenseDate').value
        });
        msg.textContent = 'Expense added.'; msg.className = 'form-message success';
        e.target.reset();
        loadExpenses();
    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
});

/* ---------------- Reports ---------------- */
let revenueChartInstance = null;
let occupancyChartInstance = null;
let paymentMethodChartInstance = null;
let roomRevenueChartInstance = null;
let lastRevenueData = [];
let lastExpensesData = [];

function reportDateRange() {
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    return from && to ? `&from=${from}&to=${to}` : '';
}

async function loadReports() {
    try {
        const summary = await apiGet('/api/reports/summary');
        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card"><span>Total Revenue</span><strong>${money(summary.totalRevenue)}</strong></div>
            <div class="summary-card"><span>Completed Payments</span><strong>${money(summary.totalCollected)}</strong></div>
            <div class="summary-card"><span>Pending Payments</span><strong>${money(summary.pendingBalance)}</strong></div>
            <div class="summary-card"><span>Expenses</span><strong>${money(summary.totalExpenses)}</strong></div>
            <div class="summary-card"><span>Net Profit</span><strong>${money(summary.netEarnings)}</strong></div>
            <div class="summary-card"><span>Total Bookings</span><strong>${summary.totalBookings}</strong></div>
            <div class="summary-card"><span>Pending Review</span><strong>${summary.pendingCount}</strong></div>
        `;
        renderRevenueChart();
        renderOccupancyChart();
        renderPaymentMethodChart();
        renderRoomRevenueChart();
    } catch (err) { /* handled */ }
}

async function renderRevenueChart() {
    const range = document.getElementById('revenueRange').value;
    const dateParams = reportDateRange();
    const [revenue, expenses] = await Promise.all([
        apiGet(`/api/reports/revenue?range=${range}${dateParams}`),
        apiGet(`/api/reports/expenses?range=${range}${dateParams}`)
    ]);
    lastRevenueData = revenue;
    lastExpensesData = expenses;
    const periods = Array.from(new Set([...revenue.map((r) => r.period), ...expenses.map((e) => e.period)])).sort();
    const revenueMap = Object.fromEntries(revenue.map((r) => [r.period, r.revenue]));
    const expenseMap = Object.fromEntries(expenses.map((e) => [e.period, e.total]));

    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(document.getElementById('revenueChart'), {
        type: 'bar',
        data: {
            labels: periods,
            datasets: [
                { label: 'Revenue', data: periods.map((p) => revenueMap[p] || 0), backgroundColor: '#c6a15b' },
                { label: 'Expenses', data: periods.map((p) => expenseMap[p] || 0), backgroundColor: '#a5473c' }
            ]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

document.getElementById('revenueRange').addEventListener('change', renderRevenueChart);
document.getElementById('reportFrom').addEventListener('change', loadReports);
document.getElementById('reportTo').addEventListener('change', loadReports);

async function renderOccupancyChart() {
    let from = document.getElementById('reportFrom').value;
    let to = document.getElementById('reportTo').value;
    if (!from || !to) {
        const toDate = new Date();
        toDate.setDate(toDate.getDate() + 30);
        to = toDate.toISOString().slice(0, 10);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 14);
        from = fromDate.toISOString().slice(0, 10);
    }

    const data = await apiGet(`/api/reports/occupancy?from=${from}&to=${to}`);
    if (occupancyChartInstance) occupancyChartInstance.destroy();
    occupancyChartInstance = new Chart(document.getElementById('occupancyChart'), {
        type: 'line',
        data: {
            labels: data.breakdown.map((d) => d.date),
            datasets: [{ label: 'Occupancy Rate', data: data.breakdown.map((d) => Math.round(d.rate * 100)), borderColor: '#14161f', backgroundColor: 'rgba(20,22,31,0.08)', fill: true, tension: 0.3 }]
        },
        options: { responsive: true, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } } }
    });
}

async function renderPaymentMethodChart() {
    const data = await apiGet(`/api/reports/payment-methods?${reportDateRange().replace('&', '')}`);
    if (paymentMethodChartInstance) paymentMethodChartInstance.destroy();
    const palette = ['#c6a15b', '#14161f', '#3d7a4f', '#2f5faa', '#a5473c'];
    paymentMethodChartInstance = new Chart(document.getElementById('paymentMethodChart'), {
        type: 'doughnut',
        data: {
            labels: data.map((d) => PAYMENT_METHOD_LABELS[d.method] || d.method),
            datasets: [{ data: data.map((d) => d.total), backgroundColor: palette }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

async function renderRoomRevenueChart() {
    const data = await apiGet(`/api/reports/room-revenue?${reportDateRange().replace('&', '')}`);
    if (roomRevenueChartInstance) roomRevenueChartInstance.destroy();
    roomRevenueChartInstance = new Chart(document.getElementById('roomRevenueChart'), {
        type: 'bar',
        data: {
            labels: data.map((d) => d.room_name),
            datasets: [{ label: 'Revenue', data: data.map((d) => d.revenue), backgroundColor: '#c6a15b' }]
        },
        options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
}

document.getElementById('reportExportBtn').addEventListener('click', () => {
    const rows = [['Period', 'Revenue', 'Expenses']];
    const periods = Array.from(new Set([...lastRevenueData.map((r) => r.period), ...lastExpensesData.map((e) => e.period)])).sort();
    const revenueMap = Object.fromEntries(lastRevenueData.map((r) => [r.period, r.revenue]));
    const expenseMap = Object.fromEntries(lastExpensesData.map((e) => [e.period, e.total]));
    periods.forEach((p) => rows.push([p, revenueMap[p] || 0, expenseMap[p] || 0]));
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horizon-inn-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

/* ---------------- Staff ---------------- */
async function loadStaff() {
    try {
        const users = await apiGet('/api/users');
        document.getElementById('staffBody').innerHTML = users.map((u) => `
            <tr>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.role)}</td>
                <td>${u.created_at}</td>
                <td>${u.id === currentUser.id ? '' : `<button class="action-btn cancel" data-id="${u.id}">Remove</button>`}</td>
            </tr>
        `).join('');

        document.querySelectorAll('#staffBody .action-btn.cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this staff account?')) return;
                try { await apiSend('DELETE', `/api/users/${btn.dataset.id}`, {}); loadStaff(); }
                catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('staffMessage');
    try {
        await apiSend('POST', '/api/users', {
            username: document.getElementById('staffUsername').value,
            password: document.getElementById('staffPassword').value,
            role: document.getElementById('staffRole').value
        });
        msg.textContent = 'Staff account created.'; msg.className = 'form-message success';
        e.target.reset();
        loadStaff();
    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
});

/* ---------------- Media Library ---------------- */
async function loadMediaLibrary() {
    try {
        const items = await apiGet('/api/media');
        document.getElementById('mediaGrid').innerHTML = items.map((m) => `
            <div class="media-item">
                <img src="${m.url}" alt="${escapeHtml(m.filename)}">
                <div class="media-item-body">
                    <div class="media-item-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</div>
                    <div>${(m.size / 1024).toFixed(0)} KB &middot; ${escapeHtml(m.category)}</div>
                    <div class="media-item-actions">
                        <button type="button" class="action-btn confirm copy-media-url-btn" data-url="${m.url}">Copy URL</button>
                        <button type="button" class="action-btn cancel delete-media-btn" data-id="${m.id}">Delete</button>
                    </div>
                </div>
            </div>
        `).join('') || '<p style="color: var(--text-light);">No images uploaded yet.</p>';

        document.querySelectorAll('.copy-media-url-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(window.location.origin + btn.dataset.url);
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy URL'; }, 1500);
            });
        });
        document.querySelectorAll('.delete-media-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this image? Any room or gallery section using it will show a broken image.')) return;
                try {
                    await apiSend('DELETE', `/api/media/${btn.dataset.id}`, {});
                    loadMediaLibrary();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('mediaUploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('mediaMessage');
    const files = document.getElementById('mediaFiles').files;
    const category = document.getElementById('mediaCategory').value;
    if (!files.length) return;
    try {
        await uploadImages(files, category);
        msg.textContent = 'Uploaded.'; msg.className = 'form-message success';
        e.target.reset();
        loadMediaLibrary();
    } catch (err) {
        msg.textContent = err.message; msg.className = 'form-message error';
    }
});

/* ---------------- Site Content ---------------- */
async function loadSiteContent() {
    try {
        const settings = await apiGet('/api/settings');
        const form = document.getElementById('siteContentForm');
        Object.keys(settings).forEach((key) => {
            if (form[key] !== undefined) form[key].value = settings[key];
        });
    } catch (err) { /* handled */ }
}

document.getElementById('siteContentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = document.getElementById('contentMessage');
    const payload = {};
    Array.from(form.elements).forEach((el) => {
        if (el.name) payload[el.name] = el.value;
    });
    try {
        await apiSend('PATCH', '/api/settings', payload);
        msg.textContent = 'Saved. Changes are live on the site immediately.';
        msg.className = 'form-message success';
    } catch (err) {
        msg.textContent = err.message; msg.className = 'form-message error';
    }
});

/* ---------------- Messages ---------------- */
async function loadMessages() {
    try {
        const messages = await apiGet('/api/contact');
        document.getElementById('messagesBody').innerHTML = messages.map((m) => `
            <tr>
                <td>${m.id}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.email)}</td>
                <td>${escapeHtml(m.message)}</td>
                <td>${m.created_at}</td>
            </tr>
        `).join('') || '<tr><td colspan="5">No messages yet.</td></tr>';
    } catch (err) { /* handled */ }
}

/* ---------------- Login ---------------- */
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('adminUser').value;
    const pass = document.getElementById('adminPass').value;
    const token = btoa(`${user}:${pass}`);

    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) { loginMessage.textContent = 'Invalid username or password.'; return; }
        localStorage.setItem('horizonAdminAuth', token);
        loginMessage.textContent = '';
        showDashboard();
    } catch (err) {
        loginMessage.textContent = 'Network error. Please try again.';
    }
});

if (localStorage.getItem('horizonAdminAuth')) {
    showDashboard();
} else {
    showLogin();
}
