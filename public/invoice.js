function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function nights(checkin, checkout) {
    return Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24)));
}

// Every timestamp from the API is stored in UTC (SQLite's datetime('now')).
// Horizon Inn operates on Pakistan Standard Time, so always display in that
// zone explicitly rather than whatever timezone the visitor's browser is in.
function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }) + ' PKT';
}

const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    checked_out: 'Checked Out', cancelled: 'Cancelled'
};

async function loadHotelContact() {
    try {
        const settings = await fetch('/api/settings').then((r) => r.json());
        if (settings.contact_address || settings.contact_phone || settings.contact_email) {
            const parts = [settings.contact_phone, settings.contact_email].filter(Boolean).join(' &middot; ');
            document.getElementById('hotelContact').innerHTML = `${(settings.contact_address || '').replace(/\n/g, '<br>')}<br>${parts}`;
        }
    } catch (err) { /* fall back to the static markup already in the page */ }
}
loadHotelContact();

async function loadInvoice() {
    const status = document.getElementById('status');
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const publicToken = params.get('token');

    if (!id) { status.textContent = 'No booking specified.'; return; }

    let b;
    try {
        if (publicToken) {
            const res = await fetch(`/api/public-invoice/${id}?token=${encodeURIComponent(publicToken)}`);
            if (!res.ok) throw new Error('not-found');
            b = await res.json();
        } else {
            const token = localStorage.getItem('horizonAdminAuth');
            if (!token) { status.textContent = 'Please log in to the admin dashboard first, then open this invoice link again.'; return; }
            const res = await fetch(`/api/bookings/${id}`, { headers: { Authorization: `Basic ${token}` } });
            if (!res.ok) throw new Error('not-found');
            b = await res.json();
        }
    } catch (err) {
        status.textContent = 'Failed to load invoice. The link may be invalid or expired.';
        return;
    }

    try {
        document.getElementById('invNumber').textContent = b.invoice_number;
        document.getElementById('invBookingId').textContent = b.id;
        document.getElementById('invDate').textContent = `Issued ${formatPKT(b.created_at)}`;

        const paidTotal = b.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const balance = Math.max(0, Number(b.total_amount) - paidTotal);
        const badge = document.getElementById('invStatusBadge');
        badge.textContent = b.payment_status;
        badge.classList.add(b.payment_status);

        document.getElementById('guestName').textContent = b.name;
        document.getElementById('guestContact').textContent = `${b.email} · ${b.phone}`;
        document.getElementById('guestCnic').textContent = `CNIC/Passport: ${b.cnic || '—'}`;
        document.getElementById('guestAddress').textContent = `Address: ${b.address || '—'}`;

        document.getElementById('stayRoom').textContent = `${b.room_name}`;
        document.getElementById('stayRoomNumber').textContent = b.room_number ? `Room Number: ${b.room_number}` : '';
        document.getElementById('stayDates').textContent = `${b.checkin} to ${b.checkout} (${nights(b.checkin, b.checkout)} night${nights(b.checkin, b.checkout) > 1 ? 's' : ''})`;
        document.getElementById('stayOccupancy').textContent = `${b.guests} guest(s) · Status: ${STATUS_LABELS[b.status] || b.status}`;

        const n = nights(b.checkin, b.checkout);
        const rate = b.room_amount / n;
        const positiveCharges = b.charges.filter((c) => c.amount > 0);
        const discountCharges = b.charges.filter((c) => c.amount < 0);
        const discountTotal = discountCharges.reduce((sum, c) => sum + Number(c.amount), 0);
        const chargesTotal = b.charges.reduce((sum, c) => sum + Number(c.amount), 0);
        const subtotal = Number(b.room_amount) + chargesTotal;
        const taxAmount = subtotal * (Number(b.tax_percent) / 100);

        let rows = `<tr><td>${b.room_name} (room charge)</td><td class="num">${n}</td><td class="num">${money(rate)}</td><td class="num">${money(b.room_amount)}</td></tr>`;
        rows += positiveCharges.map((c) => `<tr><td>${c.description}</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${money(c.amount)}</td></tr>`).join('');
        rows += discountCharges.map((c) => `<tr class="discount-row"><td>${c.description}</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">${money(c.amount)}</td></tr>`).join('');
        document.getElementById('chargeRows').innerHTML = rows;

        document.getElementById('paymentsBody').innerHTML = b.payments.map((p) => `
            <tr><td>${formatPKT(p.recorded_at)}</td><td>${p.method}</td><td>${p.transaction_id || '—'}</td><td class="num">${money(p.amount)}</td></tr>
        `).join('') || '<tr><td colspan="4">No payments recorded yet.</td></tr>';

        const roomPlusExtras = Number(b.room_amount) + positiveCharges.reduce((s, c) => s + Number(c.amount), 0);
        document.getElementById('subtotal').textContent = money(roomPlusExtras);
        if (discountTotal < 0) {
            document.getElementById('discountLine').style.display = 'flex';
            document.getElementById('discountAmount').textContent = money(discountTotal);
        }
        if (b.tax_percent > 0) {
            document.getElementById('taxLine').style.display = 'flex';
            document.getElementById('taxAmount').textContent = `${money(taxAmount)} (${b.tax_percent}%)`;
        }
        document.getElementById('totalDue').textContent = money(b.total_amount);
        document.getElementById('totalPaid').textContent = money(paidTotal);

        const balanceEl = document.getElementById('totalBalance');
        balanceEl.textContent = money(balance);
        balanceEl.className = balance > 0.01 ? 'balance-due' : 'balance-clear';

        document.getElementById('paymentStatusText').textContent = b.payment_status.toUpperCase();

        // The exact moment payment was completed — the latest payment on
        // record, falling back to the checkout timestamp if the booking was
        // checked out without a new payment being taken at that moment.
        const lastPayment = b.payments.length ? b.payments[b.payments.length - 1] : null;
        const paymentMoment = lastPayment ? lastPayment.recorded_at : (b.status === 'checked_out' ? b.checked_out_at : null);
        if (paymentMoment) {
            document.getElementById('paymentTimeLine').style.display = 'flex';
            document.getElementById('paymentTimeText').textContent = formatPKT(paymentMoment);
        }

        if (b.invoice_notes) {
            document.getElementById('notesWrapper').style.display = 'block';
            document.getElementById('notesText').textContent = b.invoice_notes;
        }
        if (b.special_requests) {
            const existing = document.getElementById('notesText');
            document.getElementById('notesWrapper').style.display = 'block';
            existing.textContent = (existing.textContent ? existing.textContent + '\n\n' : '') + `Special requests: ${b.special_requests}`;
        }

        status.style.display = 'none';
        document.getElementById('invoiceContent').style.display = 'block';
    } catch (err) {
        status.textContent = 'Failed to render invoice.';
    }
}

loadInvoice();
