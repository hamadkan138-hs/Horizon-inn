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

async function apiSend(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
    });
    if (res.status === 401 || res.status === 403) { localStorage.removeItem('horizonInvestorAuth'); showLogin(); throw new Error('Unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
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

/* ================================================================
   Tabs
================================================================ */
const TAB_LOADERS = {
    myinvestment: loadMyInvestmentTab,
    valuation: loadValuationTab,
    projects: loadProjectsTab
};

document.getElementById('investorTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-tab');
    if (!btn) return;
    document.querySelectorAll('#investorTabs .admin-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach((p) => { p.style.display = 'none'; });
    document.getElementById(`panel-${btn.dataset.tab}`).style.display = 'block';
    if (TAB_LOADERS[btn.dataset.tab]) TAB_LOADERS[btn.dataset.tab]();
});

/* ================================================================
   My Investment
================================================================ */
const COMPLIANCE_LABELS = { pending: 'Pending', verified: 'Verified', signed: 'Signed', rejected: 'Rejected' };
let myInvestorProfile = null;

async function loadMyInvestmentTab() {
    const container = document.getElementById('myInvestmentContent');
    if (currentUser.role !== 'investor') {
        container.innerHTML = `
            <div class="glass-card">
                <p style="color: var(--text-2);">This admin account isn't linked to an investor profile — "My Investment" is personalized per investor. Use the Investor Accounts panel in Admin to create and manage investor profiles.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `<p style="color: var(--text-2);">Loading your investment profile&hellip;</p>`;
    try {
        const [me, requests] = await Promise.all([
            apiGet('/api/investor-accounts/me'),
            apiGet('/api/investor-accounts/withdrawal-requests')
        ]);
        myInvestorProfile = me;

        const complianceBadge = (label, status) => `
            <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-2); display: block; margin-bottom: 6px;">${label}</span>
                <span class="compliance-badge ${status}">${COMPLIANCE_LABELS[status] || status}</span>
            </div>
        `;

        const requestRows = requests.map((r) => `
            <tr>
                <td>${r.requestedAt.slice(0, 10)}</td>
                <td>${r.type === 'dividend' ? 'Dividend' : 'Capital'}</td>
                <td>${money(r.amount)}</td>
                <td><span class="compliance-badge ${r.status === 'completed' ? 'verified' : r.status === 'rejected' ? 'rejected' : 'pending'}">${r.status}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="4">No withdrawal requests yet.</td></tr>';

        container.innerHTML = `
            <div class="glass-card">
                <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 20px; align-items: flex-start;">
                    <div>
                        <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2);">Investor Code</span>
                        <h2 style="text-align: left; margin: 4px 0 0; font-size: 1.5rem;">${me.investorCode}</h2>
                    </div>
                    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                        ${complianceBadge('SPA Status', me.spaStatus)}
                        ${complianceBadge('Accredited Investor', me.accreditedStatus)}
                        ${complianceBadge('AML / KYC', me.amlKycStatus)}
                    </div>
                </div>
            </div>

            <div class="summary-cards">
                <div class="summary-card"><div class="kpi-icon"><i class="fas fa-coins"></i></div><span>Capital Invested</span><strong>${money(me.capitalInvested)}</strong></div>
                <div class="summary-card"><div class="kpi-icon"><i class="fas fa-chart-pie"></i></div><span>Ownership Share</span><strong>${me.ownershipPercent}%</strong></div>
                <div class="summary-card"><div class="kpi-icon"><i class="fas fa-building-columns"></i></div><span>Current Equity Value</span><strong>${money(me.equityValue)}</strong></div>
                <div class="summary-card"><div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div><span>Accrued Dividend (All-Time)</span><strong class="emerald">${money(me.accruedDividend)}</strong></div>
            </div>

            <div class="glass-card">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <h3><i class="fas fa-hand-holding-dollar"></i> Dividend Earnings</h3>
                    <span class="turnaround-badge"><i class="fas fa-bolt"></i> ${me.dividendTurnaroundHours}-Hour Processing Time</span>
                </div>
                <p style="color: var(--text-2); margin: 10px 0;">Available to withdraw right now (after already-withdrawn and pending requests):</p>
                <p style="font-family: 'Playfair Display', serif; font-size: 2rem; color: var(--emerald); margin-bottom: 16px;">${money(me.availableToWithdraw)}</p>
                <button class="action-btn confirm withdraw-btn" id="openDividendWithdrawBtn" ${me.availableToWithdraw <= 0 ? 'disabled' : ''}>
                    <i class="fas fa-hand-holding-dollar"></i> Withdraw Earnings
                </button>
            </div>

            <div class="glass-card">
                <h3><i class="fas fa-lock"></i> Principal Capital</h3>
                <p style="color: var(--text-2); margin: 10px 0 4px;">Lockup period: ${me.lockup.lockupStart} &rarr; ${me.lockup.lockupEnd}</p>
                <div class="lockup-bar"><div class="lockup-bar-fill" style="width: ${me.lockup.progressPercent}%;"></div></div>
                <p style="color: var(--text-2); font-size: 0.85rem; margin-bottom: 16px;">
                    ${me.lockup.unlocked
                        ? '<span class="emerald"><i class="fas fa-lock-open"></i> Capital unlocked — release is available.</span>'
                        : `<i class="fas fa-hourglass-half"></i> ${me.lockup.daysRemaining} day(s) remaining until capital can be released.`}
                </p>
                <button class="action-btn withdraw-btn" id="openCapitalWithdrawBtn" ${me.lockup.unlocked ? '' : 'disabled'}>
                    <i class="fas fa-unlock"></i> Capital Release
                </button>
            </div>

            <div class="glass-card">
                <h3 style="margin-bottom: 14px;">My Withdrawal Requests</h3>
                <div style="overflow-x: auto;">
                    <table class="admin-table">
                        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>${requestRows}</tbody>
                    </table>
                </div>
            </div>
        `;

        const dividendBtn = document.getElementById('openDividendWithdrawBtn');
        if (dividendBtn) dividendBtn.addEventListener('click', () => openWithdrawModal('dividend', me));
        const capitalBtn = document.getElementById('openCapitalWithdrawBtn');
        if (capitalBtn) capitalBtn.addEventListener('click', () => openWithdrawModal('capital', me));
    } catch (err) {
        container.innerHTML = `<div class="glass-card"><p class="danger-text">${err.message}</p></div>`;
    }
}

