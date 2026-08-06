const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

const BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    checked_out: 'Checked Out', cancelled: 'Cancelled'
};
// The workflow only moves forward — matches the transition map enforced
// server-side in routes/bookings.js. checked_in only ever moves to
// checked_out (via the dedicated Checkout button, not this dropdown);
// checked_out/cancelled aren't listed because they're locked — no further
// moves are offered at all.
const STATUS_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['checked_in', 'cancelled']
};
// A booking's physical room gets assigned two different ways — a manually
// typed invoice-notes field, or automatically via physical_room_id when
// front desk creates/checks in a walk-in — and either one alone can be
// blank. Always resolve to whichever one actually has a value so staff see
// the real assigned room number regardless of which path set it.
function assignedRoomNumber(b) {
    return b.room_number || b.physical_room_number || '';
}
const PAYMENT_METHOD_LABELS = {
    pay_at_property: 'Pay at Property', bank_transfer: 'Bank Transfer',
    easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', cash: 'Cash'
};
const CHARGE_CATEGORY_LABELS = { amenity: 'Amenity', event_rental: 'Event Rental', other: 'Other' };

let currentUser = null;
let allBookings = [];
let bookingsPage = 1;
const BOOKINGS_PAGE_SIZE = 50;
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

// Every timestamp in this app is stored in UTC (SQLite's datetime('now')).
// Horizon Inn operates on Pakistan Standard Time, so always display in that
// zone explicitly rather than whatever timezone the browser happens to be in.
function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }) + ' PKT';
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
        document.getElementById('investorsTabBtn').style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
    } catch (err) { return; }

    loadOverview();
    loadBookings();
    loadMessages();
    updateNotifyBell();

    loadOverdueCheckouts();
    if (!window._overdueCheckoutPoll) {
        window._overdueCheckoutPoll = setInterval(loadOverdueCheckouts, 20000);
    }
}

/* ---------------- Tabs with Fade Transition -------- */
// Expand the subrow (if any) that a tab button belongs to, and mark its
// parent section-toggle active, so the nav shows where you are.
function showSubrowFor(tabBtn) {
    const parentSubrow = tabBtn.closest('.admin-subrow');
    document.querySelectorAll('.admin-subrow').forEach((row) => {
        row.style.display = (row === parentSubrow) ? 'flex' : 'none';
    });
    document.querySelectorAll('.admin-section-toggle').forEach((b) => b.classList.remove('active'));
    if (parentSubrow) {
        const sectionBtn = document.querySelector(`.admin-section-toggle[data-section="${parentSubrow.dataset.subrowFor}"]`);
        if (sectionBtn) sectionBtn.classList.add('active');
    }
}

document.querySelectorAll('.admin-tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
        // Update active tab
        document.querySelectorAll('.admin-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        showSubrowFor(btn);

        // Fade out all panels
        const allPanels = document.querySelectorAll('.admin-panel');
        allPanels.forEach((p) => { p.style.display = 'none'; });

        // Show new panel with fade animation
        const newPanel = document.getElementById(`panel-${btn.dataset.tab}`);
        newPanel.style.display = 'block';
        if (typeof AnimationEngine !== 'undefined' && !AnimationEngine.prefersReducedMotion && typeof anime !== 'undefined') {
            anime({
              targets: newPanel,
              opacity: [0, 1],
              duration: 300,
              easing: 'easeOutQuad'
            });
        } else {
            newPanel.style.opacity = '1';
        }

        if (btn.dataset.tab === 'payments') loadTransactionsPanel();
        if (btn.dataset.tab === 'daily') loadDailySummary();
        if (btn.dataset.tab === 'availability') loadAvailability();
        if (btn.dataset.tab === 'handover') loadHandoverPanel();
        if (btn.dataset.tab === 'guests') loadGuests();
        if (btn.dataset.tab === 'rooms') loadRoomsPanel();
        if (btn.dataset.tab === 'expenses') loadExpenses();
        if (btn.dataset.tab === 'dues') loadCustomerDues();
        if (btn.dataset.tab === 'minibar') loadMinibarPanel();
        if (btn.dataset.tab === 'reports') loadReports();
        if (btn.dataset.tab === 'staff') loadStaff();
        if (btn.dataset.tab === 'media') loadMediaLibrary();
        if (btn.dataset.tab === 'content') loadSiteContent();
        if (btn.dataset.tab === 'investors') loadInvestorsPanel();
        if (btn.dataset.tab === 'venues') loadVenuesPanel();
        if (btn.dataset.tab === 'leads') loadLeadsPanel();
        if (btn.dataset.tab === 'reviews') loadReviewsPanel();
        if (btn.dataset.tab === 'promotions') loadPromotionsPanel();
        if (btn.dataset.tab === 'corporate') loadCorporatePanel();
        if (btn.dataset.tab === 'recovery') loadRecoveryPanel();
        if (btn.dataset.tab === 'overview') loadOverview();
        if (btn.dataset.tab === 'bookings') { localStorage.setItem('horizonLastSeen', new Date().toISOString()); updateNotifyBell(); }
    });
});

/* Section toggles (Operations / Payments & Accounting / Marketing & VIP):
   expand that section's subrow and jump to its first real tab. */
