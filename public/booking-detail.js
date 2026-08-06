// Standalone booking detail/edit page — opened in a new tab from the
// bookings table's "View" button so staff get a full page to work in
// instead of a cramped in-table row that forced both vertical and
// horizontal scrolling. Shares the admin dashboard's auth (Basic Auth
// token in localStorage, same origin) so no separate login is needed —
// if the token isn't there, this page just points back to admin.html.

const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    checked_out: 'Checked Out', cancelled: 'Cancelled'
};
// Mirrors admin.js: forward-only, matches routes/bookings.js server-side
// enforcement. checked_in only ever moves to checked_out, via the
// dedicated checkout form below, not this dropdown.
const STATUS_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['checked_in', 'cancelled']
};
const PAYMENT_METHOD_LABELS = {
    pay_at_property: 'Pay at Property', bank_transfer: 'Bank Transfer',
    easypaisa: 'EasyPaisa', jazzcash: 'JazzCash', cash: 'Cash'
};
const CHARGE_CATEGORY_LABELS = { amenity: 'Amenity', event_rental: 'Event Rental', other: 'Other' };

let currentUser = null;

function assignedRoomNumber(b) {
    return b.room_number || b.physical_room_number || '';
}

function getAuthHeader() {
    const token = localStorage.getItem('horizonAdminAuth');
    return token ? { Authorization: `Basic ${token}` } : {};
}

async function apiGet(path) {
    const res = await fetch(path, { headers: getAuthHeader() });
    if (res.status === 401) { localStorage.removeItem('horizonAdminAuth'); throw new Error('Unauthorized'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
}

async function apiSend(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
    });
    if (res.status === 401) { localStorage.removeItem('horizonAdminAuth'); throw new Error('Unauthorized'); }
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

function formatPKT(sqlTimestamp) {
    if (!sqlTimestamp) return '';
    const d = new Date(sqlTimestamp.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }) + ' PKT';
}

function detailField(label, value) {
    return `<div class="detail-field"><strong>${label}:</strong> ${escapeHtml(value) || '&mdash;'}</div>`;
}

function showError(message) {
    document.getElementById('bdLoading').style.display = 'none';
    document.getElementById('bdRoot').style.display = 'none';
    const err = document.getElementById('bdError');
    err.style.display = 'block';
    err.innerHTML = message;
}

function getBookingId() {
    return new URLSearchParams(window.location.search).get('id');
}