/* ---------------- Withdraw modal ---------------- */
const withdrawOverlay = document.getElementById('withdrawModalOverlay');
let withdrawType = 'dividend';

function openWithdrawModal(type, profile) {
    withdrawType = type;
    document.getElementById('withdrawModalTitle').textContent = type === 'dividend' ? 'Withdraw Earnings' : 'Capital Release';
    document.getElementById('withdrawModalSubtitle').textContent = type === 'dividend'
        ? `Up to ${money(profile.availableToWithdraw)} available. Requests are reviewed and paid out by Horizon Inn within ${profile.dividendTurnaroundHours} hours.`
        : `Principal capital release request. Processed manually by Horizon Inn once approved.`;
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawMessage').textContent = '';
    withdrawOverlay.style.display = 'flex';
}
document.getElementById('closeWithdrawModalBtn').addEventListener('click', () => { withdrawOverlay.style.display = 'none'; });
withdrawOverlay.addEventListener('click', (e) => { if (e.target === withdrawOverlay) withdrawOverlay.style.display = 'none'; });

document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('withdrawMessage');
    const amount = Number(document.getElementById('withdrawAmount').value);
    const submitBtn = e.target.querySelector('button[type="submit"]');
    msg.textContent = '';
    submitBtn.disabled = true;
    try {
        await apiSend('POST', '/api/investor-accounts/withdrawal-requests', { type: withdrawType, amount });
        withdrawOverlay.style.display = 'none';
        alert(`Request submitted. ${withdrawType === 'dividend' ? 'Dividend' : 'Capital release'} requests are processed manually by Horizon Inn.`);
        loadMyInvestmentTab();
    } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-message error';
    } finally {
        submitBtn.disabled = false;
    }
});

/* ================================================================
   Hotel Valuation & Metrics
================================================================ */
let equityBreakdownChartInstance = null;
let assetGrowthChartInstance = null;