document.querySelectorAll('.admin-section-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
        const subrow = document.querySelector(`.admin-subrow[data-subrow-for="${btn.dataset.section}"]`);
        const firstTab = subrow && subrow.querySelector('.admin-tab[data-tab]');
        if (firstTab) firstTab.click();
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

/* ---------------- Overview ("Today at a Glance") ---------------- */
function jumpToTab(tab, subtab) {
    document.querySelector(`.admin-tab[data-tab="${tab}"]`).click();
    if (subtab) {
        const subtabBtn = document.querySelector(`.minibar-subtab[data-subtab="${subtab}"]`);
        if (subtabBtn) subtabBtn.click();
    }
}

function overviewStatCardHtml({ label, value, tab, subtab, attention }) {
    return `
        <button type="button" class="summary-card clickable ${attention ? 'attention' : ''}" data-jump-tab="${tab}" data-jump-subtab="${subtab || ''}">
            <span>${escapeHtml(label)}</span>
            <strong>${value}</strong>
        </button>
    `;
}

function overviewGuestRowHtml(b) {
    return `
        <li>
            <span>${escapeHtml(b.name)} <span style="color: var(--text-light); font-size: 0.8rem;">&middot; ${escapeHtml(b.room_name)}</span></span>
            <span style="display: flex; gap: 6px;">
                <a class="action-btn confirm" href="${whatsappLink(b)}" target="_blank" rel="noopener">WhatsApp</a>
                <button class="action-btn details-toggle overview-manage-btn" data-id="${b.id}">Manage</button>
            </span>
        </li>
    `;
}

async function loadOverview() {
    try {
        // Initialize LoadingStateManager for KPI cards (fast fade-out, no delay)
        const kpiManager = typeof LoadingStateManager !== 'undefined' ?
            new LoadingStateManager('#kpiCardsContainer', '#kpiCardsContent', { delayBeforeHide: 0, duration: 300 }) : null;

        const data = await apiGet('/api/reports/overview');

        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        document.getElementById('overviewGreeting').textContent = `${greeting} — Today at a Glance`;

        // Populate KPI cards
        const occupancyPercent = Math.round(data.occupancy.rate * 100);
        document.getElementById('kpiOccupancyValue').textContent = `${occupancyPercent}%`;
        document.getElementById('kpiOccupancyMeta').textContent = `${data.occupancy.occupied} of ${data.occupancy.capacity} rooms`;

        document.getElementById('kpiRevenueValue').textContent = `Rs. ${Math.round(data.totalReceivedToday).toLocaleString('en-PK')}`;
        document.getElementById('kpiRevenueMeta').textContent = data.totalReceivedToday > 0 ? '↑ Growth' : 'No revenue yet';

        document.getElementById('kpiBookingsValue').textContent = data.arrivals.length + data.departures.length;
        document.getElementById('kpiBookingsMeta').textContent = `${data.arrivals.length} check-ins, ${data.departures.length} check-outs`;

        document.getElementById('kpiExpensesValue').textContent = `Rs. ${Math.round(data.expensesTotalToday).toLocaleString('en-PK')}`;
        document.getElementById('kpiExpensesMeta').textContent = data.netCashToday > 0 ? 'Net: +Rs. ' + Math.round(data.netCashToday).toLocaleString('en-PK') : 'Net negative';

        // Animate KPI cards in with skeleton manager
        if (kpiManager) {
            // Show content and hide skeleton
            const contentEl = document.getElementById('kpiCardsContent');
            if (contentEl) {
                contentEl.style.display = 'grid';
                contentEl.style.opacity = '1';
            }

            kpiManager.hideSkeleton();

            // Animate in with stagger and count-up (no artificial delays)
            kpiManager.animateIn();

            // Count-up animations for KPI values (start immediately)
            if (typeof AnimationEngine !== 'undefined') {
                AnimationEngine.countUp('#kpiOccupancyValue', occupancyPercent, 1200);
                AnimationEngine.countUp('#kpiRevenueValue', Math.round(data.totalReceivedToday), 1200);
                AnimationEngine.countUp('#kpiBookingsValue', data.arrivals.length + data.departures.length, 1200);
                AnimationEngine.countUp('#kpiExpensesValue', Math.round(data.expensesTotalToday), 1200);
            }
        }

        const pulseCards = [
            { label: 'Arriving Today', value: data.arrivals.length, tab: 'bookings' },
            { label: 'Departing Today', value: data.departures.length, tab: 'bookings' },
            { label: 'Occupancy Today', value: `${data.occupancy.occupied}/${data.occupancy.capacity} rooms (${Math.round(data.occupancy.rate * 100)}%)`, tab: 'availability' },
            { label: 'Total Revenue Today', value: money(data.totalReceivedToday), tab: 'daily' },
            { label: 'Cash Received Today', value: money(data.cashReceivedToday), tab: 'daily' },
            { label: 'Expenses Today', value: money(data.expensesTotalToday), tab: 'daily' },
            { label: 'Net Cash Today', value: money(data.netCashToday), tab: 'daily' },
            { label: 'Mini Bar Sales Today', value: money(data.minibarSalesToday), tab: 'minibar', subtab: 'analytics' },
            { label: 'Pending Handover Amount', value: money(data.pendingHandoverTotal), tab: 'handover' }
        ];
        document.getElementById('overviewPulseCards').innerHTML = pulseCards.map(overviewStatCardHtml).join('');
        // Animate pulse cards in with stagger
        if (typeof AnimationEngine !== 'undefined') {
          AnimationEngine.staggerFadeSlideUp('#overviewPulseCards > div', 100, 500);
        }
        document.querySelectorAll('#overviewPulseCards [data-jump-tab]').forEach((btn) => {
            btn.addEventListener('click', () => jumpToTab(btn.dataset.jumpTab, btn.dataset.jumpSubtab));
        });

        const attentionCards = [
            { label: 'Unpaid Balance', value: money(data.outstandingTotal), tab: 'payments', attention: data.outstandingTotal > 0 },
            { label: 'Cancellation Requests', value: data.cancellationRequests.length, tab: 'bookings', attention: data.cancellationRequests.length > 0 },
            { label: 'Vouchers to Verify', value: data.pendingVouchers.length, tab: 'promotions', attention: data.pendingVouchers.length > 0 },
            { label: 'Recovery Leads', value: data.openRecovery.length, tab: 'recovery', attention: data.openRecovery.length > 0 },
            { label: 'Reviews to Moderate', value: data.pendingReviews.length, tab: 'reviews', attention: data.pendingReviews.length > 0 },
            { label: 'New Investor Leads', value: data.newLeads.length, tab: 'leads', attention: data.newLeads.length > 0 },
            { label: 'Mini Bar Low Stock', value: data.lowStockMinibar.length, tab: 'minibar', subtab: 'store', attention: data.lowStockMinibar.length > 0 },
            { label: 'Investor Withdrawal Requests', value: data.pendingWithdrawals.length, tab: 'investors', attention: data.pendingWithdrawals.length > 0 }
        ];
        document.getElementById('overviewStatCards').innerHTML = attentionCards.map(overviewStatCardHtml).join('');
        // Animate stat cards in with stagger (with slight delay)
        if (typeof AnimationEngine !== 'undefined') {
          setTimeout(() => {
            AnimationEngine.staggerFadeSlideUp('#overviewStatCards > div', 100, 500);
          }, 200);
        }
        document.querySelectorAll('#overviewStatCards [data-jump-tab]').forEach((btn) => {
            btn.addEventListener('click', () => jumpToTab(btn.dataset.jumpTab, btn.dataset.jumpSubtab));
        });

        document.getElementById('overviewArrivals').innerHTML =
            data.arrivals.map(overviewGuestRowHtml).join('') || '<li class="empty-row">No arrivals scheduled today.</li>';
        document.getElementById('overviewDepartures').innerHTML =
            data.departures.map(overviewGuestRowHtml).join('') || '<li class="empty-row">No departures scheduled today.</li>';

        document.querySelectorAll('.overview-manage-btn').forEach((btn) => {
            btn.addEventListener('click', () => jumpToBooking(btn.dataset.id));
        });
    } catch (err) { /* handled by apiGet */ }
}

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

// Once checked in, the only remaining move is checkout — no dropdown, just
// a single button, so there's no way to bounce a checked-in guest back to
// pending or cancel the room from here. Checked-out/cancelled bookings are
// locked (server-enforced too) and shown as a plain status pill with no
// control at all.
function bookingStatusCellHtml(b) {
    if (b.status === 'checked_out' || b.status === 'cancelled') {
        return `<span class="status-pill ${b.status}">${STATUS_LABELS[b.status]}</span>`;
    }
    if (b.status === 'checked_in') {
        return `
            <button type="button" class="action-btn confirm checkout-btn" data-id="${b.id}">Checkout</button>
            <button type="button" class="action-btn details-toggle extend-btn" data-id="${b.id}" style="margin-top: 4px;">Extend Stay</button>
        `;
    }
    const options = [b.status, ...(STATUS_TRANSITIONS[b.status] || [])];
    return `
        <select class="status-select" data-id="${b.id}">
            ${options.map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
    `;
}

function bookingRowHtml(b) {
    const balance = Math.max(0, Number(b.total_amount) - (b._paidTotal || 0));
    return `
        <tr>
            <td>${b.id}</td>
            <td>
                ${escapeHtml(b.name)}<br><small>${escapeHtml(b.email)} &middot; ${escapeHtml(b.phone)}</small>
                ${b.cancellation_requested_at ? '<br><span class="status-pill cancelled" style="margin-top: 4px; display: inline-block;">Cancellation Requested</span>' : ''}
            </td>
            <td>
                ${escapeHtml(b.room_name)}
                ${assignedRoomNumber(b) ? `<br><small>Room ${escapeHtml(assignedRoomNumber(b))}</small>` : ''}
            </td>
            <td>${b.checkin}</td>
            <td>${b.checkout}</td>
            <td>${b.guests}</td>
            <td>${bookingStatusCellHtml(b)}</td>
            <td>
                <div class="payment-method-label">${PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method}</div>
                <span class="status-pill ${b.payment_status}">${b.payment_status}</span>
                <div style="font-size: 0.78rem; color: var(--text-light); margin-top: 4px;">Total ${money(b.total_amount)}</div>
            </td>
            <td>
                <button class="action-btn details-toggle" data-target="details-${b.id}" data-id="${b.id}">View</button>
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
        const [b, minibarItems] = await Promise.all([
            apiGet(`/api/bookings/${id}`),
            apiGet('/api/minibar')
        ]);
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
            <div class="detail-group">
                <div class="detail-group-label">Guest Identity</div>
                <div class="detail-grid">
                    ${detailField('Room Number', assignedRoomNumber(b))}
                    ${detailField('CNIC / Passport', b.cnic)}
                    ${detailField('Marital Status', b.marital_status)}
                    ${detailField('Address', b.address)}
                </div>
            </div>
            <div class="detail-group">
                <div class="detail-group-label">Travel Details</div>
                <div class="detail-grid">
                    ${detailField('Arriving From', b.arrival_from)}
                    ${detailField('Departing To', b.departure_to)}
                    ${detailField('Arrival Time', b.arrival_time)}
                    ${detailField('Purpose of Stay', b.purpose_of_stay)}
                    ${detailField('Vehicle Number', b.vehicle_number)}
                </div>
            </div>
            <div class="detail-group">
                <div class="detail-group-label">Payment &amp; Booking</div>
                <div class="detail-grid">
                    ${detailField('Payment Method', PAYMENT_METHOD_LABELS[b.payment_method] || b.payment_method)}
                    ${detailField('Transaction ID', b.transaction_id)}
                    ${detailField('Special Requests', b.special_requests)}
                    ${detailField('Terms Accepted', b.terms_accepted ? 'Yes' : 'No')}
                    ${detailField('Booked At', b.created_at)}
                </div>
            </div>

            <div class="detail-subsection">
                <h4>Invoice &mdash; ${escapeHtml(b.invoice_number)}</h4>
                <form class="inline-form invoice-fields-form" data-id="${id}">
                    <input type="text" name="roomNumber" value="${escapeHtml(assignedRoomNumber(b))}" placeholder="Room number (e.g. 12)">
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
                    <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th></th></tr></thead>
                    <tbody>
                        <tr><td>${escapeHtml(b.room_name)} (room charge)</td><td>Room Booking</td><td>${money(b.room_amount)}</td><td></td></tr>
                        ${b.charges.map((c) => `<tr ${c.amount < 0 ? 'class="discount-row"' : ''}><td>${escapeHtml(c.description)}</td><td>${CHARGE_CATEGORY_LABELS[c.category] || 'Other'}</td><td>${money(c.amount)}</td><td><button class="action-btn cancel remove-charge-btn" data-booking="${id}" data-charge="${c.id}">Remove</button></td></tr>`).join('')}
                    </tbody>
                </table>
                <form class="inline-form charge-form" data-id="${id}">
                    <input type="text" name="description" placeholder="Extra service or discount (e.g. Barbecue, Bonfire)" required>
                    <select name="category">
                        <option value="amenity">Amenity</option>
                        <option value="event_rental">Event Rental</option>
                        <option value="other" selected>Other</option>
                    </select>
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
                <h4>Mini Bar</h4>
                <form class="inline-form minibar-charge-form" data-id="${id}">
                    <select name="itemId" required>
                        <option value="">Select an item&hellip;</option>
                        ${minibarItems.filter((i) => i.active).map((i) => `<option value="${i.id}" ${i.stockQuantity <= 0 ? 'disabled' : ''}>${escapeHtml(i.name)} &mdash; ${money(i.price)} (${i.stockQuantity} left)</option>`).join('')}
                    </select>
                    <input type="number" name="quantity" value="1" min="1" step="1" style="max-width: 90px;">
                    <button type="submit" class="action-btn confirm">Charge Guest</button>
                </form>
                <p class="form-message" id="minibarChargeMessage-${id}"></p>
            </div>

            <div class="detail-subsection">
                <h4>Payments &mdash; Total ${money(b.total_amount)}, Paid ${money(paidTotal)}, Balance ${money(balance)}</h4>
                <table class="admin-table mini-table">
                    <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Txn ID</th><th>Note</th><th>By</th>${currentUser.role === 'admin' ? '<th></th>' : ''}</tr></thead>
                    <tbody>
                        ${b.payments.map((p) => `<tr><td>${formatPKT(p.recorded_at)}</td><td>${money(p.amount)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.transaction_id)}</td><td>${escapeHtml(p.note)}</td><td>${escapeHtml(p.recorded_by)}</td>${currentUser.role === 'admin' ? `<td><button class="action-btn cancel remove-payment-btn" data-booking="${id}" data-payment="${p.id}">Remove</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${currentUser.role === 'admin' ? 7 : 6}">No payments recorded yet.</td></tr>`}
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

            ${b.statusHistory.length ? `
            <div class="detail-subsection">
                <h4>Status History</h4>
                <table class="admin-table mini-table">
                    <thead><tr><th>When</th><th>Change</th><th>By</th><th>Reason</th></tr></thead>
                    <tbody>
                        ${b.statusHistory.map((h) => `
                            <tr>
                                <td>${formatPKT(h.changed_at)}</td>
                                <td>${STATUS_LABELS[h.from_status] || h.from_status} &rarr; ${STATUS_LABELS[h.to_status] || h.to_status}</td>
                                <td>${escapeHtml(h.changed_by)}</td>
                                <td>${escapeHtml(h.reason)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            ${currentUser.role === 'admin' ? `
            <div class="detail-subsection danger-zone">
                <h4>Danger Zone</h4>
                <p style="font-size: 0.82rem; color: var(--text-light); margin-bottom: 10px;">Permanently deletes this booking and its payment history. Use only to correct a booking created by mistake &mdash; this cannot be undone.</p>
                <button type="button" class="action-btn cancel delete-booking-btn" data-id="${id}">Delete This Booking</button>
            </div>
            ` : ''}
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
                    amount: Number(form.amount.value),
                    category: form.category.value
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

        cell.querySelectorAll('.remove-payment-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this payment record? This cannot be undone.')) return;
                try {
                    await apiSend('DELETE', `/api/bookings/${btn.dataset.booking}/payments/${btn.dataset.payment}`, {});
                    loadBookings(true, id);
                } catch (err) {
                    alert(err.message);
                }
            });
        });

        const deleteBookingBtn = cell.querySelector('.delete-booking-btn');
        if (deleteBookingBtn) {
            deleteBookingBtn.addEventListener('click', async () => {
                if (!confirm(`Permanently delete booking #${id} and its full payment history? This cannot be undone.`)) return;
                try {
                    await apiSend('DELETE', `/api/bookings/${id}`, {});
                    loadBookings(false);
                } catch (err) {
                    alert(err.message);
                }
            });
        }

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

        cell.querySelector('.minibar-charge-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const msg = document.getElementById(`minibarChargeMessage-${id}`);
            if (!form.itemId.value) return;
            try {
                await apiSend('POST', `/api/minibar/${form.itemId.value}/consume`, {
                    bookingId: id, quantity: Number(form.quantity.value)
                });
                msg.textContent = 'Charged to the guest\'s bill.'; msg.className = 'form-message success';
                loadBookings(true, id);
            } catch (err) {
                msg.textContent = err.message; msg.className = 'form-message error';
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
        const data = await apiGet('/api/bookings');
        allBookings = data.bookings;
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

    const totalPages = Math.max(1, Math.ceil(filtered.length / BOOKINGS_PAGE_SIZE));
    bookingsPage = Math.min(bookingsPage, totalPages);
    const pageStart = (bookingsPage - 1) * BOOKINGS_PAGE_SIZE;
    const pageRows = filtered.slice(pageStart, pageStart + BOOKINGS_PAGE_SIZE);

    document.getElementById('bookingsPageLabel').textContent =
        filtered.length ? `Page ${bookingsPage} of ${totalPages} (${filtered.length} bookings)` : '';
    document.getElementById('bookingsPrevPage').disabled = bookingsPage <= 1;
    document.getElementById('bookingsNextPage').disabled = bookingsPage >= totalPages;

    const body = document.getElementById('bookingsBody');
    body.innerHTML = pageRows.map(bookingRowHtml).join('') || '<tr><td colspan="9">No bookings match.</td></tr>';

    // Animate table rows in with stagger
    if (typeof AnimationEngine !== 'undefined' && pageRows.length > 0) {
      const rows = body.querySelectorAll('tr');
      rows.forEach((row, idx) => {
        row.classList.add('animate-row');
        row.style.opacity = '0';
        row.style.transform = 'translateY(8px)';
      });
      AnimationEngine.staggerFadeSlideUp('tbody tr.animate-row', 50, 400);
    }

    body.querySelectorAll('.status-select').forEach((select) => {
        const previousValue = select.value;
        select.addEventListener('change', async () => {
            let reason;
            if (select.value === 'cancelled' && previousValue !== 'cancelled') {
                const booking = allBookings.find((b) => String(b.id) === String(select.dataset.id));
                if (!confirm(`Cancel ${booking ? booking.name + "'s" : "this"} booking? This can't be undone from here.`)) {
                    select.value = previousValue;
                    return;
                }
                reason = prompt('Reason for cancelling (optional, helps if anyone asks later):', '') || '';
            }

            select.disabled = true;
            try {
                await apiSend('PATCH', `/api/bookings/${select.dataset.id}`, { status: select.value, reason });
                loadBookings();
            } catch (err) { alert(err.message); select.disabled = false; }
        });
    });

    body.querySelectorAll('.checkout-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const booking = allBookings.find((b) => String(b.id) === String(btn.dataset.id));
            if (booking) openCheckoutModal(booking);
        });
    });

    body.querySelectorAll('.extend-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const booking = allBookings.find((b) => String(b.id) === String(btn.dataset.id));
            if (booking) await extendBookingStay(booking, btn);
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

let bookingSearchDebounceTimer = null;
document.getElementById('bookingSearch').addEventListener('input', () => {
    clearTimeout(bookingSearchDebounceTimer);
    bookingSearchDebounceTimer = setTimeout(() => { bookingsPage = 1; applyBookingFilters(); }, 300);
});
document.getElementById('bookingStatusFilter').addEventListener('change', () => { bookingsPage = 1; applyBookingFilters(); });
document.getElementById('bookingPaymentFilter').addEventListener('change', () => { bookingsPage = 1; applyBookingFilters(); });
document.getElementById('bookingsPrevPage').addEventListener('click', () => { bookingsPage -= 1; applyBookingFilters(); });
document.getElementById('bookingsNextPage').addEventListener('click', () => { bookingsPage += 1; applyBookingFilters(); });

/* ---------------- Checkout ---------------- */
/* ---------------- Overdue checkouts (polled alert, no auto-charge) ---------------- */
let overdueBookingsCache = [];

async function loadOverdueCheckouts() {
    const banner = document.getElementById('overdueCheckoutBanner');
    if (!banner) return;
    try {
        const data = await apiGet('/api/bookings/overdue-checkouts');
        overdueBookingsCache = data.overdue || [];
        if (!overdueBookingsCache.length) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            return;
        }
        banner.style.display = 'block';
        banner.innerHTML = `
            <div class="overdue-banner">
                <div class="overdue-banner-title">
                    <i class="fas fa-triangle-exclamation"></i>
                    ${overdueBookingsCache.length} guest${overdueBookingsCache.length > 1 ? 's' : ''} past checkout, still checked in
                </div>
                ${overdueBookingsCache.map((b) => `
                    <div class="overdue-row">
                        <div class="overdue-row-info">
                            <strong>${escapeHtml(b.name)}</strong> — ${escapeHtml(b.room_name)}${b.physical_room_number ? ` (Room ${escapeHtml(b.physical_room_number)})` : ''}
                            <small>Was due out ${b.checkout}</small>
                        </div>
                        <div class="overdue-row-actions">
                            <button type="button" class="action-btn confirm overdue-extend-btn" data-id="${b.id}">Extend Stay</button>
                            <button type="button" class="action-btn overdue-latefee-btn" data-id="${b.id}">Add Late Fee</button>
                            <button type="button" class="action-btn details-toggle overdue-view-btn" data-id="${b.id}">View Booking</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        banner.querySelectorAll('.overdue-extend-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const booking = overdueBookingsCache.find((b) => String(b.id) === String(btn.dataset.id));
                if (booking) await extendBookingStay(booking, btn);
            });
        });
        banner.querySelectorAll('.overdue-latefee-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const booking = overdueBookingsCache.find((b) => String(b.id) === String(btn.dataset.id));
                if (!booking) return;
                const amountInput = prompt(`Late checkout fee for ${booking.name}:`, '1000');
                if (amountInput === null) return;
                const amount = Number(amountInput);
                if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
                btn.disabled = true;
                try {
                    await apiSend('POST', `/api/bookings/${booking.id}/charges`, {
                        description: 'Late Checkout Fee', amount, category: 'other'
                    });
                    alert('Late checkout fee added.');
                    allBookings = [];
                    loadBookings();
                } catch (err) { alert(err.message); } finally { btn.disabled = false; }
            });
        });
        banner.querySelectorAll('.overdue-view-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelector('.admin-tab[data-tab="bookings"]')?.click();
                document.getElementById('bookingSearch').value = '';
                setTimeout(() => {
                    const toggleBtn = document.querySelector(`.details-toggle[data-target="details-${btn.dataset.id}"]`);
                    if (toggleBtn) toggleBtn.click();
                    toggleBtn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            });
        });
    } catch (err) { /* silent — this is a background poll, not a user action */ }
}

