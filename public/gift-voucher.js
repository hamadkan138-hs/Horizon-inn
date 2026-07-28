document.querySelectorAll('.tier-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tier-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('voucherAmount').value = btn.dataset.amount;
    });
});

document.getElementById('voucherForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('voucherFormMessage');
    try {
        const res = await fetch('/api/gift-vouchers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Number(document.getElementById('voucherAmount').value),
                purchaserName: document.getElementById('purchaserName').value,
                purchaserPhone: document.getElementById('purchaserPhone').value,
                purchaserEmail: document.getElementById('purchaserEmail').value,
                recipientName: document.getElementById('recipientName').value,
                paymentMethod: document.getElementById('voucherPaymentMethod').value,
                transactionId: document.getElementById('voucherTransactionId').value
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong');
        msg.style.color = '#3d7a4f';
        msg.textContent = `Request received! Once we confirm your payment, we'll send your voucher code to ${document.getElementById('purchaserPhone').value}.`;
        document.getElementById('voucherForm').reset();
        document.querySelectorAll('.tier-btn').forEach((b) => b.classList.remove('selected'));
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});
