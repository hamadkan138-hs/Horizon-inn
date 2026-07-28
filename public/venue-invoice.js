const PAYMENT_METHOD_TEXT = { cash: 'Cash on-site', bank_transfer: 'Bank Transfer', card: 'Card' };
const STATUS_TEXT = { pending_cash: 'Pending Cash', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };

function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }) + ' PKT';
}

(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const status = document.getElementById('status');
    const token = localStorage.getItem('horizonAdminAuth');

    if (!id || !token) {
        status.textContent = 'Missing booking ID or admin session. Open this invoice from the Cash & Financial Controls tab.';
        return;
    }

    try {
        const res = await fetch(`/api/venues/bookings/${id}`, { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) throw new Error('Invoice not found');
        const b = await res.json();

        document.getElementById('invBookingCode').textContent = b.bookingCode;
        document.getElementById('invDate').textContent = `Issued ${formatPKT(b.createdAt)}`;
        const badge = document.getElementById('invStatusBadge');
        badge.textContent = STATUS_TEXT[b.status] || b.status;
        badge.className = `status-badge ${b.status}`;

        document.getElementById('customerName').textContent = b.customerName;
        document.getElementById('customerContact').textContent = [b.customerPhone, b.customerEmail].filter(Boolean).join(' · ');

        document.getElementById('venueName').textContent = b.venueName;
        document.getElementById('eventDate').textContent = `Event date: ${b.eventDate}`;
        document.getElementById('eventMeta').textContent = [
            b.eventType ? `Type: ${b.eventType}` : '',
            b.guestCount ? `${b.guestCount} guest(s)` : ''
        ].filter(Boolean).join(' · ');

        const rows = [`<tr><td>Venue rental (${b.venueName})</td><td class="num">${money(b.baseRate)}</td></tr>`];
        b.lineItems.forEach((li) => rows.push(`<tr><td>${li.description}</td><td class="num">${money(li.amount)}</td></tr>`));
        document.getElementById('chargeRows').innerHTML = rows.join('');

        const subtotal = b.baseRate + b.lineItems.reduce((s, li) => s + li.amount, 0) - b.discountAmount;
        document.getElementById('subtotal').textContent = money(subtotal);

        if (b.discountAmount > 0) {
            document.getElementById('discountLine').style.display = 'flex';
            document.getElementById('discountAmount').textContent = `-${money(b.discountAmount)}`;
        }
        if (b.gstAmount > 0) {
            document.getElementById('gstLine').style.display = 'flex';
            document.getElementById('gstAmount').textContent = `${money(b.gstAmount)} (${b.gstPercent}%)`;
        }
        if (b.securityDeposit > 0) {
            document.getElementById('depositLine').style.display = 'flex';
            document.getElementById('depositAmount').textContent = money(b.securityDeposit);
        }
        document.getElementById('totalDue').textContent = money(b.totalAmount);
        document.getElementById('paymentMethodText').textContent = PAYMENT_METHOD_TEXT[b.paymentMethod] || b.paymentMethod;

        if (b.notes) {
            document.getElementById('notesWrapper').style.display = 'block';
            document.getElementById('notesText').textContent = b.notes;
        }

        status.style.display = 'none';
        document.getElementById('invoiceContent').style.display = 'block';
    } catch (err) {
        status.textContent = 'Could not load this invoice.';
    }
})();