async function extendBookingStay(booking, triggerBtn) {
    const nightsInput = prompt(`Extend ${booking.name}'s stay in ${booking.room_name} by how many nights?\nCurrent check-out: ${booking.checkout}`, '1');
    if (nightsInput === null) return; // cancelled
    const nights = Number(nightsInput);
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) {
        alert('Enter a whole number of nights between 1 and 30.');
        return;
    }
    if (triggerBtn) triggerBtn.disabled = true;
    try {
        const result = await apiSend('POST', `/api/bookings/${booking.id}/extend`, { nights });
        alert(`Stay extended by ${result.nightsAdded} night(s). New check-out: ${result.booking.checkout}. Added ${money(result.amountAdded)} to the bill (new total: ${money(result.totals.total)}).`);
        allBookings = [];
        loadBookings();
        loadOverdueCheckouts();
    } catch (err) {
        alert(err.message);
    } finally {
        if (triggerBtn) triggerBtn.disabled = false;
    }
}

function openCheckoutModal(booking) {
    if (!booking) return;
    const paidTotal = Number(booking.paid_total || 0);
    const balance = Math.max(0, Number(booking.total_amount) - paidTotal);
    const knownMethods = ['cash', 'bank_transfer', 'easypaisa', 'jazzcash'];

    document.getElementById('checkoutModalSubtitle').textContent =
        `${booking.name} — ${booking.room_name} (${booking.checkin} to ${booking.checkout})`;
    document.getElementById('checkoutModalSummary').innerHTML = `
        <div><span>Total Charges</span><span>${money(booking.total_amount)}</span></div>
        <div><span>Already Paid</span><span>${money(paidTotal)}</span></div>
        <div class="grand"><span>Balance Due</span><span id="balanceDueValue">${money(balance)}</span></div>
    `;
    document.getElementById('checkoutAmount').value = balance > 0 ? balance.toFixed(2) : 0;
    document.getElementById('checkoutMethod').value = knownMethods.includes(booking.payment_method) ? booking.payment_method : 'cash';
    document.getElementById('checkoutTransactionId').value = '';
    document.getElementById('checkoutMessage').textContent = '';
    document.getElementById('checkoutMessage').className = 'form-message';
    document.getElementById('checkoutForm').dataset.id = booking.id;

    // Show modal with slide-up animation
    const overlay = document.getElementById('checkoutModalOverlay');
    overlay.style.display = 'flex';

    // Animate breakdown items with stagger
    setTimeout(() => {
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.animateModalSummary('#checkoutModalSummary', 100);
            // Count up the balance due amount
            if (balance > 0) {
                AnimationEngine.countUp('#balanceDueValue', balance, 800);
            }
        }
    }, 100);
}

document.getElementById('closeCheckoutModalBtn').addEventListener('click', () => {
    document.getElementById('checkoutModalOverlay').style.display = 'none';
});
document.getElementById('checkoutModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'checkoutModalOverlay') {
        document.getElementById('checkoutModalOverlay').style.display = 'none';
    }
});

document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id;
    const msg = document.getElementById('checkoutMessage');
    const amount = Number(document.getElementById('checkoutAmount').value || 0);
    const submitBtn = form.querySelector('button[type="submit"]');

    msg.textContent = '';
    msg.className = 'form-message';
    submitBtn.disabled = true;
    try {
        const result = await apiSend('POST', `/api/bookings/${id}/checkout`, {
            amount: amount > 0 ? amount : undefined,
            method: document.getElementById('checkoutMethod').value,
            transactionId: document.getElementById('checkoutTransactionId').value
        });

        // Close modal
        document.getElementById('checkoutModalOverlay').style.display = 'none';

        // Show success toast
        const when = formatPKT(result.booking.checked_out_at);
        const toastMsg = amount > 0 ? `Payment recorded at ${when}` : `Checkout completed at ${when}`;
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.showToast(toastMsg, 'success', 4000);
        } else {
            alert(toastMsg);
        }

        // Reload bookings
        loadBookings();
    } catch (err) {
        // Show error toast instead of alert
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.showToast(err.message, 'error', 4000);
        }
        msg.textContent = err.message;
        msg.className = 'form-message error';
    } finally {
        submitBtn.disabled = false;
    }
});

/* ---------------- Daily Summary ---------------- */
function dailyRowHtml(b) {
    const roomCell = assignedRoomNumber(b) ? `${escapeHtml(b.room_name)}<br><small>Room ${escapeHtml(assignedRoomNumber(b))}</small>` : escapeHtml(b.room_name);
    return `<tr><td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.phone)}</small></td><td>${roomCell}</td><td>${b.guests}</td><td><span class="status-pill ${b.status}">${STATUS_LABELS[b.status]}</span></td><td>${money(b.balance)}</td></tr>`;
}

async function loadDailySummary() {
    const dateInput = document.getElementById('dailyDate');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    try {
        const data = await apiGet(`/api/reports/daily-summary?date=${dateInput.value}`);

        document.getElementById('dailyCards').innerHTML = `
            <div class="summary-card"><span>Check-ins</span><strong>${data.checkins.length}</strong></div>
            <div class="summary-card"><span>Check-outs</span><strong>${data.checkouts.length}</strong></div>
            <div class="summary-card"><span>Total Revenue Today</span><strong>${money(data.totalReceivedToday)}</strong></div>
            <div class="summary-card"><span>Cash Received Today</span><strong>${money(data.cashReceivedToday)}</strong></div>
            <div class="summary-card"><span>Bank Transfers Today</span><strong>${money(data.bankReceivedToday)}</strong></div>
            <div class="summary-card"><span>Online Payments Today</span><strong>${money(data.onlineReceivedToday)}</strong></div>
            <div class="summary-card"><span>Expenses Today</span><strong>${money(data.expensesTotalToday)}</strong></div>
            <div class="summary-card"><span>Net Cash Today</span><strong>${money(data.netCashToday)}</strong></div>
            <div class="summary-card"><span>Total Outstanding</span><strong>${money(data.outstandingTotal)}</strong></div>
        `;

        document.getElementById('dailyCheckinsBody').innerHTML = data.checkins.map(dailyRowHtml).join('') || '<tr><td colspan="5">No check-ins scheduled.</td></tr>';
        document.getElementById('dailyCheckoutsBody').innerHTML = data.checkouts.map(dailyRowHtml).join('') || '<tr><td colspan="5">No check-outs scheduled.</td></tr>';
        document.getElementById('dailyExpensesBody').innerHTML = data.expensesToday.map((ex) => `
            <tr><td>${escapeHtml(ex.category)}</td><td>${escapeHtml(ex.description || '')}</td><td>${money(ex.amount)}</td></tr>
        `).join('') || '<tr><td colspan="3">No expenses recorded today.</td></tr>';

        document.getElementById('outstandingBody').innerHTML = data.outstandingBookings.map((b) => `
            <tr><td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.phone)}</small></td><td>${assignedRoomNumber(b) ? `${escapeHtml(b.room_name)}<br><small>Room ${escapeHtml(assignedRoomNumber(b))}</small>` : escapeHtml(b.room_name)}</td><td><span class="status-pill ${b.status}">${STATUS_LABELS[b.status]}</span></td><td>${money(b.total_amount)}</td><td>${money(b.balance)}</td></tr>
        `).join('') || '<tr><td colspan="5">No outstanding balances. 🎉</td></tr>';
    } catch (err) { /* handled */ }
}

document.getElementById('dailyDate').addEventListener('change', loadDailySummary);

document.getElementById('sendDailyEmailBtn').addEventListener('click', async () => {
    const btn = document.getElementById('sendDailyEmailBtn');
    const msg = document.getElementById('sendDailyEmailMessage');
    btn.disabled = true;
    msg.textContent = 'Sending...';
    msg.style.color = '';
    try {
        await apiSend('POST', '/api/reports/daily-summary/send-now', {});
        msg.textContent = 'Sent!';
        msg.style.color = '#3d7a4f';
    } catch (err) {
        msg.textContent = err.message;
        msg.style.color = '#a5473c';
    } finally {
        btn.disabled = false;
        setTimeout(() => { msg.textContent = ''; }, 6000);
    }
});

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

        const [preview, checkedOutData, history] = await Promise.all([
            apiGet('/api/handovers/preview'),
            apiGet('/api/bookings?status=checked_out'),
            apiGet('/api/handovers')
        ]);

        // Cash is the only figure that's actually part of this handover — a
        // handover is a physical cash custody transfer, not a revenue report
        // (that's what Daily Summary is for). Bank/online are shown here only
        // as reference so staff can see the full picture; they're never
        // summed into a "grand total" alongside cash, since that would imply
        // money that never touched the till is somehow part of what's being
        // handed over.
        document.getElementById('handoverSummaryCards').innerHTML = `
            <div class="cash-summary-card animate-row">
                <div class="cash-summary-label">Cash Pending Handover</div>
                <div class="cash-summary-value" id="handoverCashValue">${money(preview.cashTotal)}</div>
            </div>
            <div class="cash-summary-card animate-row">
                <div class="cash-summary-label">Bank Transfers (reference only &mdash; see Daily Summary)</div>
                <div class="cash-summary-value" id="handoverBankValue">${money(preview.bankTotal)}</div>
            </div>
            <div class="cash-summary-card animate-row">
                <div class="cash-summary-label">Online Payments (reference only &mdash; see Daily Summary)</div>
                <div class="cash-summary-value" id="handoverOnlineValue">${money(preview.onlineTotal)}</div>
            </div>
        `;

        // Animate handover summary cards
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.staggerFadeSlideUp('.cash-summary-card', 100, 500);
            // Count up the values
            AnimationEngine.countUp('#handoverCashValue', preview.cashTotal, 1000);
            AnimationEngine.countUp('#handoverBankValue', preview.bankTotal, 1000);
            AnimationEngine.countUp('#handoverOnlineValue', preview.onlineTotal, 1000);
        }

        // preview.payments is one row per actual cash PAYMENT, not per
        // booking — a guest who paid a cash advance and then settled the
        // balance in cash at checkout shows up as two lines here, which is
        // the accurate picture for a cash reconciliation. Not gated on the
        // booking's checkout status at all, unlike the old per-booking list.
        document.getElementById('handoverSimpleList').innerHTML = preview.payments.map((p) => `
            <li>
                <span class="item-label">${escapeHtml(p.name)} <span class="item-meta">${escapeHtml(p.invoice_number)} &middot; Cash</span></span>
                <span class="item-amount">${money(p.amount)}</span>
            </li>
        `).join('') || '<li class="empty-row">No cash payments awaiting handover.</li>';

        document.getElementById('handoverSimpleTotal').innerHTML = `
            <span class="label">Total Cash Pending Handover</span>
            <span class="value">${money(preview.cashTotal)}</span>
        `;

        const checkedOutBookings = checkedOutData.bookings
            .sort((a, b) => (b.checkout > a.checkout ? 1 : -1));

        document.getElementById('handoverLedgerBody').innerHTML = checkedOutBookings.map((b) => `
            <tr>
                <td>${b.checkout}</td>
                <td>${escapeHtml(b.invoice_number)}</td>
                <td>${escapeHtml(b.name)}</td>
                <td>${assignedRoomNumber(b) ? escapeHtml(assignedRoomNumber(b)) : '&mdash;'}</td>
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
                    ${formatPKT(h.created_at)}
                    <span class="status-pill ${h.receiver_type === 'staff' ? 'active-pending' : 'handed-over'}" style="margin-left: 8px;">${h.receiver_type === 'staff' ? 'Custody Transfer' : 'Settled'}</span>
                    <span class="item-meta">
                        ${h.booking_count} booking(s) &middot; Cash ${money(h.cash_total)} &middot; Bank ${money(h.bank_total)} &middot; Online ${money(h.online_total)}
                        &middot; Expenses ${money(h.expenses_total)} &middot; By ${escapeHtml(h.staff_name)} &rarr; ${escapeHtml(h.receiver_type)}: ${escapeHtml(h.receiver_name)}
                        ${h.receiver_type === 'staff' ? ' &middot; shift handover only — still counted in the pending total until banked/paid out' : ''}
                    </span>
                </span>
                <span class="item-amount">${money(h.net_cash_handed)}</span>
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
            <div><span>Cash Collected</span><span id="handoverModalCash">${money(preview.cashTotal)}</span></div>
            <div><span>Bank Transfers</span><span id="handoverModalBank">${money(preview.bankTotal)}</span></div>
            <div><span>Online Payments</span><span id="handoverModalOnline">${money(preview.onlineTotal)}</span></div>
            <div><span>Expenses Paid Out (cash)</span><span id="handoverModalExpenses">-${money(preview.expensesTotal)}</span></div>
            <div class="grand"><span>Total Cash in Hand</span><span id="handoverModalTotal">${money(preview.netCashHanded)}</span></div>
        `;
        document.getElementById('handoverStaffName').value = currentUser.username;
        document.getElementById('handoverDateTime').value = new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short'
        }) + ' PKT';
        document.getElementById('handoverReceiverType').value = 'owner';
        document.getElementById('handoverReceiverNameLabel').textContent = RECEIVER_LABELS.owner;
        document.getElementById('handoverReceiverName').value = '';
        document.getElementById('handoverNote').value = '';

        // Show modal with slide-up animation
        document.getElementById('handoverModalOverlay').style.display = 'flex';

        // Animate breakdown items
        setTimeout(() => {
            if (typeof AnimationEngine !== 'undefined') {
                AnimationEngine.animateModalSummary('#handoverModalSummary', 100);
                // Count up values
                AnimationEngine.countUp('#handoverModalCash', preview.cashTotal, 800);
                AnimationEngine.countUp('#handoverModalBank', preview.bankTotal, 800);
                AnimationEngine.countUp('#handoverModalExpenses', preview.expensesTotal, 800);
                AnimationEngine.countUp('#handoverModalTotal', preview.netCashHanded, 800);
            }
        }, 100);
    } catch (err) {
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.showToast(err.message, 'error', 4000);
        } else {
            alert(err.message);
        }
    }
}

