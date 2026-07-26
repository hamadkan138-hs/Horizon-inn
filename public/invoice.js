function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
}

function nights(checkin, checkout) {
    return Math.max(1, Math.round((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24)));
}

async function loadInvoice() {
    const status = document.getElementById('status');
    const id = new URLSearchParams(window.location.search).get('id');
    const token = sessionStorage.getItem('horizonAdminAuth');

    if (!id) { status.textContent = 'No booking specified.'; return; }
    if (!token) { status.textContent = 'Please log in to the admin dashboard first, then open this invoice link again.'; return; }

    try {
        const res = await fetch(`/api/bookings/${id}`, { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) throw new Error('Could not load booking');
        const b = await res.json();

        document.getElementById('invId').textContent = b.id;
        document.getElementById('invDate').textContent = `Issued ${new Date().toLocaleDateString()}`;
        document.getElementById('invStatus').textContent = b.status.replace('_', ' ');

        document.getElementById('guestName').textContent = b.name;
        document.getElementById('guestContact').textContent = `${b.email} · ${b.phone}`;
        document.getElementById('guestCnic').textContent = `CNIC/Passport: ${b.cnic || '—'}`;

        document.getElementById('stayRoom').textContent = b.room_name;
        document.getElementById('stayDates').textContent = `${b.checkin} to ${b.checkout}`;
        document.getElementById('stayGuests').textContent = `${b.guests} guest(s)`;

        const n = nights(b.checkin, b.checkout);
        const rate = b.room_amount / n;
        const chargesTotal = b.charges.reduce((sum, c) => sum + Number(c.amount), 0);
        const subtotal = Number(b.room_amount) + chargesTotal;
        const taxAmount = subtotal * (Number(b.tax_percent) / 100);

        let rows = `<tr><td>${b.room_name}</td><td>${n}</td><td>${money(rate)}</td><td>${money(b.room_amount)}</td></tr>`;
        rows += b.charges.map((c) => `<tr><td>${c.description}</td><td>&mdash;</td><td>&mdash;</td><td>${money(c.amount)}</td></tr>`).join('');
        if (b.tax_percent > 0) {
            rows += `<tr><td>Tax (${b.tax_percent}%)</td><td>&mdash;</td><td>&mdash;</td><td>${money(taxAmount)}</td></tr>`;
        }
        document.getElementById('chargeRow').innerHTML = rows;

        const paidTotal = b.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        document.getElementById('paymentsBody').innerHTML = b.payments.map((p) => `
            <tr><td>${p.recorded_at}</td><td>${p.method}</td><td>${p.transaction_id || '—'}</td><td>${money(p.amount)}</td></tr>
        `).join('') || '<tr><td colspan="4">No payments recorded yet.</td></tr>';

        document.getElementById('totalDue').textContent = money(b.total_amount);
        document.getElementById('totalPaid').textContent = money(paidTotal);
        document.getElementById('totalBalance').textContent = money(Math.max(0, b.total_amount - paidTotal));

        status.style.display = 'none';
        document.getElementById('invoiceContent').style.display = 'block';
    } catch (err) {
        status.textContent = 'Failed to load invoice. Make sure you are logged in as admin.';
    }
}

loadInvoice();
