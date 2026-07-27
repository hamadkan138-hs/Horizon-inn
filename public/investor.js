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

/* ---------------- Chart theme (dark charcoal + bronze/gold) ---------------- */
// Guarded: if Chart.js hasn't loaded (slow CDN, ad-blocker, offline), the
// dashboard's login and every other feature must keep working — only the
// charts themselves should be affected.
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#9b968c';
    Chart.defaults.borderColor = 'rgba(233, 207, 154, 0.1)';
    Chart.defaults.font.family = "'Lora', Georgia, serif";
}

const BRONZE_GOLD_PALETTE = ['#cda05a', '#8c6239', '#e9cf9a', '#6f5636', '#a9793f', '#4a3a26', '#b98d4d'];

function bronzeGoldGradient(ctx, chartArea, vertical) {
    if (!chartArea) return 'rgba(205,160,90,0.4)';
    const gradient = vertical
        ? ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top)
        : ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    gradient.addColorStop(0, '#8c6239');
    gradient.addColorStop(1, '#e9cf9a');
    return gradient;
}

function gloryFade(ctx, chartArea) {
    if (!chartArea) return 'rgba(205,160,90,0.2)';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(205,160,90,0.38)');
    gradient.addColorStop(1, 'rgba(205,160,90,0)');
    return gradient;
}

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

        const kpi = (icon, label, value) => `
            <div class="summary-card">
                <div class="kpi-icon"><i class="fas ${icon}"></i></div>
                <span>${label}</span>
                <strong>${value}</strong>
            </div>
        `;
        document.getElementById('summaryCards').innerHTML = [
            kpi('fa-sack-dollar', 'Total Revenue', money(summary.totalRevenue)),
            kpi('fa-file-invoice-dollar', 'Total Expenses', money(summary.totalExpenses)),
            kpi('fa-chart-line', 'Net Profit / Loss', money(summary.netProfit)),
            kpi('fa-door-open', 'Occupancy Rate', percent(occupancy.overallRate)),
            kpi('fa-arrow-trend-up', 'ROI', roi.roiPercent !== null ? `${roi.roiPercent}%` : 'Not set'),
            kpi('fa-hand-holding-dollar', 'Collected Payments', money(summary.totalCollected)),
            kpi('fa-calendar-check', 'Bookings', summary.totalBookings)
        ].join('');

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
            datasets: [{
                label: 'Revenue',
                data: data.map((d) => d.revenue),
                backgroundColor: (c) => bronzeGoldGradient(c.chart.ctx, c.chart.chartArea, true),
                borderColor: 'rgba(233, 207, 154, 0.55)',
                borderWidth: 1,
                borderRadius: 8,
                borderSkipped: false,
                maxBarThickness: 46
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, grid: { color: 'rgba(233, 207, 154, 0.08)' }, ticks: { maxTicksLimit: 5 } }
            }
        }
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
                backgroundColor: BRONZE_GOLD_PALETTE,
                borderColor: '#1a1c24',
                borderWidth: 2
            }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

async function renderExpenseBreakdown() {
    const range = currentRange();
    const data = await apiGet(`/api/investor/expense-breakdown${range}`);
    if (expenseBreakdownChartInstance) expenseBreakdownChartInstance.destroy();
    expenseBreakdownChartInstance = new Chart(document.getElementById('expenseBreakdownChart'), {
        type: 'doughnut',
        data: {
            labels: data.map((d) => d.category),
            datasets: [{ data: data.map((d) => d.total), backgroundColor: BRONZE_GOLD_PALETTE, borderColor: '#1a1c24', borderWidth: 2 }]
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
                borderColor: (c) => bronzeGoldGradient(c.chart.ctx, c.chart.chartArea, false),
                backgroundColor: (c) => gloryFade(c.chart.ctx, c.chart.chartArea),
                borderWidth: 2.5,
                pointBackgroundColor: '#e9cf9a',
                pointBorderColor: '#17130a',
                pointRadius: 3,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: 'rgba(233, 207, 154, 0.08)' }, ticks: { maxTicksLimit: 5 } }
            }
        }
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