document.getElementById('openHandoverModalBtn').addEventListener('click', openHandoverModal);
document.getElementById('closeHandoverModalBtn').addEventListener('click', () => {
    document.getElementById('handoverModalOverlay').style.display = 'none';
});
document.getElementById('handoverModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'handoverModalOverlay') {
        document.getElementById('handoverModalOverlay').style.display = 'none';
    }
});
document.getElementById('handoverReceiverType').addEventListener('change', (e) => {
    document.getElementById('handoverReceiverNameLabel').textContent = RECEIVER_LABELS[e.target.value];
});

document.getElementById('handoverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('handoverMessage');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    msg.textContent = '';
    msg.className = 'form-message';
    submitBtn.disabled = true;

    try {
        const result = await apiSend('POST', '/api/handovers', {
            receiverType: document.getElementById('handoverReceiverType').value,
            receiverName: document.getElementById('handoverReceiverName').value,
            note: document.getElementById('handoverNote').value
        });

        // Close modal
        document.getElementById('handoverModalOverlay').style.display = 'none';

        // Show success toast
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.showToast(`Handover recorded successfully`, 'success', 4000);
        }

        // Reload handover panel
        await loadHandoverPanel();
    } catch (err) {
        if (typeof AnimationEngine !== 'undefined') {
            AnimationEngine.showToast(err.message, 'error', 4000);
        }
        msg.textContent = err.message;
        msg.className = 'form-message error';
    } finally {
        submitBtn.disabled = false;
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
    // Clear any active filters and jump to whichever page the target
    // booking actually falls on, since the table only renders one page
    // at a time now.
    document.getElementById('bookingSearch').value = '';
    document.getElementById('bookingStatusFilter').value = '';
    document.getElementById('bookingPaymentFilter').value = '';
    const indexInList = allBookings.findIndex((b) => String(b.id) === String(id));
    bookingsPage = indexInList >= 0 ? Math.floor(indexInList / BOOKINGS_PAGE_SIZE) + 1 : 1;

    document.querySelector('.admin-tab[data-tab="bookings"]').click();
    applyBookingFilters();
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
        const canManage = currentUser.role === 'admin';
        document.getElementById('expensesBody').innerHTML = expenses.map((ex) => canManage ? `
            <tr data-id="${ex.id}">
                <td><input type="date" class="exp-date" value="${ex.expense_date}" style="width: 140px;"></td>
                <td><input type="text" class="exp-category" value="${escapeHtml(ex.category)}" style="width: 130px;"></td>
                <td><input type="text" class="exp-description" value="${escapeHtml(ex.description)}" style="width: 160px;"></td>
                <td><input type="number" class="exp-amount" value="${ex.amount}" min="0" step="0.01" style="width: 100px;"></td>
                <td>
                    <button class="action-btn confirm exp-save-btn">Save</button>
                    <button class="action-btn cancel exp-delete-btn">Delete</button>
                </td>
            </tr>
        ` : `
            <tr>
                <td>${ex.expense_date}</td>
                <td>${escapeHtml(ex.category)}</td>
                <td>${escapeHtml(ex.description)}</td>
                <td>${money(ex.amount)}</td>
                <td></td>
            </tr>
        `).join('') || '<tr><td colspan="5">No expenses recorded.</td></tr>';

        if (!canManage) return;

        document.querySelectorAll('#expensesBody .exp-save-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const id = row.dataset.id;
                try {
                    await apiSend('PATCH', `/api/expenses/${id}`, {
                        category: row.querySelector('.exp-category').value,
                        description: row.querySelector('.exp-description').value,
                        amount: Number(row.querySelector('.exp-amount').value),
                        expenseDate: row.querySelector('.exp-date').value
                    });
                    loadExpenses();
                } catch (err) { alert(err.message); }
            });
        });

        document.querySelectorAll('#expensesBody .exp-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this expense?')) return;
                const id = btn.closest('tr').dataset.id;
                try {
                    await apiSend('DELETE', `/api/expenses/${id}`, {});
                    loadExpenses();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

/* ---------------- Customer Dues ---------------- */
const DUES_STATUS_LABELS = { outstanding: 'Outstanding', settled: 'Settled', waived: 'Waived' };

async function loadCustomerDues() {
    try {
        const status = document.getElementById('duesStatusFilter').value;
        const dues = await apiGet(`/api/customer-dues${status ? `?status=${status}` : ''}`);
        const canWaive = currentUser.role === 'admin';

        document.getElementById('duesBody').innerHTML = dues.map((d) => `
            <tr>
                <td>${escapeHtml(d.guest_name)}</td>
                <td>${escapeHtml(d.cnic || d.phone || '—')}</td>
                <td>#${d.booking_id}${d.settled_booking_id ? ` &rarr; #${d.settled_booking_id}` : ''}</td>
                <td>${money(d.amount)}</td>
                <td><span class="status-pill ${d.status === 'outstanding' ? 'pending' : 'confirmed'}">${DUES_STATUS_LABELS[d.status] || d.status}</span></td>
                <td>${formatPKT(d.created_at)}</td>
                <td>${canWaive && d.status === 'outstanding' ? `<button class="action-btn cancel dues-waive-btn" data-id="${d.id}">Waive</button>` : ''}</td>
            </tr>
        `).join('') || '<tr><td colspan="7">No dues to show.</td></tr>';

        document.querySelectorAll('.dues-waive-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Waive this due? The guest will no longer be asked to pay it.')) return;
                try {
                    await apiSend('PATCH', `/api/customer-dues/${btn.dataset.id}`, { status: 'waived' });
                    loadCustomerDues();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('duesStatusFilter').addEventListener('change', loadCustomerDues);

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

/* ---------------- Mini Bar Stock Management ---------------- */
let allMinibarItems = [];
// loadMinibarStore() always fetches fresh (it's the catalog editor tab) and
// marks this true; other tabs that only need to read the catalog (Packages)
// reuse that cache instead of issuing their own redundant fetch.
let minibarItemsCacheValid = false;
let allMinibarRooms = [];
let selectedMinibarRoomId = null;

function minibarStatusPill(item) {
    if (item.stockQuantity <= 0) return '<span class="status-pill cancelled">Out of Stock</span>';
    if (item.stockQuantity <= item.lowStockThreshold) return '<span class="status-pill unpaid">Low Stock</span>';
    return '<span class="status-pill paid">In Stock</span>';
}

function minibarIcon(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('water')) return '💧';
    if (n.includes('cola') || n.includes('sprite') || n.includes('soda') || n.includes('juice') || n.includes('drink')) return '🥤';
    if (n.includes('chip') || n.includes('crisp')) return '🍟';
    if (n.includes('chocolate') || n.includes('kit kat') || n.includes('kitkat')) return '🍫';
    if (n.includes('beer') || n.includes('wine')) return '🍷';
    if (n.includes('coffee') || n.includes('tea')) return '☕';
    if (n.includes('nuts') || n.includes('almond')) return '🥜';
    if (n.includes('candy') || n.includes('sweet')) return '🍬';
    return '🛒';
}

document.querySelectorAll('.minibar-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.minibar-subtab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.minibar-subpanel').forEach((p) => { p.style.display = 'none'; });
        document.getElementById(`minibar-sub-${btn.dataset.subtab}`).style.display = 'block';
        if (btn.dataset.subtab === 'pos') loadMinibarRooms();
        if (btn.dataset.subtab === 'store') loadMinibarStore();
        if (btn.dataset.subtab === 'packages') loadMinibarPackages();
        if (btn.dataset.subtab === 'refills') loadMinibarRefillRequests();
        if (btn.dataset.subtab === 'analytics') loadMinibarAnalytics();
    });
});

async function loadMinibarPanel() {
    loadMinibarRooms();
}

/* ---- POS / Rooms ---- */
function minibarRoomStatusDot(room) {
    if (!room.initialized) return 'grey';
    if (room.lowStockCount > 0) return 'orange';
    if (room.activeBooking) return 'green';
    return 'grey';
}

function minibarRoomCardHtml(r) {
    return `
        <div class="minibar-room-card ${r.id === selectedMinibarRoomId ? 'selected' : ''}" data-id="${r.id}">
            <div class="room-number"><span class="minibar-room-dot ${minibarRoomStatusDot(r)}"></span>Room ${escapeHtml(r.roomNumber)}</div>
            <div class="room-meta">${escapeHtml(r.roomTypeName)}${r.floor ? ` &middot; Floor ${escapeHtml(r.floor)}` : ''}</div>
            <div class="room-guest">${r.activeBooking ? `<strong>${escapeHtml(r.activeBooking.guestName)}</strong>` : '<span style="color: var(--text-light);">No guest checked in</span>'}</div>
            ${r.initialized ? `<div style="font-size: 0.76rem; margin-top: 6px; color: var(--text-light);">${r.itemCount} items tracked${r.lowStockCount ? `, <span style="color: #c98a2c;">${r.lowStockCount} low</span>` : ''}</div>` : '<div style="font-size: 0.76rem; margin-top: 6px; color: var(--text-light);">Not yet stocked</div>'}
        </div>
    `;
}

function bindMinibarRoomCard(card) {
    card.addEventListener('click', () => selectMinibarRoom(Number(card.dataset.id)));
}

async function loadMinibarRooms() {
    try {
        allMinibarRooms = await apiGet('/api/minibar/rooms');
        const grid = document.getElementById('minibarRoomGrid');
        grid.innerHTML = allMinibarRooms.map(minibarRoomCardHtml).join('') || '<p style="color: var(--text-light);">No physical rooms registered yet — add rooms in Rooms &amp; Pricing first.</p>';

        grid.querySelectorAll('.minibar-room-card').forEach(bindMinibarRoomCard);

        if (selectedMinibarRoomId) selectMinibarRoom(selectedMinibarRoomId);
    } catch (err) { /* handled */ }
}

// Update just one room's card in place from data we already fetched for the
// detail panel, instead of refetching and re-rendering the whole grid.
function patchMinibarRoomCard(roomId, room) {
    const cached = allMinibarRooms.find((r) => Number(r.id) === Number(roomId));
    if (!cached) return; // grid not loaded yet — nothing to patch
    cached.activeBooking = room.activeBooking;
    cached.itemCount = room.stock.length;
    cached.lowStockCount = room.stock.filter((s) => s.currentStock < s.openingStock).length;
    cached.initialized = room.stock.length > 0;

    const card = document.querySelector(`.minibar-room-card[data-id="${roomId}"]`);
    if (!card) return;
    card.outerHTML = minibarRoomCardHtml(cached);
    const newCard = document.querySelector(`.minibar-room-card[data-id="${roomId}"]`);
    if (newCard) bindMinibarRoomCard(newCard);
}

async function selectMinibarRoom(roomId) {
    selectedMinibarRoomId = roomId;
    document.querySelectorAll('.minibar-room-card').forEach((c) => c.classList.toggle('selected', Number(c.dataset.id) === roomId));
    const detail = document.getElementById('minibarRoomDetail');
    detail.style.display = 'block';
    document.getElementById('minibarPosMessage').textContent = '';

    try {
        const room = await apiGet(`/api/minibar/rooms/${roomId}`);
        patchMinibarRoomCard(roomId, room);
        document.getElementById('minibarRoomTitle').textContent = `Room ${room.roomNumber}`;
        document.getElementById('minibarRoomGuest').textContent = room.activeBooking
            ? `${room.activeBooking.guestName} — ${room.activeBooking.invoiceNumber}`
            : 'No guest currently checked in — charges cannot be billed until someone is.';

        document.getElementById('minibarPosGrid').innerHTML = room.stock.map((s) => {
            const statusClass = s.currentStock <= 0 ? 'red' : (s.currentStock < s.openingStock ? 'orange' : 'green');
            const statusLabel = s.currentStock <= 0 ? 'Out of Stock' : (s.currentStock < s.openingStock ? 'Low Stock' : 'In Stock');
            return `
                <div class="minibar-pos-item">
                    <div class="item-icon">${minibarIcon(s.name)}</div>
                    <div class="item-name">${escapeHtml(s.name)}</div>
                    <div class="item-price">${money(s.price)}</div>
                    <div class="item-stock ${statusClass}">${statusLabel} &middot; ${s.currentStock} left</div>
                    <div class="item-controls">
                        <input type="number" min="1" step="1" value="1" class="minibar-pos-qty" data-item="${s.minibarItemId}" style="max-width: 60px;" ${s.currentStock <= 0 ? 'disabled' : ''}>
                        <button class="action-btn confirm minibar-pos-charge-btn" data-item="${s.minibarItemId}" data-name="${escapeHtml(s.name)}" ${s.currentStock <= 0 || !room.activeBooking ? 'disabled' : ''}>Charge</button>
                    </div>
                </div>
            `;
        }).join('') || '<p style="color: var(--text-light);">This room has no stock tracked yet. Use "Reset to Package" to initialize it.</p>';

        document.querySelectorAll('.minibar-pos-charge-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const qtyInput = document.querySelector(`.minibar-pos-qty[data-item="${btn.dataset.item}"]`);
                const qty = Number(qtyInput.value) || 1;
                btn.disabled = true;
                const msg = document.getElementById('minibarPosMessage');
                try {
                    await apiSend('POST', `/api/minibar/rooms/${roomId}/consume`, { itemId: btn.dataset.item, quantity: qty });
                    msg.className = 'form-message success';
                    msg.textContent = `Charged ${qty} x ${btn.dataset.name} to the guest's bill.`;
                    selectMinibarRoom(roomId);
                } catch (err) {
                    msg.className = 'form-message error'; msg.textContent = err.message;
                    btn.disabled = false;
                }
            });
        });

        document.getElementById('minibarRoomLogBody').innerHTML = room.log.map((l) => `
            <tr>
                <td>${formatPKT(l.createdAt)}</td>
                <td>${escapeHtml(l.itemName)}</td>
                <td style="text-transform: capitalize;">${l.action}</td>
                <td>${l.quantity > 0 ? '+' : ''}${l.quantity}</td>
                <td>${escapeHtml(l.staffUsername)}</td>
                <td>${escapeHtml(l.note)}</td>
            </tr>
        `).join('') || '<tr><td colspan="6">No activity recorded yet.</td></tr>';

        document.getElementById('minibarResetBtn').onclick = async () => {
            if (!confirm(`Reset Room ${room.roomNumber}'s mini bar to its package levels? This overwrites current counts.`)) return;
            try {
                await apiSend('POST', `/api/minibar/rooms/${roomId}/init`, { force: true });
                selectMinibarRoom(roomId);
            } catch (err) { alert(err.message); }
        };

        document.getElementById('minibarSuggestBtn').onclick = async () => {
            try {
                const suggestions = await apiGet(`/api/minibar/rooms/${roomId}/suggestions`);
                if (!suggestions.length) { alert('No refills suggested right now — everything is at or above its usual level.'); return; }
                const lines = suggestions.map((s) => `${s.name}: +${s.suggestedRefillQty} (currently ${s.currentStock}, avg ${s.avgDailyConsumption}/day)`);
                if (!confirm(`Suggested refills:\n\n${lines.join('\n')}\n\nApply all of these now (drawn from central store)?`)) return;
                for (const s of suggestions) {
                    await apiSend('POST', `/api/minibar/rooms/${roomId}/refill`, { itemId: s.minibarItemId, quantity: s.suggestedRefillQty });
                }
                selectMinibarRoom(roomId);
            } catch (err) { alert(err.message); }
        };

        document.getElementById('minibarDamageBtn').onclick = () => openMinibarDamageModal(roomId, room.roomNumber, room.stock);
    } catch (err) { /* handled */ }
}

