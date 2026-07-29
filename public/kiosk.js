/* Horizon Inn — guest self-service check-in kiosk.
 *
 * Runs unattended on a lobby tablet. Two things make it different from the
 * staff front desk (frontdesk.js), which it otherwise mirrors:
 *   1. The device authenticates once; the guest never sees a login.
 *   2. Everything resets on inactivity, so one guest's details are never left
 *      on screen for the next person who walks up.
 */

const AUTH_KEY = 'horizonKioskAuth';
const IDLE_MS = 90 * 1000;       // return to attract screen after inactivity
const DONE_IDLE_MS = 45 * 1000;  // shorter on the confirmation screen — it shows a room number

const deviceLoginPanel = document.getElementById('deviceLoginPanel');
const kiosk = document.getElementById('kiosk');

const states = {
    idle: document.getElementById('stateIdle'),
    identify: document.getElementById('stateIdentify'),
    confirm: document.getElementById('stateConfirm'),
    done: document.getElementById('stateDone'),
    reception: document.getElementById('stateReception')
};

let activeBooking = null;
let idleTimer = null;

/* ---------------- API ---------------- */
function authHeader() {
    const token = localStorage.getItem(AUTH_KEY);
    return token ? { Authorization: `Basic ${token}` } : {};
}

async function apiPost(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body || {})
    });
    if (res.status === 401) {
        // The device account was removed or its password changed — drop back to
        // setup rather than showing a guest an error they can't act on.
        localStorage.removeItem(AUTH_KEY);
        showDeviceLogin();
        throw new Error('Kiosk needs to be signed in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please see reception.');
    return data;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function money(n) {
    return `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
}

function formatDate(iso) {
    if (!iso) return '';
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
}

/* ---------------- Idle reset ----------------
 * The single most important kiosk behaviour: a guest who walks away mid-flow
 * must not leave their name, booking or room number on a public screen. */
function resetIdleTimer(ms = IDLE_MS) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, ms);
}

function stopIdleTimer() {
    clearTimeout(idleTimer);
}

function goIdle() {
    activeBooking = null;
    document.getElementById('identifyForm').reset();
    document.getElementById('identifyMessage').textContent = '';
    document.getElementById('confirmMessage').textContent = '';
    document.getElementById('confirmDetails').innerHTML = '';
    document.getElementById('confirmBalance').style.display = 'none';
    showState('idle');
    stopIdleTimer(); // the attract screen holds no guest data, so nothing to time out
}

function showState(name) {
    Object.values(states).forEach((el) => { el.style.display = 'none'; });
    states[name].style.display = '';
    if (name === 'idle') stopIdleTimer();
    else if (name === 'done' || name === 'reception') resetIdleTimer(DONE_IDLE_MS);
    else resetIdleTimer();
}

// Any interaction postpones the reset, so a guest slowly typing their CNIC
// isn't cleared mid-entry.
['touchstart', 'keydown', 'click'].forEach((evt) => {
    document.addEventListener(evt, () => {
        if (states.idle.style.display === 'none') resetIdleTimer(
            states.done.style.display !== 'none' || states.reception.style.display !== 'none'
                ? DONE_IDLE_MS : IDLE_MS
        );
    }, { passive: true });
});

/* ---------------- Device setup ---------------- */
function showDeviceLogin() {
    deviceLoginPanel.style.display = 'block';
    kiosk.style.display = 'none';
    stopIdleTimer();
}

async function activateKiosk() {
    // Never probe the API without credentials: a 401 from adminAuth carries a
    // WWW-Authenticate: Basic header, which makes the browser throw up its own
    // native password dialog over the kiosk. Same reason admin.js and
    // frontdesk.js check localStorage before their first request.
    if (!localStorage.getItem(AUTH_KEY)) {
        showDeviceLogin();
        return;
    }
    try {
        const res = await fetch('/api/auth/me', { headers: authHeader() });
        if (!res.ok) { localStorage.removeItem(AUTH_KEY); showDeviceLogin(); return; }
        deviceLoginPanel.style.display = 'none';
        kiosk.style.display = 'block';
        goIdle();
    } catch (err) {
        showDeviceLogin();
    }
}

document.getElementById('deviceLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('deviceLoginMessage');
    const token = btoa(`${document.getElementById('kioskUser').value}:${document.getElementById('kioskPass').value}`);
    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) {
            msg.textContent = res.status === 429
                ? 'Too many failed attempts. Try again shortly.'
                : 'Invalid username or password.';
            return;
        }
        localStorage.setItem(AUTH_KEY, token);
        msg.textContent = '';
        document.getElementById('deviceLoginForm').reset();
        activateKiosk();
    } catch (err) {
        msg.textContent = 'Network error. Please try again.';
    }
});

/* ---------------- Guest flow ---------------- */
document.getElementById('startBtn').addEventListener('click', () => {
    showState('identify');
    document.getElementById('ksCnic').focus();
});

document.querySelectorAll('[data-restart]').forEach((btn) => {
    btn.addEventListener('click', goIdle);
});

function toReception(reason) {
    document.getElementById('receptionReason').textContent = reason;
    showState('reception');
}

document.getElementById('identifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('identifyMessage');
    const btn = document.getElementById('findBtn');
    msg.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Looking up…';
    try {
        activeBooking = await apiPost('/api/kiosk/lookup', {
            cnic: document.getElementById('ksCnic').value,
            surname: document.getElementById('ksSurname').value
        });

        if (activeBooking.status === 'checked_in') {
            toReception('You are already checked in — please collect your key from reception.');
            return;
        }

        document.getElementById('confirmGreeting').textContent = `Welcome, ${activeBooking.name}`;
        document.getElementById('confirmDetails').innerHTML = `
            <div><dt>Room</dt><dd>${escapeHtml(activeBooking.roomName)}</dd></div>
            <div><dt>Arriving</dt><dd>${formatDate(activeBooking.checkin)}</dd></div>
            <div><dt>Departing</dt><dd>${formatDate(activeBooking.checkout)}</dd></div>
            <div><dt>Guests</dt><dd>${activeBooking.guests}</dd></div>
            <div><dt>Booking</dt><dd>${escapeHtml(activeBooking.invoiceNumber)}</dd></div>
        `;

        // Shown for transparency, not as a blocker — the guest settles up at
        // checkout, and a balance is never a reason to refuse them their room.
        const balanceEl = document.getElementById('confirmBalance');
        if (activeBooking.balanceDue > 0) {
            balanceEl.innerHTML = `<span>Balance due at checkout</span><strong>${money(activeBooking.balanceDue)}</strong>`;
            balanceEl.style.display = 'flex';
        } else {
            balanceEl.style.display = 'none';
        }

        showState('confirm');
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Find My Booking';
    }
});

document.getElementById('confirmBtn').addEventListener('click', async () => {
    if (!activeBooking) return goIdle();
    const msg = document.getElementById('confirmMessage');
    const btn = document.getElementById('confirmBtn');
    msg.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Checking you in…';
    try {
        const result = await apiPost(`/api/kiosk/${activeBooking.id}/self-checkin`, {});
        document.getElementById('doneTitle').textContent = `You're checked in, ${result.name.split(' ')[0]}`;
        document.getElementById('doneRoom').innerHTML = result.roomNumber
            ? `Room <strong>${escapeHtml(result.roomNumber)}</strong>${result.floor ? ` &middot; Floor ${escapeHtml(result.floor)}` : ''}`
            : '';
        document.getElementById('doneMeta').textContent =
            `${result.roomName} · Checking out ${formatDate(result.checkout)}`;
        document.getElementById('doneNextSteps').innerHTML = `
            <p><i class="fas fa-key"></i> Collect your room key from reception.</p>
            ${result.balanceDue > 0 ? `<p><i class="fas fa-receipt"></i> Balance of <strong>${money(result.balanceDue)}</strong> is payable at checkout.</p>` : ''}
        `;
        showState('done');
    } catch (err) {
        // Anything that stops an unattended check-in is a job for a person.
        toReception(err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm & Check In';
    }
});

activateKiosk();
