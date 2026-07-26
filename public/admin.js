const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

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
    div.textContent = str;
    return div.innerHTML;
}

async function loadBookings() {
    try {
        const bookings = await apiGet('/api/bookings');
        const body = document.getElementById('bookingsBody');
        body.innerHTML = bookings.map((b) => `
            <tr>
                <td>${b.id}</td>
                <td>${escapeHtml(b.name)}<br><small>${escapeHtml(b.email)} · ${escapeHtml(b.phone)}</small></td>
                <td>${escapeHtml(b.room_name)}</td>
                <td>${b.checkin}</td>
                <td>${b.checkout}</td>
                <td>${b.guests}</td>
                <td><span class="status-pill ${b.status}">${b.status}</span></td>
                <td>
                    ${b.status !== 'confirmed' ? `<button class="action-btn confirm" data-id="${b.id}" data-status="confirmed">Confirm</button>` : ''}
                    ${b.status !== 'cancelled' ? `<button class="action-btn cancel" data-id="${b.id}" data-status="cancelled">Cancel</button>` : ''}
                </td>
            </tr>
        `).join('') || '<tr><td colspan="8">No bookings yet.</td></tr>';

        body.querySelectorAll('.action-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                await apiPatch(`/api/bookings/${btn.dataset.id}`, { status: btn.dataset.status });
                loadBookings();
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