/* ---- Damage / Missing modal ---- */
function openMinibarDamageModal(roomId, roomNumber, stock) {
    document.getElementById('minibarDamageSubtitle').textContent = `Room ${roomNumber}`;
    document.getElementById('minibarDamageItem').innerHTML = stock.map((s) => `<option value="${s.minibarItemId}">${escapeHtml(s.name)} (${s.currentStock} in room)</option>`).join('');
    document.getElementById('minibarDamageForm').reset();
    document.getElementById('minibarDamageMessage').textContent = '';
    document.getElementById('minibarDamageModalOverlay').dataset.roomId = roomId;
    document.getElementById('minibarDamageModalOverlay').style.display = 'flex';
}
document.getElementById('minibarCloseDamageModalBtn').addEventListener('click', () => {
    document.getElementById('minibarDamageModalOverlay').style.display = 'none';
});
document.getElementById('minibarDamageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('minibarDamageMessage');
    const roomId = document.getElementById('minibarDamageModalOverlay').dataset.roomId;
    try {
        await apiSend('POST', `/api/minibar/rooms/${roomId}/damage`, {
            itemId: document.getElementById('minibarDamageItem').value,
            quantity: Number(document.getElementById('minibarDamageQty').value),
            type: document.getElementById('minibarDamageType').value,
            reason: document.getElementById('minibarDamageReason').value,
            penaltyAmount: Number(document.getElementById('minibarDamagePenalty').value) || 0
        });
        msg.className = 'form-message success';
        msg.textContent = 'Reported.';
        setTimeout(() => {
            document.getElementById('minibarDamageModalOverlay').style.display = 'none';
            selectMinibarRoom(Number(roomId));
        }, 600);
    } catch (err) { msg.className = 'form-message error'; msg.textContent = err.message; }
});

