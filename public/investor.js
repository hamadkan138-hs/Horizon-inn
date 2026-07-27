const loginPanel = document.getElementById('loginPanel');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');

let currentUser = null;
let revenueTrendChartInstance = null;
let incomeBreakdownChartInstance = null;
let expenseBreakdownChartInstance = null;
let profitChartInstance = null;
let lastLedger = [];
let refreshTimer = null;

function getAuthHeader() {
    const token = localStorage.getItem('horizonInvestorAuth');
    return token ? { Authorization: `Basic ${token}` } : {};
}

async function apiGet(path) {
    const res = await fetch(path, { headers: getAuthHeader() });
    if (res.status === 401 || res.status === 403) { localStorage.removeItem('horizonInvestorAuth'); showLogin(); throw new Error('Unauthorized'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
}

function money(n) {
    const num = Math.round(Number(n || 0));
    return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function percent(n) {
    return `${(Number(n || 0) * 100).toFixed(1)}%`;
}

function showLogin() {
    loginPanel.style.display = 'block';
    dashboard.style.display = 'none';
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
}

function currentRange() {
    const from = document.getElementById('rangeFrom').value;
    const to = document.getElementById('rangeTo').value;
    return from && to ? `?from=${from}&to=${to}` : '';
}

async function showDashboard() {
    loginPanel.style.display = 'none';
    dashboard.style.display = 'block';
    try {
        currentUser = await apiGet('/api/auth/me');
        if (!['admin', 'investor'].includes(currentUser.role)) {
            alert('This account does not have investor access.');
            localStorage.removeItem('horizonInvestorAuth');
            showLogin();
            return;
        }
        document.getElementById('whoami').textContent = `${currentUser.username} (${currentUser.role})`;
    } catch (err) { return; }

    loadAll();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadAll(), 60000);
}

async function loadAll() {
    try {
        const range = currentRange();
        const [summary, occupancy, roi] = await Promise.all([
            apiGet(`/api/investor/summary${range}`),
            apiGet(`/api/investor/occupancy${range}`),
            apiGet(`/api/investor/roi${range}`)
        ]);

        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card"><span>Total Revenue</span><strong>${money(summary.totalRevenue)}</strong></div>
            <div class="summary-card"><span>Total Expenses</span><strong>${money(summary.totalExpenses)}</strong></div>
            <div class="summary-card"><span>Net Profit / Loss</span><strong>${money(summary.netProfit)}</strong></div>
            <div class="summary-card"><span>Occupancy Rate</span><strong>${percent(occupancy.overallRate)}</strong></div>
            <div class="summary-card"><span>ROI</span><strong>${roi.roiPercent !== null ? `${roi.roiPercent}%` : 'Not set'}</strong></div>
            <div class="summary-card"><span>Collected Payments</span><strong>${money(summary.totalCollected)}</strong></div>
            <div class="summary-card"><span>Bookings</span><strong>${summary.totalBookings}</strong></div>
        `;

        await Promise.all([renderRevenueTrend(), renderIncomeBreakdown(), renderExpenseBreakdown(), renderProfitChart(), loadLedger()]);
        document.getElementById('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (err) { /* handled */ }
}

async function renderRevenueTrend() {
    const range = currentRange();
    const data = await apiGet(`/api/investor/revenue-trend${range}`);
    if (revenueTrendChartInstance) revenueTrendChartInstance.destroy();
    revenueTrendChartInstance = new Chart(document.getElementById('revenueTrendChart'), {
        type: 'bar',
        data: {
            labels: data.map((d) => d.period),
            datasets: [{ label: 'Revenue', data: data.map((d) => d.revenue), backgroundColor: '#c6a15b' }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

async function renderIncomeBreakdown() {
    const range = currentRange();
    const data = await apiGet(`/api/investor/income-breakdown${range}`);
    if (incomeBreakdownChartInstance) incomeBreakdownChartInstance.destroy();
    incomeBreakdownChartInstance = new Chart(document.getElementById('incomeBreakdownChart'), {
        type: 'doughnut',
        data: {
            labels: ['Room Bookings', 'Amenities', 'Event Rentals', 'Other'],
            datasets: [{
                data: [data.roomBookings, data.amenities, data.eventRentals, data.otherIncome],
                backgroundColor: ['#14161f', '#c6a15b', '#3d7a4f', '#2f5faa']
            }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

async function renderExpenseBreakdown() {
    const range = currentRange();
    const data = await apiGet(`/api/investor/expense-breakdown${range}`);
    if (expenseBreakdownChartInstance) expenseBreakdownChartInstance.destroy();
    const palette = ['#14161f', '#c6a15b', '#3d7a4f', '#2f5faa', '#a5473c', '#8a5fbf', '#c97a3d'];
    expenseBreakdownChartInstance = new Chart(document.getElementById('expenseBreakdownChart'), {
        type: 'doughnut',
        data: {
            labels: data.map((d) => d.category),
            datasets: [{ data: data.map((d) => d.total), backgroundColor: palette }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

async function renderProfitChart() {
    const range = currentRange();
    const [revenue, expenses] = await Promise.all([
        apiGet(`/api/investor/revenue-trend${range}`),
        apiGet(`/api/investor/expense-trend${range}`)
    ]);
    const periods = Array.from(new Set([...revenue.map((r) => r.period), ...expenses.map((e) => e.period)])).sort();
    const revenueMap = Object.fromEntries(revenue.map((r) => [r.period, Number(r.revenue)]));
    const expenseMap = Object.fromEntries(expenses.map((e) => [e.period, Number(e.total)]));

    if (profitChartInstance) profitChartInstance.destroy();
    profitChartInstance = new Chart(document.getElementById('profitChart'), {
        type: 'line',
        data: {
            labels: periods,
            datasets: [{
                label: 'Profit',
                data: periods.map((p) => (revenueMap[p] || 0) - (expenseMap[p] || 0)),
                borderColor: '#14161f',
                backgroundColor: 'rgba(20,22,31,0.08)',
                fill: true,
                tension: 0.3
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

const LEDGER_TYPE_LABELS = { income: 'Income', expense: 'Expense', adjustment: 'Adjustment' };

async function loadLedger() {
    const range = currentRange();
    lastLedger = await apiGet(`/api/investor/ledger${range}`);
    document.getElementById('ledgerBody').innerHTML = lastLedger.map((row) => `
        <tr>
            <td>${row.date}</td>
            <td><span class="status-pill ${row.type === 'expense' ? 'cancelled' : 'confirmed'}">${LEDGER_TYPE_LABELS[row.type] || row.type}</span></td>
            <td>${row.category}</td>
            <td>${row.reference || '—'}${row.note ? ` <span style="color: var(--text-light);">(${row.note})</span>` : ''}</td>
            <td>${money(row.amount)}</td>
        </tr>
    `).join('') || '<tr><td colspan="5">No transactions in this range.</td></tr>';
}

document.getElementById('datePresets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-preset]');
    if (!btn) return;
    document.querySelectorAll('#datePresets button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const days = Number(btn.dataset.preset);
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    document.getElementById('rangeTo').value = to.toISOString().slice(0, 10);
    document.getElementById('rangeFrom').value = from.toISOString().slice(0, 10);
    loadAll();
});

document.getElementById('rangeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    document.querySelectorAll('#datePresets button').forEach((b) => b.classList.remove('active'));
    loadAll();
});

document.getElementById('investorPrintBtn').addEventListener('click', () => window.print());

document.getElementById('investorExportBtn').addEventListener('click', () => {
    const rows = [['Date', 'Type', 'Category', 'Reference', 'Amount']];
    lastLedger.forEach((row) => rows.push([row.date, LEDGER_TYPE_LABELS[row.type] || row.type, row.category, row.reference || '', row.amount]));
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `horizon-inn-investor-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('investorLogoutBtn').addEventListener('click', () => {
    localStorage.removeItem('horizonInvestorAuth');
    showLogin();
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('investorUser').value;
    const pass = document.getElementById('investorPass').value;
    const token = btoa(`${user}:${pass}`);

    try {
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Basic ${token}` } });
        if (!res.ok) { loginMessage.textContent = 'Invalid username or password.'; return; }
        const who = await res.json();
        if (!['admin', 'investor'].includes(who.role)) {
            loginMessage.textContent = 'This account does not have investor access.';
            return;
        }
        localStorage.setItem('horizonInvestorAuth', token);
        loginMessage.textContent = '';
        showDashboard();
    } catch (err) {
        loginMessage.textContent = 'Network error. Please try again.';
    }
});

if (localStorage.getItem('horizonInvestorAuth')) {
    showDashboard();
} else {
    showLogin();
}