async function loadValuationTab() {
    try {
        const [valuation, occupancy, summary90] = await Promise.all([
            apiGet('/api/investor-accounts/valuation'),
            apiGet('/api/investor/occupancy'),
            apiGet(`/api/investor/summary?from=${ninetyDaysAgo()}&to=${todayStr()}`)
        ]);

        const amount = valuation.current ? valuation.current.amount : 0;
        const annualizedYield = amount > 0 ? ((summary90.netProfit / amount) * 4 * 100) : 0;

        document.getElementById('valuationSummaryCards').innerHTML = `
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-building"></i></div><span>Total Property Valuation</span><strong>${money(amount)}</strong></div>
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-coins"></i></div><span>Total Capital Raised</span><strong>${money(valuation.totalCapitalRaised)}</strong></div>
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-vault"></i></div><span>Remaining Share Pool</span><strong>${money(valuation.remainingPool)}</strong></div>
        `;

        document.getElementById('kpiMetricsCards').innerHTML = `
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-door-open"></i></div><span>Occupancy Rate (14d window)</span><strong>${percent(occupancy.overallRate)}</strong></div>
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-arrow-trend-up"></i></div><span>Est. Annualized Yield</span><strong class="${annualizedYield >= 0 ? 'emerald' : 'danger-text'}">${annualizedYield.toFixed(1)}%</strong></div>
            <div class="summary-card"><div class="kpi-icon"><i class="fas fa-scale-unbalanced"></i></div><span>Trailing 90-Day Net Income</span><strong class="${summary90.netProfit >= 0 ? 'emerald' : 'danger-text'}">${money(summary90.netProfit)}</strong></div>
        `;

        if (equityBreakdownChartInstance) equityBreakdownChartInstance.destroy();
        equityBreakdownChartInstance = new Chart(document.getElementById('equityBreakdownChart'), {
            type: 'doughnut',
            data: {
                labels: ['Capital Raised', 'Remaining Share Pool'],
                datasets: [{ data: [valuation.totalCapitalRaised, valuation.remainingPool], backgroundColor: ['#d4af37', 'rgba(255,255,255,0.08)'], borderColor: '#1a1c24', borderWidth: 2 }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });

        if (assetGrowthChartInstance) assetGrowthChartInstance.destroy();
        assetGrowthChartInstance = new Chart(document.getElementById('assetGrowthChart'), {
            type: 'line',
            data: {
                labels: valuation.history.map((h) => h.createdAt.slice(0, 10)),
                datasets: [{
                    label: 'Valuation',
                    data: valuation.history.map((h) => h.amount),
                    borderColor: (c) => bronzeGoldGradient(c.chart.ctx, c.chart.chartArea, false),
                    backgroundColor: (c) => gloryFade(c.chart.ctx, c.chart.chartArea),
                    borderWidth: 2.5, pointBackgroundColor: '#e9cf9a', pointBorderColor: '#17130a', pointRadius: 4, fill: true, tension: 0.25
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(233,207,154,0.08)' } } } }
        });
    } catch (err) { /* handled */ }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function ninetyDaysAgo() { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); }

/* ================================================================
   Upcoming Projects & ROI Calculator
================================================================ */
let roiBaseline = { valuation: 0, monthlyNetIncome: 0 };

async function loadProjectsTab() {
    try {
        const [projects, valuation, summary90] = await Promise.all([
            apiGet('/api/investor-accounts/projects'),
            apiGet('/api/investor-accounts/valuation'),
            apiGet(`/api/investor/summary?from=${ninetyDaysAgo()}&to=${todayStr()}`)
        ]);

        roiBaseline.valuation = valuation.current ? valuation.current.amount : 0;
        roiBaseline.monthlyNetIncome = summary90.netProfit / 3;
        document.getElementById('roiValuationRef').textContent = money(roiBaseline.valuation);

        document.getElementById('projectGrid').innerHTML = projects.map((p) => `
            <div class="glass-card project-card">
                <div class="project-media"><i class="fas fa-hotel"></i></div>
                <div class="project-body">
                    <span class="status-chip">${p.status}</span>
                    <h4>${escapeHtml(p.name)}</h4>
                    <p style="color: var(--text-2); font-size: 0.85rem; margin: 8px 0;">${escapeHtml(p.description)}</p>
                    <p style="font-size: 0.82rem;"><i class="fas fa-location-dot" style="color: var(--gold-light);"></i> ${escapeHtml(p.location)}</p>
                    <p style="font-size: 0.82rem; margin-top: 6px;"><i class="fas fa-arrow-trend-up" style="color: var(--emerald);"></i> ${escapeHtml(p.growthPotential)}</p>
                    <div class="meta-row">
                        <span>Capital Needed<br><strong style="color: var(--gold-light);">${money(p.targetCapital)}</strong></span>
                        <span style="text-align: right;">Target Launch<br><strong style="color: var(--gold-light);">${escapeHtml(p.timeline || 'TBD')}</strong></span>
                    </div>
                </div>
            </div>
        `).join('') || '<p style="color: var(--text-2);">No upcoming projects listed yet.</p>';

        updateRoiCalculator();
    } catch (err) { /* handled */ }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function updateRoiCalculator() {
    const amount = Number(document.getElementById('roiAmount').value || 0);
    const ownership = roiBaseline.valuation > 0 ? (amount / roiBaseline.valuation) * 100 : 0;
    const monthlyDividend = Math.max(0, roiBaseline.monthlyNetIncome * (ownership / 100));
    const annualRoi = amount > 0 ? ((monthlyDividend * 12) / amount) * 100 : 0;

    document.getElementById('roiOwnership').textContent = `${ownership.toFixed(2)}%`;
    document.getElementById('roiMonthly').textContent = money(monthlyDividend);
    document.getElementById('roiAnnual').textContent = `${annualRoi.toFixed(1)}%`;
}

document.getElementById('roiSlider').addEventListener('input', (e) => {
    document.getElementById('roiAmount').value = e.target.value;
    updateRoiCalculator();
});
document.getElementById('roiAmount').addEventListener('input', (e) => {
    document.getElementById('roiSlider').value = Math.min(2000000, Number(e.target.value) || 0);
    updateRoiCalculator();
});

/* ---------------- Boot ---------------- */
if (localStorage.getItem('horizonInvestorAuth')) {
    showDashboard();
} else {
    showLogin();
}