/* ---- Central Store ---- */
async function loadMinibarStore() {
    try {
        allMinibarItems = await apiGet('/api/minibar');
        minibarItemsCacheValid = true;
        document.getElementById('minibarBody').innerHTML = allMinibarItems.map((item) => `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${money(item.price)}</td>
                <td>${money(item.costPrice)}</td>
                <td>${item.stockQuantity}</td>
                <td>${minibarStatusPill(item)}</td>
                <td>
                    <button class="action-btn confirm minibar-restock-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Restock</button>
                    <button class="action-btn cancel minibar-delete-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}">Delete</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6">No mini bar items yet.</td></tr>';

        document.querySelectorAll('.minibar-restock-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const qty = Number(prompt(`How many ${btn.dataset.name} are you adding to the central store?`, '10'));
                if (!qty || qty <= 0) return;
                try {
                    await apiSend('POST', `/api/minibar/${btn.dataset.id}/restock`, { quantity: qty });
                    loadMinibarStore();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.minibar-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Remove ${btn.dataset.name} from the mini bar catalog?`)) return;
                try {
                    await apiSend('DELETE', `/api/minibar/${btn.dataset.id}`, {});
                    loadMinibarStore();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('minibarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('minibarMessage');
    try {
        await apiSend('POST', '/api/minibar', {
            name: document.getElementById('minibarName').value,
            price: Number(document.getElementById('minibarPrice').value),
            costPrice: Number(document.getElementById('minibarCostPrice').value) || 0,
            stockQuantity: Number(document.getElementById('minibarStock').value) || 0,
            lowStockThreshold: Number(document.getElementById('minibarThreshold').value) || 5
        });
        msg.textContent = 'Item added.'; msg.className = 'form-message success';
        e.target.reset();
        loadMinibarStore();
    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
});

/* ---- Packages ---- */
async function loadMinibarPackages() {
    try {
        if (!minibarItemsCacheValid) {
            allMinibarItems = await apiGet('/api/minibar');
            minibarItemsCacheValid = true;
        }
        const packages = await apiGet('/api/minibar/packages');
        document.getElementById('minibarPackagesList').innerHTML = packages.map((pkg) => `
            <div class="detail-subsection" style="margin: 0;">
                <h4>${escapeHtml(pkg.name)} ${pkg.active ? '' : '<span class="status-pill cancelled">Inactive</span>'}</h4>
                <form class="inline-form minibar-package-items-form" data-id="${pkg.id}">
                    ${allMinibarItems.map((item) => {
                        const existing = pkg.items.find((i) => i.minibarItemId === item.id);
                        return `
                            <label style="display: flex; flex-direction: column; font-size: 0.78rem; gap: 4px;">
                                ${escapeHtml(item.name)}
                                <input type="number" min="0" step="1" value="${existing ? existing.quantity : 0}" data-item="${item.id}" style="max-width: 70px;">
                            </label>
                        `;
                    }).join('')}
                    <button type="submit" class="action-btn confirm">Save Package</button>
                    <button type="button" class="action-btn cancel minibar-package-toggle-btn" data-id="${pkg.id}" data-active="${pkg.active}">${pkg.active ? 'Deactivate' : 'Activate'}</button>
                </form>
            </div>
        `).join('') || '<p style="color: var(--text-light);">No packages yet.</p>';

        document.querySelectorAll('.minibar-package-items-form').forEach((form) => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const items = Array.from(form.querySelectorAll('input[data-item]'))
                    .map((input) => ({ minibarItemId: Number(input.dataset.item), quantity: Number(input.value) }))
                    .filter((i) => i.quantity > 0);
                try {
                    await apiSend('PATCH', `/api/minibar/packages/${form.dataset.id}`, { items });
                    loadMinibarPackages();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.minibar-package-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await apiSend('PATCH', `/api/minibar/packages/${btn.dataset.id}`, { active: btn.dataset.active !== 'true' });
                    loadMinibarPackages();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('minibarPackageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('minibarPackageMessage');
    try {
        await apiSend('POST', '/api/minibar/packages', { name: document.getElementById('minibarPackageName').value, items: [] });
        msg.className = 'form-message success'; msg.textContent = 'Package created — set its item quantities below.';
        e.target.reset();
        loadMinibarPackages();
    } catch (err) { msg.className = 'form-message error'; msg.textContent = err.message; }
});

/* ---- Refill Requests ---- */
async function loadMinibarRefillRequests() {
    try {
        if (!allMinibarRooms.length) allMinibarRooms = await apiGet('/api/minibar/rooms');
        const roomSelect = document.getElementById('minibarRefillRoomSelect');
        roomSelect.innerHTML = allMinibarRooms.map((r) => `<option value="${r.id}">Room ${escapeHtml(r.roomNumber)}</option>`).join('');

        const status = document.getElementById('minibarRefillFilter').value;
        const requests = await apiGet(`/api/minibar/refill-requests${status ? `?status=${status}` : ''}`);
        document.getElementById('minibarRefillBody').innerHTML = requests.map((r) => `
            <tr>
                <td>Room ${escapeHtml(r.roomNumber)}</td>
                <td>${escapeHtml(r.requestedBy)}</td>
                <td>${escapeHtml(r.note)}</td>
                <td><span class="status-pill ${r.status === 'fulfilled' ? 'paid' : (r.status === 'rejected' ? 'cancelled' : 'unpaid')}">${r.status}</span></td>
                <td>${formatPKT(r.createdAt)}</td>
                <td>
                    ${r.status === 'pending' ? `
                        <button class="action-btn confirm minibar-refill-fulfill-btn" data-id="${r.id}">Fulfill</button>
                        <button class="action-btn cancel minibar-refill-reject-btn" data-id="${r.id}">Reject</button>
                    ` : ''}
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6">No refill requests.</td></tr>';

        document.querySelectorAll('.minibar-refill-fulfill-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Mark this refill request as fulfilled? (Do the actual restock from the POS / Rooms tab first.)')) return;
                try {
                    await apiSend('PATCH', `/api/minibar/refill-requests/${btn.dataset.id}`, { status: 'fulfilled' });
                    loadMinibarRefillRequests();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.minibar-refill-reject-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await apiSend('PATCH', `/api/minibar/refill-requests/${btn.dataset.id}`, { status: 'rejected' });
                    loadMinibarRefillRequests();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('minibarRefillRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('minibarRefillMessage');
    try {
        await apiSend('POST', '/api/minibar/refill-requests', {
            physicalRoomId: Number(document.getElementById('minibarRefillRoomSelect').value),
            note: document.getElementById('minibarRefillNote').value
        });
        msg.className = 'form-message success'; msg.textContent = 'Refill requested.';
        document.getElementById('minibarRefillNote').value = '';
        loadMinibarRefillRequests();
    } catch (err) { msg.className = 'form-message error'; msg.textContent = err.message; }
});
document.getElementById('minibarRefillFilter').addEventListener('change', loadMinibarRefillRequests);

/* ---- Analytics ---- */
let minibarSalesChartInstance = null;

async function loadMinibarAnalytics() {
    try {
        const from = document.getElementById('minibarAnalyticsFrom').value;
        const to = document.getElementById('minibarAnalyticsTo').value;
        const query = from && to ? `?from=${from}&to=${to}` : '';
        const data = await apiGet(`/api/minibar/analytics${query}`);

        if (!from) document.getElementById('minibarAnalyticsFrom').value = data.range.from;
        if (!to) document.getElementById('minibarAnalyticsTo').value = data.range.to;

        const totalRevenue = data.dailySales.reduce((sum, d) => sum + d.revenue, 0);
        const totalUnits = data.mostSold.reduce((sum, m) => sum + m.quantity, 0);
        const totalProfit = data.margins.reduce((sum, m) => sum + m.totalProfit, 0);
        const totalPenalty = data.damage.reduce((sum, d) => sum + d.totalPenalty, 0);

        document.getElementById('minibarAnalyticsCards').innerHTML = `
            <div class="summary-card"><span>Revenue (range)</span><strong>${money(totalRevenue)}</strong></div>
            <div class="summary-card"><span>Units Sold</span><strong>${totalUnits}</strong></div>
            <div class="summary-card"><span>Est. Profit</span><strong>${money(totalProfit)}</strong></div>
            <div class="summary-card"><span>Damage/Missing Penalties</span><strong>${money(totalPenalty)}</strong></div>
        `;

        try {
            if (minibarSalesChartInstance) minibarSalesChartInstance.destroy();
            minibarSalesChartInstance = new Chart(document.getElementById('minibarSalesChart'), {
                type: 'bar',
                data: {
                    labels: data.dailySales.map((d) => d.day),
                    datasets: [{ label: 'Revenue', data: data.dailySales.map((d) => d.revenue), backgroundColor: '#c6a15b' }]
                },
                options: {
                    ...chartOptions,
                    plugins: { legend: { display: false } }
                }
            });
        } catch (chartErr) { /* chart library unavailable — tables below still render */ }

        document.getElementById('minibarMostSoldBody').innerHTML = data.mostSold.map((m) => `
            <tr><td>${escapeHtml(m.name)}</td><td>${m.quantity}</td><td>${money(m.revenue)}</td></tr>
        `).join('') || '<tr><td colspan="3">No sales in this range.</td></tr>';

        document.getElementById('minibarMarginsBody').innerHTML = data.margins.map((m) => `
            <tr><td>${escapeHtml(m.name)}</td><td>${m.quantitySold}</td><td>${money(m.totalProfit)}</td></tr>
        `).join('') || '<tr><td colspan="3">No sales yet.</td></tr>';
    } catch (err) { /* handled */ }
}

document.getElementById('minibarAnalyticsRefreshBtn').addEventListener('click', loadMinibarAnalytics);

/* ---------------- Reports ---------------- */
let revenueChartInstance = null;
let occupancyChartInstance = null;
let paymentMethodChartInstance = null;
let roomRevenueChartInstance = null;
let lastRevenueData = [];
let lastExpensesData = [];

// Chart.js animation configuration
const chartAnimationConfig = {
    duration: 600,
    easing: 'easeOutCubic',
    delay: (ctx) => {
        if (ctx.type !== 'data' || ctx.dropped) return 0;
        const delay = (ctx.dataIndex + 1 + ctx.datasetIndex + 1) * 50;
        return Math.min(delay, 300);
    }
};

const chartOptions = {
    responsive: true,
    animation: chartAnimationConfig,
    plugins: {
        legend: { position: 'bottom' }
    }
};

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
        options: chartOptions
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
        options: {
            ...chartOptions,
            scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } }
        }
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
        options: chartOptions
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
        options: {
            ...chartOptions,
            indexAxis: 'y',
            plugins: { legend: { display: false } }
        }
    });
}

/* ---------------- Cash & Financial Controls (Crescent Grove venue bookings) ---------------- */
const VENUE_STATUS_LABELS = {
    pending_cash: 'Pending Cash', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled'
};
let allVenues = [];
let venueLineItems = [];
let venueRevenueChartInstance = null;
let venueOccupancyChartInstance = null;

function venueStatusBadge(status) {
    const cls = status === 'confirmed' || status === 'completed' ? 'confirm' : status === 'cancelled' ? 'cancel' : 'details-toggle';
    return `<span class="action-btn ${cls}" style="cursor: default; display: inline-block;">${VENUE_STATUS_LABELS[status] || status}</span>`;
}

function venueBookingRow(b, pendingOnly) {
    const actions = pendingOnly
        ? `<button type="button" class="action-btn confirm venue-verify-btn" data-id="${b.id}" data-action="approve">Approve Cash Payment</button>
           <button type="button" class="action-btn cancel venue-verify-btn" data-id="${b.id}" data-action="reject">Reject / Cancel</button>`
        : `<a class="action-btn details-toggle" href="venue-invoice.html?id=${b.id}" target="_blank" rel="opener">Invoice</a>
           ${b.status === 'confirmed' ? `<button type="button" class="action-btn confirm venue-complete-btn" data-id="${b.id}">Mark Completed</button>` : ''}
           ${b.status !== 'cancelled' && b.status !== 'completed' ? `<button type="button" class="action-btn cancel venue-cancel-btn" data-id="${b.id}">Cancel</button>` : ''}`;
    return `
        <tr>
            <td>${b.bookingCode}</td>
            <td>${escapeHtml(b.customerName)}</td>
            <td>${escapeHtml(b.venueName)}</td>
            <td>${b.eventDate}</td>
            <td>${money(b.totalAmount)}</td>
            <td>${venueStatusBadge(b.status)}</td>
            <td>${actions}</td>
        </tr>
    `;
}

async function loadVenueBookingsTables() {
    const all = await apiGet('/api/venues/bookings');
    const pending = all.filter((b) => b.status === 'pending_cash');
    document.getElementById('venuePendingBody').innerHTML = pending.length
        ? pending.map((b) => venueBookingRow(b, true)).join('')
        : '<tr><td colspan="7" style="text-align: center; color: var(--text-light);">No pending cash/bank confirmations right now.</td></tr>';

    const statusFilter = document.getElementById('venueFilterStatus').value;
    const filtered = statusFilter ? all.filter((b) => b.status === statusFilter) : all;
    document.getElementById('venueBookingsBody').innerHTML = filtered.length
        ? filtered.map((b) => venueBookingRow(b, false)).join('')
        : '<tr><td colspan="7" style="text-align: center; color: var(--text-light);">No bookings yet.</td></tr>';

    wireVenueRowActions();
}

function wireVenueRowActions() {
    document.querySelectorAll('.venue-verify-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await apiSend('PATCH', `/api/venues/bookings/${btn.dataset.id}/verify`, { action: btn.dataset.action });
                loadVenuesPanel();
            } catch (err) { alert(err.message); }
        });
    });
    document.querySelectorAll('.venue-complete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await apiSend('PATCH', `/api/venues/bookings/${btn.dataset.id}`, { status: 'completed' });
                loadVenuesPanel();
            } catch (err) { alert(err.message); }
        });
    });
    document.querySelectorAll('.venue-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Cancel this booking?')) return;
            try {
                await apiSend('PATCH', `/api/venues/bookings/${btn.dataset.id}`, { status: 'cancelled' });
                loadVenuesPanel();
            } catch (err) { alert(err.message); }
        });
    });
}

async function loadVenueSummaryCards() {
    const from = document.getElementById('venueReportFrom').value;
    const to = document.getElementById('venueReportTo').value;
    const qs = from && to ? `?from=${from}&to=${to}` : '';
    const summary = await apiGet(`/api/venues/analytics${qs}`);

    document.getElementById('venueSummaryCards').innerHTML = `
        <div class="summary-card"><span>Gross Revenue (period)</span><strong>${money(summary.grossRevenue)}</strong></div>
        <div class="summary-card"><span>Pending Cash Confirmations</span><strong>${summary.pendingCashCount} &middot; ${money(summary.pendingCashValue)}</strong></div>
        <div class="summary-card"><span>Net Profit Margin</span><strong>${summary.netMarginPct.toFixed(1)}%</strong></div>
        <div class="summary-card"><span>Occupancy Rate</span><strong>${summary.occupancyPct}%</strong></div>
    `;

    if (venueRevenueChartInstance) venueRevenueChartInstance.destroy();
    venueRevenueChartInstance = new Chart(document.getElementById('venueRevenueChart'), {
        type: 'bar',
        data: {
            labels: summary.revenueByMonth.map((r) => r.period),
            datasets: [
                { label: 'Gross Revenue', data: summary.revenueByMonth.map((r) => r.revenue), backgroundColor: '#d4af37' },
                { label: 'Operating Expenses', data: summary.revenueByMonth.map((r) => r.expenses), backgroundColor: '#a5473c' }
            ]
        },
        options: chartOptions
    });

    if (venueOccupancyChartInstance) venueOccupancyChartInstance.destroy();
    const occupancyEntries = Object.entries(summary.perVenueOccupancy);
    venueOccupancyChartInstance = new Chart(document.getElementById('venueOccupancyChart'), {
        type: 'doughnut',
        data: {
            labels: occupancyEntries.map(([name]) => name),
            datasets: [{ data: occupancyEntries.map(([, pct]) => pct), backgroundColor: ['#d4af37', '#14161f', '#3d7a4f', '#2f5faa'] }]
        },
        options: chartOptions
    });
}

function renderVenueLineItemsList() {
    document.getElementById('venueLineItemsList').innerHTML = venueLineItems.map((li, i) => `
        <li>${escapeHtml(li.description)} — ${money(li.amount)} <a href="#" data-i="${i}" class="venue-remove-line-item">(remove)</a></li>
    `).join('');
    document.querySelectorAll('.venue-remove-line-item').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            venueLineItems.splice(Number(a.dataset.i), 1);
            renderVenueLineItemsList();
        });
    });
}

document.getElementById('venueAddLineItemBtn').addEventListener('click', () => {
    const desc = document.getElementById('venueLineItemDesc').value.trim();
    const amount = Number(document.getElementById('venueLineItemAmount').value);
    if (!desc || !amount) return;
    venueLineItems.push({ description: desc, amount });
    document.getElementById('venueLineItemDesc').value = '';
    document.getElementById('venueLineItemAmount').value = '';
    renderVenueLineItemsList();
});

document.getElementById('venueNewBookingToggle').addEventListener('click', () => {
    const form = document.getElementById('venueBookingForm');
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
});

document.getElementById('venueBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('venueBookingMessage');
    try {
        await apiSend('POST', '/api/venues/bookings', {
            venueId: Number(document.getElementById('venueSelect').value),
            customerName: document.getElementById('venueCustomerName').value,
            customerPhone: document.getElementById('venueCustomerPhone').value,
            customerEmail: document.getElementById('venueCustomerEmail').value,
            eventDate: document.getElementById('venueEventDate').value,
            eventType: document.getElementById('venueEventType').value,
            guestCount: Number(document.getElementById('venueGuestCount').value) || 0,
            paymentMethod: document.getElementById('venuePaymentMethod').value,
            transactionId: document.getElementById('venueTransactionId').value,
            securityDeposit: Number(document.getElementById('venueSecurityDeposit').value) || 0,
            discountAmount: Number(document.getElementById('venueDiscount').value) || 0,
            gstPercent: Number(document.getElementById('venueGstPercent').value) || 0,
            lineItems: venueLineItems,
            notes: document.getElementById('venueNotes').value
        });
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Booking saved.';
        document.getElementById('venueBookingForm').reset();
        venueLineItems = [];
        renderVenueLineItemsList();
        document.getElementById('venueBookingForm').style.display = 'none';
        loadVenuesPanel();
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});

document.getElementById('venueFilterStatus').addEventListener('change', loadVenueBookingsTables);
document.getElementById('venueReportFrom').addEventListener('change', loadVenueSummaryCards);
document.getElementById('venueReportTo').addEventListener('change', loadVenueSummaryCards);

document.getElementById('venueExportBtn').addEventListener('click', () => {
    const from = document.getElementById('venueReportFrom').value;
    const to = document.getElementById('venueReportTo').value;
    const token = localStorage.getItem('horizonAdminAuth');
    const qs = from && to ? `?from=${from}&to=${to}` : '';
    fetch(`/api/venues/analytics/export${qs}`, { headers: { Authorization: `Basic ${token}` } })
        .then((res) => res.blob())
        .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'venue-bookings-report.csv';
            a.click();
            URL.revokeObjectURL(url);
        });
});

async function loadVenuesPanel() {
    try {
        if (!allVenues.length) {
            allVenues = await apiGet('/api/venues');
            document.getElementById('venueSelect').innerHTML = '<option value="">Select space&hellip;</option>' +
                allVenues.map((v) => `<option value="${v.id}">${v.name} (${money(v.baseDayRate)}/day)</option>`).join('');
        }
        await Promise.all([loadVenueSummaryCards(), loadVenueBookingsTables()]);
    } catch (err) { /* handled */ }
}

/* ---------------- Investor Leads (from public site "Become a Partner" CTA) ---------------- */
let pendingLeadConversion = null;
const LEAD_STATUS_LABELS = {
    new_lead: 'New Lead', contacted: 'Contacted', meeting_scheduled: 'Meeting Scheduled', closed: 'Closed'
};
const LEAD_STATUS_BADGE_CLASS = {
    new_lead: 'details-toggle', contacted: 'confirm', meeting_scheduled: 'confirm', closed: 'cancel'
};

async function loadLeadsPanel() {
    try {
        const all = await apiGet('/api/investor-leads');
        document.getElementById('leadsSummaryCards').innerHTML = `
            <div class="summary-card"><span>Total Leads</span><strong>${all.length}</strong></div>
            <div class="summary-card"><span>New</span><strong>${all.filter((l) => l.status === 'new_lead').length}</strong></div>
            <div class="summary-card"><span>Meetings Scheduled</span><strong>${all.filter((l) => l.status === 'meeting_scheduled').length}</strong></div>
            <div class="summary-card"><span>Closed</span><strong>${all.filter((l) => l.status === 'closed').length}</strong></div>
        `;

        const statusFilter = document.getElementById('leadsFilterStatus').value;
        const filtered = statusFilter ? all.filter((l) => l.status === statusFilter) : all;
        document.getElementById('leadsBody').innerHTML = filtered.length
            ? filtered.map((l) => `
                <tr>
                    <td>${escapeHtml(l.fullName)}</td>
                    <td>${escapeHtml(l.phone)}${l.email ? `<br><span style="color: var(--text-light); font-size: 0.8rem;">${escapeHtml(l.email)}</span>` : ''}</td>
                    <td>${escapeHtml(l.location)}</td>
                    <td>${escapeHtml(l.investmentTier)}</td>
                    <td>${escapeHtml(l.investmentType)}</td>
                    <td style="max-width: 220px; white-space: normal;">${escapeHtml(l.notes)}</td>
                    <td>
                        <select class="lead-status-select" data-id="${l.id}">
                            ${Object.entries(LEAD_STATUS_LABELS).map(([val, label]) => `<option value="${val}" ${l.status === val ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </td>
                    <td>
                        ${l.convertedInvestorId
                            ? `<span class="action-btn confirm" style="cursor: default;">Investor #${l.convertedInvestorId}</span>`
                            : `<button type="button" class="action-btn confirm lead-convert-btn" data-id="${l.id}" data-name="${escapeHtml(l.fullName)}" data-tier="${escapeHtml(l.investmentTier)}">Convert to Investor</button>`}
                        <button type="button" class="action-btn cancel lead-delete-btn" data-id="${l.id}">Delete</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="8" style="text-align: center; color: var(--text-light);">No investor leads yet.</td></tr>';

        document.querySelectorAll('.lead-status-select').forEach((sel) => {
            sel.addEventListener('change', async () => {
                try {
                    await apiSend('PATCH', `/api/investor-leads/${sel.dataset.id}`, { status: sel.value });
                    loadLeadsPanel();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.lead-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this lead?')) return;
                try {
                    await apiSend('DELETE', `/api/investor-leads/${btn.dataset.id}`, {});
                    loadLeadsPanel();
                } catch (err) { alert(err.message); }
            });
        });

        const LEAD_TIER_TO_CAPITAL = { '1M': 1000000, '5M': 5000000, '10M': 10000000 };
        document.querySelectorAll('.lead-convert-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                pendingLeadConversion = { id: btn.dataset.id };
                const slug = btn.dataset.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                document.getElementById('newInvestorUsername').value = slug;
                document.getElementById('newInvestorCapital').value = LEAD_TIER_TO_CAPITAL[btn.dataset.tier] || '';
                const msg = document.getElementById('investorAccountMessage');
                msg.textContent = `Creating an investor account for lead "${btn.dataset.name}" — fill in the remaining details and submit.`;
                msg.className = 'form-message';
                document.querySelector('.admin-tab[data-tab="investors"]').click();
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('leadsFilterStatus').addEventListener('change', loadLeadsPanel);

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
                <td>
                    ${u.id === currentUser.id ? '' : u.role === 'investor'
                        ? '<span style="color: var(--text-light); font-size: 0.78rem;">Manage in Investor Accounts</span>'
                        : `<button class="action-btn details-toggle staff-reset-btn" data-id="${u.id}" data-username="${escapeHtml(u.username)}">Reset Password</button>
                           <button class="action-btn cancel" data-id="${u.id}">Remove</button>`}
                </td>
            </tr>
        `).join('');

        document.querySelectorAll('#staffBody .action-btn.cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Remove this staff account?')) return;
                try { await apiSend('DELETE', `/api/users/${btn.dataset.id}`, {}); loadStaff(); }
                catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.staff-reset-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Reset the password for "${btn.dataset.username}"? Their current password will stop working immediately.`)) return;
                try {
                    const result = await apiSend('PATCH', `/api/users/${btn.dataset.id}/reset-password`, {});
                    const msg = document.getElementById('staffMessage');
                    msg.textContent = `New password for "${btn.dataset.username}": ${result.newPassword} — copy this now, it will not be shown again.`;
                    msg.className = 'form-message success';
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('staffRole').addEventListener('change', (e) => {
    const isInvestor = e.target.value === 'investor';
    document.getElementById('staffInvestorCapital').style.display = isInvestor ? 'inline-block' : 'none';
    document.getElementById('staffInvestorLockup').style.display = isInvestor ? 'inline-block' : 'none';
    document.getElementById('staffInvestorCapital').required = isInvestor;
});

document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('staffMessage');
    const role = document.getElementById('staffRole').value;
    try {
        if (role === 'investor') {
            const result = await apiSend('POST', '/api/investor-accounts', {
                username: document.getElementById('staffUsername').value,
                password: document.getElementById('staffPassword').value,
                capitalInvested: Number(document.getElementById('staffInvestorCapital').value),
                lockupMonths: Number(document.getElementById('staffInvestorLockup').value) || 6
            });
            msg.textContent = `Created investor ${result.investorCode} — username "${result.username}". Manage capital, compliance, and lockup from the Investor Accounts tab.`;
            msg.className = 'form-message success';
            e.target.reset();
            document.getElementById('staffInvestorCapital').style.display = 'none';
            document.getElementById('staffInvestorLockup').style.display = 'none';
            document.getElementById('staffInvestorLockup').value = 6;
            loadInvestorAccounts();
        } else {
            await apiSend('POST', '/api/users', {
                username: document.getElementById('staffUsername').value,
                password: document.getElementById('staffPassword').value,
                role
            });
            msg.textContent = 'Staff account created.'; msg.className = 'form-message success';
            e.target.reset();
        }
        loadStaff();
    } catch (err) { msg.textContent = err.message; msg.className = 'form-message error'; }
});

/* ---------------- Data & Backups ---------------- */
function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

document.getElementById('downloadBackupBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Preparing backup…';
    try {
        const backup = await apiGet('/api/admin/backup');
        downloadJson(backup, `horizon-inn-backup-${backup.exportedAt.slice(0, 10)}.json`);
    } catch (err) {
        alert(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Download Full Backup Now';
    }
});

const RESET_DATA_PHRASE = 'DELETE CUSTOMER DATA';

document.getElementById('openResetDataModalBtn').addEventListener('click', () => {
    document.getElementById('resetDataForm').reset();
    document.getElementById('resetDataSubmitBtn').disabled = true;
    document.getElementById('resetDataMessage').textContent = '';
    document.getElementById('resetDataModalOverlay').style.display = 'flex';
});
document.getElementById('closeResetDataModalBtn').addEventListener('click', () => {
    document.getElementById('resetDataModalOverlay').style.display = 'none';
});
document.getElementById('resetDataConfirmInput').addEventListener('input', (e) => {
    document.getElementById('resetDataSubmitBtn').disabled = e.target.value !== RESET_DATA_PHRASE;
});

document.getElementById('resetDataForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('resetDataMessage');
    const submitBtn = document.getElementById('resetDataSubmitBtn');
    submitBtn.disabled = true;
    msg.className = 'form-message';
    msg.textContent = 'Backing up, then deleting…';
    try {
        const result = await apiSend('POST', '/api/admin/reset-customer-data', {
            confirm: document.getElementById('resetDataConfirmInput').value
        });
        downloadJson(result.backup, `horizon-inn-backup-before-reset-${result.backup.exportedAt.slice(0, 10)}.json`);
        const counts = Object.entries(result.deleted).map(([table, n]) => `${table}: ${n}`).join(', ');
        msg.className = 'form-message success';
        msg.textContent = `Done. Deleted — ${counts}. A backup was downloaded to your browser${result.backupEmailed ? ' and emailed' : ''}.`;
        setTimeout(() => {
            document.getElementById('resetDataModalOverlay').style.display = 'none';
        }, 4000);
    } catch (err) {
        msg.className = 'form-message error';
        msg.textContent = err.message;
        submitBtn.disabled = document.getElementById('resetDataConfirmInput').value !== RESET_DATA_PHRASE;
    }
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
        // Deliberately not part of the public settings payload above — see
        // routes/settings.js — so it's fetched separately here.
        const { capitalInvested } = await apiGet('/api/investor/capital-invested');
        if (capitalInvested) form['investor_capital_invested'].value = capitalInvested;
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

/* ---------------- Investor Accounts ---------------- */
const COMPLIANCE_OPTIONS = ['pending', 'verified', 'signed', 'rejected'];

async function loadInvestorsPanel() {
    await Promise.all([loadValuationAdmin(), loadInvestorAccounts(), loadWithdrawalRequestsAdmin(), loadProjectsAdmin()]);
}

async function loadValuationAdmin() {
    try {
        const data = await apiGet('/api/investor-accounts/valuation');
        document.getElementById('currentValuationDisplay').textContent = data.current
            ? `${money(data.current.amount)} (set ${data.current.createdAt.slice(0, 10)}${data.current.note ? ' — ' + escapeHtml(data.current.note) : ''})`
            : 'Not set yet';
        document.getElementById('ownerEquityPercent').value = data.ownerEquityPercent || '';
        document.getElementById('currentOwnerEquityDisplay').textContent = data.ownerEquityPercent > 0
            ? `${data.ownerEquityPercent}% fixed — investors split the remaining ${(100 - data.ownerEquityPercent).toFixed(1)}% pool.`
            : 'Not set — investor ownership is calculated directly against valuation.';
        document.getElementById('projectValuationRef').textContent = data.current ? money(data.current.amount) : 'not set yet';
    } catch (err) { /* handled */ }
}

document.getElementById('valuationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('valuationMessage');
    try {
        await apiSend('POST', '/api/investor-accounts/valuation', {
            amount: Number(document.getElementById('valuationAmount').value),
            note: document.getElementById('valuationNote').value
        });
        msg.textContent = 'Valuation recorded.';
        msg.className = 'form-message success';
        e.target.reset();
        loadValuationAdmin();
        loadInvestorAccounts();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

document.getElementById('ownerEquityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ownerEquityMessage');
    try {
        await apiSend('PATCH', '/api/investor-accounts/owner-equity', {
            percent: Number(document.getElementById('ownerEquityPercent').value)
        });
        msg.textContent = 'Owner equity % saved.';
        msg.className = 'form-message success';
        loadValuationAdmin();
        loadInvestorAccounts();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

async function loadInvestorAccounts() {
    try {
        const investors = await apiGet('/api/investor-accounts');
        document.getElementById('investorAccountsBody').innerHTML = investors.map((inv) => `
            <tr data-id="${inv.id}">
                <td>${inv.investorCode}</td>
                <td>${escapeHtml(inv.username)}</td>
                <td><input type="number" class="inv-capital" value="${inv.capitalInvested}" min="0" step="1000" style="width: 110px;"></td>
                <td>${inv.ownershipPercent}%</td>
                <td>
                    <select class="inv-spa">${COMPLIANCE_OPTIONS.map((o) => `<option value="${o}" ${o === inv.spaStatus ? 'selected' : ''}>${o}</option>`).join('')}</select>
                </td>
                <td>
                    <select class="inv-accredited">${COMPLIANCE_OPTIONS.map((o) => `<option value="${o}" ${o === inv.accreditedStatus ? 'selected' : ''}>${o}</option>`).join('')}</select>
                </td>
                <td>
                    <select class="inv-aml">${COMPLIANCE_OPTIONS.map((o) => `<option value="${o}" ${o === inv.amlKycStatus ? 'selected' : ''}>${o}</option>`).join('')}</select>
                </td>
                <td><input type="number" class="inv-lockup" value="${inv.lockupMonths}" min="0" style="width: 70px;"> mo</td>
                <td>
                    <button class="action-btn confirm inv-save-btn">Save</button>
                    <button class="action-btn details-toggle inv-reset-btn" data-username="${escapeHtml(inv.username)}">Reset Password</button>
                    <button class="action-btn cancel inv-delete-btn">Delete</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="9">No investor accounts yet.</td></tr>';

        document.querySelectorAll('.inv-save-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const id = row.dataset.id;
                try {
                    await apiSend('PATCH', `/api/investor-accounts/${id}`, {
                        capitalInvested: Number(row.querySelector('.inv-capital').value),
                        spaStatus: row.querySelector('.inv-spa').value,
                        accreditedStatus: row.querySelector('.inv-accredited').value,
                        amlKycStatus: row.querySelector('.inv-aml').value,
                        lockupMonths: Number(row.querySelector('.inv-lockup').value)
                    });
                    loadInvestorAccounts();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.inv-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this investor account? This also removes their login.')) return;
                const id = btn.closest('tr').dataset.id;
                try {
                    await apiSend('DELETE', `/api/investor-accounts/${id}`, {});
                    loadInvestorAccounts();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.inv-reset-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').dataset.id;
                if (!confirm(`Reset the password for "${btn.dataset.username}"? Their current password will stop working immediately.`)) return;
                try {
                    const result = await apiSend('PATCH', `/api/investor-accounts/${id}/reset-password`, {});
                    const msg = document.getElementById('investorAccountMessage');
                    msg.textContent = `New password for "${btn.dataset.username}": ${result.newPassword} — copy this now, it will not be shown again.`;
                    msg.className = 'form-message success';
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('genInvestorPasswordBtn').addEventListener('click', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pass = '';
    for (let i = 0; i < 12; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    document.getElementById('newInvestorPassword').value = pass;
    document.getElementById('newInvestorPassword').type = 'text';
});

document.getElementById('investorAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('investorAccountMessage');
    try {
        const chosenPassword = document.getElementById('newInvestorPassword').value;
        const result = await apiSend('POST', '/api/investor-accounts', {
            username: document.getElementById('newInvestorUsername').value,
            password: chosenPassword || undefined,
            capitalInvested: Number(document.getElementById('newInvestorCapital').value),
            lockupMonths: Number(document.getElementById('newInvestorLockup').value) || 6
        });
        let extraNote = '';
        if (pendingLeadConversion) {
            try {
                await apiSend('PATCH', `/api/investor-leads/${pendingLeadConversion.id}`, {
                    status: 'closed', convertedInvestorId: result.id
                });
                extraNote = ' Lead marked as closed and linked to this account.';
            } catch (err) { /* account was still created; linking is best-effort */ }
            pendingLeadConversion = null;
        }
        msg.textContent = `Created ${result.investorCode} — username "${result.username}", password "${result.generatedPassword}". Copy this now — it will not be shown again.${extraNote}`;
        msg.className = 'form-message success';
        e.target.reset();
        document.getElementById('newInvestorLockup').value = 6;
        loadInvestorAccounts();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

async function loadWithdrawalRequestsAdmin() {
    try {
        const requests = await apiGet('/api/investor-accounts/withdrawal-requests');
        document.getElementById('withdrawalRequestsBody').innerHTML = requests.map((r) => `
            <tr data-id="${r.id}">
                <td>${r.requestedAt.slice(0, 16)}</td>
                <td>${r.investorCode} (${escapeHtml(r.username)})</td>
                <td>${r.type === 'dividend' ? 'Dividend' : 'Capital'}</td>
                <td>${money(r.amount)}</td>
                <td><span class="status-pill ${r.status === 'completed' ? 'paid' : r.status === 'rejected' ? 'cancelled' : 'pending'}">${r.status}</span></td>
                <td>
                    ${r.status === 'pending' || r.status === 'processing' ? `
                        <button class="action-btn confirm wr-complete-btn">Mark Completed</button>
                        <button class="action-btn cancel wr-reject-btn">Reject</button>
                    ` : ''}
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6">No withdrawal requests yet.</td></tr>';

        document.querySelectorAll('.wr-complete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').dataset.id;
                if (!confirm('Mark this request completed? Only do this after you have actually paid the investor.')) return;
                try {
                    await apiSend('PATCH', `/api/investor-accounts/withdrawal-requests/${id}`, { status: 'completed' });
                    loadWithdrawalRequestsAdmin();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.wr-reject-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').dataset.id;
                try {
                    await apiSend('PATCH', `/api/investor-accounts/withdrawal-requests/${id}`, { status: 'rejected' });
                    loadWithdrawalRequestsAdmin();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

async function loadProjectsAdmin() {
    try {
        const projects = await apiGet('/api/investor-accounts/projects');
        document.getElementById('projectsBody').innerHTML = projects.map((p) => `
            <tr data-id="${p.id}">
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.location)}</td>
                <td>${money(p.targetCapital)}</td>
                <td>${escapeHtml(p.timeline)}</td>
                <td><input type="number" class="proj-valuation" value="${p.valuationAmount || ''}" min="0" step="1000" style="width: 130px;"></td>
                <td><input type="number" class="proj-owner-equity" value="${p.ownerEquityPercent || ''}" min="0" max="100" step="0.1" style="width: 90px;"></td>
                <td><input type="number" class="proj-projected-income" value="${p.projectedMonthlyIncome || ''}" min="0" step="1000" style="width: 130px;"></td>
                <td>
                    <select class="proj-status">
                        <option value="planned" ${p.status === 'planned' ? 'selected' : ''}>Planned</option>
                        <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
                        <option value="funded" ${p.status === 'funded' ? 'selected' : ''}>Funded</option>
                    </select>
                </td>
                <td>
                    <button class="action-btn confirm proj-save-btn">Save</button>
                    <button class="action-btn cancel proj-delete-btn">Delete</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="9">No projects listed yet.</td></tr>';

        document.querySelectorAll('.proj-save-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                try {
                    await apiSend('PATCH', `/api/investor-accounts/projects/${row.dataset.id}`, {
                        status: row.querySelector('.proj-status').value,
                        valuationAmount: Number(row.querySelector('.proj-valuation').value) || 0,
                        ownerEquityPercent: Number(row.querySelector('.proj-owner-equity').value) || 0,
                        projectedMonthlyIncome: Number(row.querySelector('.proj-projected-income').value) || 0
                    });
                    loadProjectsAdmin();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.proj-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this project listing?')) return;
                try {
                    await apiSend('DELETE', `/api/investor-accounts/projects/${btn.closest('tr').dataset.id}`, {});
                    loadProjectsAdmin();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('addProjectBtn').addEventListener('click', async () => {
    const msg = document.getElementById('projectMessage');
    try {
        await apiSend('POST', '/api/investor-accounts/projects', {
            name: document.getElementById('projectName').value,
            location: document.getElementById('projectLocation').value,
            targetCapital: Number(document.getElementById('projectCapital').value) || 0,
            timeline: document.getElementById('projectTimeline').value,
            description: document.getElementById('projectDescription').value,
            growthPotential: document.getElementById('projectGrowth').value,
            valuationAmount: Number(document.getElementById('projectValuation').value) || 0,
            ownerEquityPercent: Number(document.getElementById('projectOwnerEquity').value) || 0,
            projectedMonthlyIncome: Number(document.getElementById('projectProjectedIncome').value) || 0
        });
        msg.textContent = 'Project added.';
        msg.className = 'form-message success';
        document.getElementById('projectForm').reset();
        document.getElementById('projectForm2').reset();
        document.getElementById('projectForm3').reset();
        loadProjectsAdmin();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    }
});

/* ---------------- Login ---------------- */
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('adminUser').value;
    const pass = document.getElementById('adminPass').value;
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

/* ---------------- Reviews moderation ---------------- */
const REVIEW_SOURCE_LABELS_ADMIN = { site: 'Site', google: 'Google', tripadvisor: 'TripAdvisor' };

async function loadReviewsPanel() {
    try {
        const all = await apiGet('/api/reviews');
        document.getElementById('reviewsSummaryCards').innerHTML = `
            <div class="summary-card"><span>Total Reviews</span><strong>${all.length}</strong></div>
            <div class="summary-card"><span>Pending</span><strong>${all.filter((r) => r.status === 'pending').length}</strong></div>
            <div class="summary-card"><span>Approved</span><strong>${all.filter((r) => r.status === 'approved').length}</strong></div>
            <div class="summary-card"><span>Average Rating</span><strong>${all.length ? (all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(1) : '—'}</strong></div>
        `;

        const statusFilter = document.getElementById('reviewsFilterStatus').value;
        const filtered = statusFilter ? all.filter((r) => r.status === statusFilter) : all;
        document.getElementById('reviewsBody').innerHTML = filtered.length
            ? filtered.map((r) => `
                <tr>
                    <td>${escapeHtml(r.guestName)}</td>
                    <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
                    <td style="max-width: 260px; white-space: normal;">${escapeHtml(r.comment)}</td>
                    <td>${REVIEW_SOURCE_LABELS_ADMIN[r.source] || r.source}</td>
                    <td>
                        <select class="review-status-select" data-id="${r.id}">
                            <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>Approved</option>
                            <option value="rejected" ${r.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                        </select>
                    </td>
                    <td><button type="button" class="action-btn cancel review-delete-btn" data-id="${r.id}">Delete</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align: center; color: var(--text-light);">No reviews yet.</td></tr>';

        document.querySelectorAll('.review-status-select').forEach((sel) => {
            sel.addEventListener('change', async () => {
                try {
                    await apiSend('PATCH', `/api/reviews/${sel.dataset.id}`, { status: sel.value });
                    loadReviewsPanel();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.review-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this review?')) return;
                try {
                    await apiSend('DELETE', `/api/reviews/${btn.dataset.id}`, {});
                    loadReviewsPanel();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('reviewsFilterStatus').addEventListener('change', loadReviewsPanel);

document.getElementById('externalReviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('externalReviewMessage');
    try {
        await apiSend('POST', '/api/reviews/admin', {
            guestName: document.getElementById('extReviewName').value,
            rating: Number(document.getElementById('extReviewRating').value),
            source: document.getElementById('extReviewSource').value,
            comment: document.getElementById('extReviewComment').value
        });
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Review added.';
        document.getElementById('externalReviewForm').reset();
        loadReviewsPanel();
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});

/* ---------------- Promotions: Promo Codes + Gift Vouchers ---------------- */
async function loadPromotionsPanel() {
    try {
        const [codes, vouchers] = await Promise.all([
            apiGet('/api/promo-codes'),
            apiGet('/api/gift-vouchers')
        ]);

        document.getElementById('promoCodesBody').innerHTML = codes.length
            ? codes.map((c) => `
                <tr>
                    <td>${escapeHtml(c.code)}</td>
                    <td>${c.discountPercent}%</td>
                    <td>${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ''}</td>
                    <td>${c.expiresAt || '—'}</td>
                    <td>${c.active ? '<span class="action-btn confirm" style="cursor:default;">Active</span>' : '<span class="action-btn cancel" style="cursor:default;">Inactive</span>'}</td>
                    <td>
                        <button type="button" class="action-btn details-toggle promo-toggle-btn" data-id="${c.id}" data-active="${c.active ? 0 : 1}">${c.active ? 'Deactivate' : 'Activate'}</button>
                        <button type="button" class="action-btn cancel promo-delete-btn" data-id="${c.id}">Delete</button>
                    </td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align: center; color: var(--text-light);">No promo codes yet.</td></tr>';

        document.querySelectorAll('.promo-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await apiSend('PATCH', `/api/promo-codes/${btn.dataset.id}`, { active: btn.dataset.active === '1' });
                    loadPromotionsPanel();
                } catch (err) { alert(err.message); }
            });
        });
        document.querySelectorAll('.promo-delete-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this promo code?')) return;
                try {
                    await apiSend('DELETE', `/api/promo-codes/${btn.dataset.id}`, {});
                    loadPromotionsPanel();
                } catch (err) { alert(err.message); }
            });
        });

        const voucherStatusFilter = document.getElementById('vouchersFilterStatus').value;
        const filteredVouchers = voucherStatusFilter ? vouchers.filter((v) => v.status === voucherStatusFilter) : vouchers;
        document.getElementById('vouchersBody').innerHTML = filteredVouchers.length
            ? filteredVouchers.map((v) => `
                <tr>
                    <td>${escapeHtml(v.code)}</td>
                    <td>${money(v.amount)}</td>
                    <td>${escapeHtml(v.purchaserName)}<br><small>${escapeHtml(v.purchaserPhone)}</small></td>
                    <td>${escapeHtml(v.recipientName) || '—'}</td>
                    <td>${escapeHtml(v.paymentMethod)}</td>
                    <td>${v.status}</td>
                    <td>${v.status === 'pending_payment' ? `<button type="button" class="action-btn confirm voucher-activate-btn" data-id="${v.id}">Verify &amp; Activate</button>` : ''}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="7" style="text-align: center; color: var(--text-light);">No gift vouchers yet.</td></tr>';

        document.querySelectorAll('.voucher-activate-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    const result = await apiSend('PATCH', `/api/gift-vouchers/${btn.dataset.id}/activate`, {});
                    alert(`Voucher activated: ${result.code} — Rs. ${result.amount}. Send this code to the purchaser.`);
                    loadPromotionsPanel();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('vouchersFilterStatus').addEventListener('change', loadPromotionsPanel);

document.getElementById('promoCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('promoCodeMessage');
    try {
        await apiSend('POST', '/api/promo-codes', {
            code: document.getElementById('promoCode').value,
            discountPercent: Number(document.getElementById('promoDiscount').value),
            maxUses: document.getElementById('promoMaxUses').value ? Number(document.getElementById('promoMaxUses').value) : null,
            expiresAt: document.getElementById('promoExpires').value || null
        });
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Promo code created.';
        document.getElementById('promoCodeForm').reset();
        loadPromotionsPanel();
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});

/* ---------------- Corporate Accounts ---------------- */
const BILLING_TERMS_LABELS = { due_on_receipt: 'Due on Receipt', net_15: 'Net 15', net_30: 'Net 30' };

async function loadCorporatePanel() {
    try {
        const accounts = await apiGet('/api/corporate-accounts');
        document.getElementById('corporateAccountsBody').innerHTML = accounts.length
            ? accounts.map((a) => `
                <tr>
                    <td>${escapeHtml(a.companyName)}</td>
                    <td>${escapeHtml(a.contactPerson)}<br><small>${escapeHtml(a.contactEmail)} &middot; ${escapeHtml(a.contactPhone)}</small></td>
                    <td>${BILLING_TERMS_LABELS[a.billingTerms] || a.billingTerms}</td>
                    <td>${a.agreedDiscountPercent}%</td>
                    <td><button type="button" class="action-btn cancel corp-deactivate-btn" data-id="${a.id}">Deactivate</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" style="text-align: center; color: var(--text-light);">No corporate accounts yet.</td></tr>';

        document.querySelectorAll('.corp-deactivate-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                if (!confirm('Deactivate this corporate account?')) return;
                try {
                    await apiSend('PATCH', `/api/corporate-accounts/${btn.dataset.id}`, { active: false });
                    loadCorporatePanel();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('corporateAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('corporateAccountMessage');
    try {
        await apiSend('POST', '/api/corporate-accounts', {
            companyName: document.getElementById('corpCompanyName').value,
            contactPerson: document.getElementById('corpContactPerson').value,
            contactEmail: document.getElementById('corpContactEmail').value,
            contactPhone: document.getElementById('corpContactPhone').value,
            billingTerms: document.getElementById('corpBillingTerms').value,
            agreedDiscountPercent: Number(document.getElementById('corpDiscount').value) || 0
        });
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Corporate account added.';
        document.getElementById('corporateAccountForm').reset();
        loadCorporatePanel();
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});

/* ---------------- Recovery: abandoned booking interest ---------------- */
async function loadRecoveryPanel() {
    try {
        const statusFilter = document.getElementById('recoveryFilterStatus').value;
        const all = await apiGet(`/api/abandoned-bookings${statusFilter ? `?status=${statusFilter}` : ''}`);

        const allForSummary = statusFilter ? await apiGet('/api/abandoned-bookings') : all;
        document.getElementById('recoverySummaryCards').innerHTML = `
            <div class="summary-card"><span>Open</span><strong>${allForSummary.filter((r) => r.status === 'open').length}</strong></div>
            <div class="summary-card"><span>Contacted</span><strong>${allForSummary.filter((r) => r.status === 'contacted').length}</strong></div>
            <div class="summary-card"><span>Converted</span><strong>${allForSummary.filter((r) => r.status === 'converted').length}</strong></div>
            <div class="summary-card"><span>Total Captured</span><strong>${allForSummary.length}</strong></div>
        `;

        document.getElementById('recoveryBody').innerHTML = all.length
            ? all.map((r) => `
                <tr>
                    <td>${escapeHtml(r.name)}</td>
                    <td>${escapeHtml(r.phone)}${r.email ? `<br><small>${escapeHtml(r.email)}</small>` : ''}</td>
                    <td>${r.checkin || '—'} &rarr; ${r.checkout || '—'}</td>
                    <td>${formatPKT(r.createdAt)}</td>
                    <td>
                        <select class="recovery-status-select" data-id="${r.id}">
                            <option value="open" ${r.status === 'open' ? 'selected' : ''}>Open</option>
                            <option value="contacted" ${r.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                            <option value="converted" ${r.status === 'converted' ? 'selected' : ''}>Converted</option>
                            <option value="dismissed" ${r.status === 'dismissed' ? 'selected' : ''}>Dismissed</option>
                        </select>
                    </td>
                    <td>${r.phone ? `<a class="action-btn confirm" href="https://wa.me/${r.phone.replace(/\D/g, '').replace(/^0/, '92')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align: center; color: var(--text-light);">No interest captured yet.</td></tr>';

        document.querySelectorAll('.recovery-status-select').forEach((sel) => {
            sel.addEventListener('change', async () => {
                try {
                    await apiSend('PATCH', `/api/abandoned-bookings/${sel.dataset.id}`, { status: sel.value });
                    loadRecoveryPanel();
                } catch (err) { alert(err.message); }
            });
        });
    } catch (err) { /* handled */ }
}

document.getElementById('recoveryFilterStatus').addEventListener('change', loadRecoveryPanel);