async function render() {
    const id = getBookingId();
    if (!id) { showError('No booking specified.'); return; }
    if (!localStorage.getItem('horizonAdminAuth')) {
        showError('You need to be signed in. <a href="admin.html">Go to the Admin Dashboard</a> and log in, then reopen this link.');
        return;
    }

    try {
        if (!currentUser) currentUser = await apiGet('/api/auth/me');
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
                <button type="button" class="action-btn confirm verify-btn"
                    data-amount="${b.total_amount}" data-method="${b.payment_method}" data-txn="${escapeHtml(b.transaction_id)}">
                    Verify &amp; Record Payment
                </button>
            </div>
        ` : '';

        const statusControl = STATUS_TRANSITIONS[b.status] ? `
            <div class="detail-subsection">
                <h4>Change Status</h4>
                <form class="inline-form" id="statusForm">
                    <select name="status">
                        <option value="${b.status}">${STATUS_LABELS[b.status]} (current)</option>
                        ${STATUS_TRANSITIONS[b.status].map((s) => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join('')}
                    </select>
                    <button type="submit" class="action-btn confirm">Update Status</button>
                </form>
            </div>
        ` : '';

        const checkoutControl = b.status === 'checked_in' ? `
            <div class="detail-subsection">
                <h4>Check Out Guest</h4>
                <form class="inline-form" id="checkoutForm">
                    <input type="number" name="amount" placeholder="Amount to collect now (Rs.)" min="0" step="0.01" value="${balance > 0 ? balance.toFixed(2) : ''}">
                    <select name="method">
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="easypaisa">EasyPaisa</option>
                        <option value="jazzcash">JazzCash</option>
                    </select>
                    <input type="text" name="transactionId" placeholder="Transaction ID (optional)">
                    <button type="submit" class="action-btn confirm">Complete Checkout</button>
                </form>
                <p class="form-message" id="checkoutMessage"></p>
            </div>
        ` : '';

        document.getElementById('bdRoot').innerHTML = `
            <div class="bd-header">
                <div>
                    <h1>${escapeHtml(b.name)}</h1>
                    <div class="bd-meta">
                        ${escapeHtml(b.room_name)}${assignedRoomNumber(b) ? ` &mdash; Room ${escapeHtml(assignedRoomNumber(b))}` : ''}<br>
                        ${b.checkin} &rarr; ${b.checkout} &middot; ${b.guests} guest${b.guests > 1 ? 's' : ''}<br>
                        Invoice ${escapeHtml(b.invoice_number)} &middot; ${escapeHtml(b.email)} &middot; ${escapeHtml(b.phone)}
                    </div>
                </div>
                <span class="status-pill ${b.status}" style="font-size: 0.85rem;">${STATUS_LABELS[b.status]}</span>
            </div>

            <div class="bd-panel">
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

                ${statusControl}
                ${checkoutControl}

                <div class="detail-subsection">
                    <h4>Invoice &mdash; ${escapeHtml(b.invoice_number)}</h4>
                    <form class="inline-form" id="invoiceFieldsForm">
                        <input type="text" name="roomNumber" value="${escapeHtml(assignedRoomNumber(b))}" placeholder="Room number (e.g. 12)">
                        <input type="text" name="invoiceNotes" value="${escapeHtml(b.invoice_notes)}" placeholder="Notes to print on invoice">
                        <button type="submit" class="action-btn confirm">Save</button>
                        <a class="action-btn details-toggle" href="invoice.html?id=${id}" target="_blank" rel="opener">Open Invoice</a>
                        <button type="button" class="action-btn details-toggle" id="copyLinkBtn" data-token="${b.invoice_token}">Copy Guest Link</button>
                    </form>
                    <p class="form-message" id="invoiceFieldsMessage"></p>
                </div>

                <div class="detail-subsection">
                    <h4>Charges &mdash; Room ${money(b.room_amount)}, Extras ${money(chargesTotal)}, Tax ${b.tax_percent}%</h4>
                    <div class="table-scroll">
                    <table class="admin-table mini-table">
                        <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th></th></tr></thead>
                        <tbody>
                            <tr><td>${escapeHtml(b.room_name)} (room charge)</td><td>Room Booking</td><td>${money(b.room_amount)}</td><td></td></tr>
                            ${b.charges.map((c) => `<tr ${c.amount < 0 ? 'class="discount-row"' : ''}><td>${escapeHtml(c.description)}</td><td>${CHARGE_CATEGORY_LABELS[c.category] || 'Other'}</td><td>${money(c.amount)}</td><td><button class="action-btn cancel remove-charge-btn" data-charge="${c.id}">Remove</button></td></tr>`).join('')}
                        </tbody>
                    </table>
                    </div>
                    <form class="inline-form" id="chargeForm">
                        <input type="text" name="description" placeholder="Extra service or discount (e.g. Barbecue, Bonfire)" required>
                        <select name="category">
                            <option value="amenity">Amenity</option>
                            <option value="event_rental">Event Rental</option>
                            <option value="other" selected>Other</option>
                        </select>
                        <input type="number" name="amount" placeholder="Amount (negative = discount)" step="0.01" required>
                        <button type="submit" class="action-btn confirm">Add Charge</button>
                    </form>
                    <form class="inline-form" id="taxForm">
                        <label style="font-size: 0.85rem; color: var(--text-light);">Tax rate:</label>
                        <input type="number" name="taxPercent" value="${b.tax_percent}" min="0" max="100" step="0.1" style="max-width: 100px;">
                        <button type="submit" class="action-btn confirm">Update Tax %</button>
                    </form>
                </div>

                <div class="detail-subsection">
                    <h4>Mini Bar</h4>
                    <form class="inline-form" id="minibarChargeForm">
                        <select name="itemId" required>
                            <option value="">Select an item&hellip;</option>
                            ${minibarItems.filter((i) => i.active).map((i) => `<option value="${i.id}" ${i.stockQuantity <= 0 ? 'disabled' : ''}>${escapeHtml(i.name)} &mdash; ${money(i.price)} (${i.stockQuantity} left)</option>`).join('')}
                        </select>
                        <input type="number" name="quantity" value="1" min="1" step="1" style="max-width: 90px;">
                        <button type="submit" class="action-btn confirm">Charge Guest</button>
                    </form>
                    <p class="form-message" id="minibarChargeMessage"></p>
                </div>

                <div class="detail-subsection">
                    <h4>Payments &mdash; Total ${money(b.total_amount)}, Paid ${money(paidTotal)}, Balance ${money(balance)}</h4>
                    <div class="table-scroll">
                    <table class="admin-table mini-table">
                        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Txn ID</th><th>Note</th><th>By</th>${currentUser.role === 'admin' ? '<th></th>' : ''}</tr></thead>
                        <tbody>
                            ${b.payments.map((p) => `<tr><td>${formatPKT(p.recorded_at)}</td><td>${money(p.amount)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.transaction_id)}</td><td>${escapeHtml(p.note)}</td><td>${escapeHtml(p.recorded_by)}</td>${currentUser.role === 'admin' ? `<td><button class="action-btn cancel remove-payment-btn" data-payment="${p.id}">Remove</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${currentUser.role === 'admin' ? 7 : 6}">No payments recorded yet.</td></tr>`}
                        </tbody>
                    </table>
                    </div>
                    <form class="inline-form" id="paymentForm">
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
                    <form class="inline-form" id="editBookingForm">
                        <input type="text" name="name" value="${escapeHtml(b.name)}" placeholder="Name">
                        <input type="email" name="email" value="${escapeHtml(b.email)}" placeholder="Email">
                        <input type="tel" name="phone" value="${escapeHtml(b.phone)}" placeholder="Phone">
                        <input type="number" name="guests" value="${b.guests}" min="1" max="10" placeholder="Guests">
                        <input type="date" name="checkin" value="${b.checkin}">
                        <input type="date" name="checkout" value="${b.checkout}">
                        <input type="text" name="specialRequests" value="${escapeHtml(b.special_requests)}" placeholder="Special requests">
                        <button type="submit" class="action-btn confirm">Save Changes</button>
                    </form>
                    <p class="form-message" id="editMessage"></p>
                </div>

                ${b.statusHistory.length ? `
                <div class="detail-subsection">
                    <h4>Status History</h4>
                    <div class="table-scroll">
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
                </div>
                ` : ''}

                ${currentUser.role === 'admin' ? `
                <div class="detail-subsection danger-zone">
                    <h4>Danger Zone</h4>
                    <p style="font-size: 0.82rem; color: var(--text-light); margin-bottom: 10px;">Permanently deletes this booking and its payment history. Use only to correct a booking created by mistake &mdash; this cannot be undone.</p>
                    <button type="button" class="action-btn cancel" id="deleteBookingBtn">Delete This Booking</button>
                </div>
                ` : ''}
            </div>
        `;

        document.getElementById('bdLoading').style.display = 'none';
        document.getElementById('bdError').style.display = 'none';
        document.getElementById('bdRoot').style.display = 'block';
        wireEvents(id);
    } catch (err) {
        showError(err.message === 'Unauthorized'
            ? 'Your session expired. <a href="admin.html">Log in again</a>, then reopen this link.'
            : escapeHtml(err.message || 'Failed to load this booking.'));
    }
}

function wireEvents(id) {
    const root = document.getElementById('bdRoot');

    const paymentForm = root.querySelector('#paymentForm');
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
            render();
        } catch (err) { alert(err.message); }
    });

    const verifyBtn = root.querySelector('.verify-btn');
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

    const statusForm = root.querySelector('#statusForm');
    if (statusForm) {
        statusForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const status = statusForm.status.value;
            let reason = '';
            if (status === 'cancelled') {
                if (!confirm("Cancel this booking? This can't be undone from here.")) return;
                reason = prompt('Reason for cancelling (optional, helps if anyone asks later):', '') || '';
            }
            try {
                await apiSend('PATCH', `/api/bookings/${id}`, { status, reason });
                render();
            } catch (err) { alert(err.message); }
        });
    }

    const checkoutForm = root.querySelector('#checkoutForm');
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const msg = document.getElementById('checkoutMessage');
            const amount = Number(form.amount.value || 0);
            try {
                const result = await apiSend('POST', `/api/bookings/${id}/checkout`, {
                    amount: amount > 0 ? amount : undefined,
                    method: form.method.value,
                    transactionId: form.transactionId.value
                });
                msg.textContent = `Checked out at ${formatPKT(result.booking.checked_out_at)}.`;
                msg.className = 'form-message success';
                render();
            } catch (err) {
                msg.textContent = err.message;
                msg.className = 'form-message error';
            }
        });
    }

    root.querySelector('#chargeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        try {
            await apiSend('POST', `/api/bookings/${id}/charges`, {
                description: form.description.value,
                amount: Number(form.amount.value),
                category: form.category.value
            });
            render();
        } catch (err) { alert(err.message); }
    });

    root.querySelectorAll('.remove-charge-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remove this charge?')) return;
            try {
                await apiSend('DELETE', `/api/bookings/${id}/charges/${btn.dataset.charge}`, {});
                render();
            } catch (err) { alert(err.message); }
        });
    });

    root.querySelectorAll('.remove-payment-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remove this payment record? This cannot be undone.')) return;
            try {
                await apiSend('DELETE', `/api/bookings/${id}/payments/${btn.dataset.payment}`, {});
                render();
            } catch (err) { alert(err.message); }
        });
    });

    const deleteBtn = root.querySelector('#deleteBookingBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`Permanently delete booking #${id} and its full payment history? This cannot be undone.`)) return;
            try {
                await apiSend('DELETE', `/api/bookings/${id}`, {});
                alert('Booking deleted.');
                window.location.href = 'admin.html';
            } catch (err) { alert(err.message); }
        });
    }

    root.querySelector('#taxForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        try {
            await apiSend('PATCH', `/api/bookings/${id}/tax`, { taxPercent: Number(form.taxPercent.value) });
            render();
        } catch (err) { alert(err.message); }
    });

    root.querySelector('#minibarChargeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const msg = document.getElementById('minibarChargeMessage');
        if (!form.itemId.value) return;
        try {
            await apiSend('POST', `/api/minibar/${form.itemId.value}/consume`, {
                bookingId: id, quantity: Number(form.quantity.value)
            });
            msg.textContent = "Charged to the guest's bill.";
            msg.className = 'form-message success';
            render();
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'form-message error';
        }
    });

    root.querySelector('#invoiceFieldsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const msg = document.getElementById('invoiceFieldsMessage');
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

    root.querySelector('#copyLinkBtn').addEventListener('click', async () => {
        const btn = root.querySelector('#copyLinkBtn');
        const link = `${window.location.origin}/invoice.html?id=${id}&token=${btn.dataset.token}`;
        try {
            await navigator.clipboard.writeText(link);
            btn.textContent = 'Link Copied!';
        } catch (err) {
            prompt('Copy this link to send to the guest:', link);
        }
        setTimeout(() => { btn.textContent = 'Copy Guest Link'; }, 2000);
    });

    root.querySelector('#editBookingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const msg = document.getElementById('editMessage');
        try {
            await apiSend('PATCH', `/api/bookings/${id}/details`, {
                name: form.name.value, email: form.email.value, phone: form.phone.value,
                guests: Number(form.guests.value), checkin: form.checkin.value, checkout: form.checkout.value,
                specialRequests: form.specialRequests.value
            });
            msg.textContent = 'Saved.';
            msg.className = 'form-message success';
            render();
        } catch (err) {
            msg.textContent = err.message;
            msg.className = 'form-message error';
        }
    });
}

render();
