function money(n) {
    const num = Math.round(Number(n || 0));
    return `Rs. ${num.toLocaleString('en-US')}`;
}

const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    checked_out: 'Checked Out', cancelled: 'Cancelled'
};
const PAYMENT_LABELS = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Paid in Full' };

let currentBooking = null;

document.getElementById('lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('lookupMessage');
    msg.textContent = '';
    try {
        const invoiceNumber = encodeURIComponent(document.getElementById('lookupInvoiceNumber').value.trim());
        const phone = encodeURIComponent(document.getElementById('lookupPhone').value.trim());
        const res = await fetch(`/api/bookings/public-lookup?invoiceNumber=${invoiceNumber}&phone=${phone}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Booking not found');

        currentBooking = data;
        document.getElementById('resultRoomName').textContent = data.roomName;
        document.getElementById('resultInvoiceNumber').textContent = data.invoiceNumber;
        document.getElementById('resultCheckin').textContent = data.checkin;
        document.getElementById('resultCheckout').textContent = data.checkout;
        document.getElementById('resultStatus').textContent = STATUS_LABELS[data.status] || data.status;
        document.getElementById('resultPayment').textContent = PAYMENT_LABELS[data.paymentStatus] || data.paymentStatus;
        document.getElementById('resultTotal').textContent = money(data.totalAmount);

        const canCancel = ['pending', 'confirmed'].includes(data.status);
        document.getElementById('cancelSection').style.display = data.cancellationRequestedAt || !canCancel ? 'none' : 'block';
        document.getElementById('alreadyRequestedNote').style.display = data.cancellationRequestedAt ? 'block' : 'none';
        if (data.cancellationRequestedAt) {
            document.getElementById('requestedDate').textContent = data.cancellationRequestedAt;
        }

        document.getElementById('bookingResult').style.display = 'block';
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
        document.getElementById('bookingResult').style.display = 'none';
    }
});

document.getElementById('requestCancelBtn').addEventListener('click', async () => {
    if (!currentBooking) return;
    if (!confirm('Request cancellation for this booking? Our team will review it against the cancellation policy.')) return;
    const msg = document.getElementById('cancelMessage');
    try {
        const res = await fetch('/api/bookings/public-lookup/request-cancellation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceNumber: currentBooking.invoiceNumber, phone: document.getElementById('lookupPhone').value.trim() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong');
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Cancellation requested. Our team will be in touch shortly.';
        document.getElementById('cancelSection').style.display = 'none';
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});
