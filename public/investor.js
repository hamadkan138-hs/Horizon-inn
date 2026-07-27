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

/* ---------------- Chart theme (obsidian glass + gold/emerald) ---------------- */
// Guarded: if Chart.js hasn't loaded (slow CDN, ad-blocker, offline), the
// dashboard's login and every other feature must keep working — only the
// charts themselves should be affected.
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.03)';
    Chart.defaults.font.family = "'Inter', 'SF Pro Display', sans-serif";
    Chart.defaults.animation = { duration: 900, easing: 'easeOutQuart' };
}

const BRONZE_GOLD_PALETTE = ['#d4af37', '#059669', '#e8c874', '#0d9488', '#a67c3d', '#065f46', '#b8933f'];

function bronzeGoldGradient(ctx, chartArea, vertical) {
    if (!chartArea) return 'rgba(212,175,55,0.4)';
    const gradient = vertical
        ? ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top)
        : ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    gradient.addColorStop(0, '#8c6239');
    gradient.addColorStop(1, '#e8c874');
    return gradient;
}

function gloryFade(ctx, chartArea) {
    if (!chartArea) return 'rgba(212,175,55,0.2)';
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(212,175,55,0.35)');
    gradient.addColorStop(1, 'rgba(212,175,55,0)');
    return gradient;
}

/* ---------------- Number count-up ---------------- */
// Animates an element's displayed number from its current value to a new
// one (e.g. on load or when a date filter changes) instead of snapping —
// purely a visual polish layer, so it never blocks or delays the actual
// DOM update if something goes wrong mid-animation.
function countUpTo(el, newValue, formatFn, duration = 700) {
    if (!el) return;
    const startValue = Number(el.dataset.rawValue || 0);
    const endValue = Number(newValue) || 0;
    el.dataset.rawValue = endValue;
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || startValue === endValue) {
        el.textContent = formatFn(endValue);
        return;
    }
    const startTime = performance.now();
    function tick(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = formatFn(startValue + (endValue - startValue) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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

    // Investors land on their personalized dashboard first; admins (who have
    // no linked investor profile) keep landing on the business-wide Overview.
    if (currentUser.role === 'investor') {
        document.querySelector('.admin-tab[data-tab="myinvestment"]').click();
    }
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

let trendRange = '7d';
let revExpTrendChartInstance = null;

function rangeForTrendToggle(key) {
    const to = todayStr();
    if (key === '24h') return { from: to, to, range: 'daily' };
    if (key === '7d') { const d = new Date(); d.setDate(d.getDate() - 6); return { from: d.toISOString().slice(0, 10), to, range: 'daily' }; }
    if (key === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); return { from: d.toISOString().slice(0, 10), to, range: 'daily' }; }
    // ytd
    const jan1 = `${new Date().getFullYear()}-01-01`;
    return { from: jan1, to, range: 'monthly' };
}

async function loadMyInvestmentTab() {
    const notice = document.getElementById('investorAdminNotice');
    const body = document.getElementById('myInvestmentBody');

    if (currentUser.role !== 'investor') {
        notice.innerHTML = `
            <div class="glass-card">
                <p style="color: var(--text-2);">This admin account isn't linked to an investor profile — "My Investment" is personalized per investor. Use the Investor Accounts panel in Admin to create and manage investor profiles.</p>
            </div>
        `;
        body.style.display = 'none';
        return;
    }
    notice.innerHTML = '';
    body.style.display = 'block';

    try {
        const [me, requests] = await Promise.all([
            apiGet('/api/investor-accounts/me'),
            apiGet('/api/investor-accounts/withdrawal-requests')
        ]);
        myInvestorProfile = me;

        countUpTo(document.getElementById('miAccruedDividend'), me.accruedDividend, money);
        document.getElementById('miAvailableLine').innerHTML = `Available to withdraw: <strong style="color: var(--text-1);">${money(me.availableToWithdraw)}</strong>`;
        document.getElementById('openDividendWithdrawBtn').disabled = me.availableToWithdraw <= 0;

        countUpTo(document.getElementById('miOwnership'), me.ownershipPercent, (v) => `${v.toFixed(2)}%`);
        countUpTo(document.getElementById('miEquityValue'), me.equityValue, money);
        document.getElementById('miLockupDates').textContent = `${me.lockup.lockupStart} → ${me.lockup.lockupEnd}`;
        document.getElementById('miLockupFill').style.width = `${me.lockup.progressPercent}%`;
        document.getElementById('miLockupNote').innerHTML = me.lockup.unlocked
            ? '<span class="emerald"><i class="fas fa-lock-open"></i> Capital unlocked — release is available.</span>'
            : `<i class="fas fa-hourglass-half"></i> ${me.lockup.daysRemaining} day(s) remaining until capital can be released.`;
        document.getElementById('openCapitalWithdrawBtn').disabled = !me.lockup.unlocked;

        const complianceBadge = (label, status) => `
            <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-2); display: block; margin-bottom: 6px;">${label}</span>
                <span class="compliance-badge ${status}">${COMPLIANCE_LABELS[status] || status}</span>
            </div>
        `;
        document.getElementById('miComplianceBadges').innerHTML =
            complianceBadge('SPA Status', me.spaStatus) +
            complianceBadge('Accredited Investor', me.accreditedStatus) +
            complianceBadge('AML / KYC', me.amlKycStatus);

        document.getElementById('miWithdrawalRequestsBody').innerHTML = requests.map((r) => `
            <tr>
                <td>${r.requestedAt.slice(0, 10)}</td>
                <td>${r.type === 'dividend' ? 'Dividend' : 'Capital'}</td>
                <td>${money(r.amount)}</td>
                <td><span class="compliance-badge ${r.status === 'completed' ? 'verified' : r.status === 'rejected' ? 'rejected' : 'pending'}">${r.status}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="4">No withdrawal requests yet.</td></tr>';

        // allSettled, not all: the figures above (ownership, dividend, lockup,
        // compliance, withdrawal history) have already rendered successfully
        // by this point. One chart failing to draw — e.g. Chart.js blocked or
        // slow to load — must not blank out data that's already correct.
        const results = await Promise.allSettled([
            renderEarningsMomentum(me),
            renderRevExpTrendChart(),
            renderIncomeStreamsChart(),
            renderValuationGaugeAndSimulator(),
            renderProjectsPreview()
        ]);
        results.forEach((r) => { if (r.status === 'rejected') console.warn('My Investment panel section failed:', r.reason); });
    } catch (err) {
        notice.innerHTML = `<div class="glass-card"><p class="danger-text">${err.message}</p></div>`;
        body.style.display = 'none';
    }
}

document.getElementById('openDividendWithdrawBtn').addEventListener('click', () => { if (myInvestorProfile) openWithdrawModal('dividend', myInvestorProfile); });
document.getElementById('openCapitalWithdrawBtn').addEventListener('click', () => { if (myInvestorProfile) openWithdrawModal('capital', myInvestorProfile); });

document.getElementById('trendRangeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.mini-toggle-btn');
    if (!btn) return;
    document.querySelectorAll('#trendRangeToggle .mini-toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    trendRange = btn.dataset.range;
    renderRevExpTrendChart();
});

async function renderEarningsMomentum(me) {
    const today = todayStr();
    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 6);
    const weekAgo = weekAgoDate.toISOString().slice(0, 10);

    const [todaySummary, weekSummary] = await Promise.all([
        apiGet(`/api/investor/summary?from=${today}&to=${today}`),
        apiGet(`/api/investor/summary?from=${weekAgo}&to=${today}`)
    ]);
    const share = Number(me.ownershipPercent) / 100;
    const todayEarnings = Math.max(0, todaySummary.netProfit * share);
    const weekEarnings = Math.max(0, weekSummary.netProfit * share);
    countUpTo(document.getElementById('miTodayEarnings'), todayEarnings, money);
    countUpTo(document.getElementById('miWeekEarnings'), weekEarnings, money);

    const equityValue = Number(me.equityValue) || 0;
    const annualizedYield = equityValue > 0 ? (weekEarnings * 52 / equityValue) * 100 : 0;
    const sign = annualizedYield >= 0 ? '+' : '';
    document.getElementById('miYieldBadge').innerHTML =
        `<i class="fas fa-arrow-trend-${annualizedYield >= 0 ? 'up' : 'down'}"></i> ${sign}${annualizedYield.toFixed(1)}% <span style="color: var(--text-2); font-weight: 400;">annualized</span>`;
}

async function renderRevExpTrendChart() {
    const { from, to, range } = rangeForTrendToggle(trendRange);
    const [revenue, expenses] = await Promise.all([
        apiGet(`/api/investor/revenue-trend?from=${from}&to=${to}&range=${range}`),
        apiGet(`/api/investor/expense-trend?from=${from}&to=${to}&range=${range}`)
    ]);
    const periods = Array.from(new Set([...revenue.map((r) => r.period), ...expenses.map((e) => e.period)])).sort();
    const revenueMap = Object.fromEntries(revenue.map((r) => [r.period, Number(r.revenue)]));
    const expenseMap = Object.fromEntries(expenses.map((e) => [e.period, Number(e.total)]));

    if (typeof Chart === 'undefined') return;
    if (revExpTrendChartInstance) revExpTrendChartInstance.destroy();
    revExpTrendChartInstance = new Chart(document.getElementById('revExpTrendChart'), {
        type: 'line',
        data: {
            labels: periods,
            datasets: [
                {
                    label: 'Revenue',
                    data: periods.map((p) => revenueMap[p] || 0),
                    borderColor: '#10b981',
                    backgroundColor: (c) => { if (!c.chart.chartArea) return 'rgba(16,185,129,0.15)'; const g = c.chart.ctx.createLinearGradient(0, c.chart.chartArea.top, 0, c.chart.chartArea.bottom); g.addColorStop(0, 'rgba(16,185,129,0.38)'); g.addColorStop(1, 'rgba(16,185,129,0)'); return g; },
                    borderWidth: 2.5, pointRadius: 2, fill: true, tension: 0.4
                },
                {
                    label: 'Expense',
                    data: periods.map((p) => expenseMap[p] || 0),
                    borderColor: '#e0685a',
                    backgroundColor: (c) => { if (!c.chart.chartArea) return 'rgba(224,104,90,0.12)'; const g = c.chart.ctx.createLinearGradient(0, c.chart.chartArea.top, 0, c.chart.chartArea.bottom); g.addColorStop(0, 'rgba(224,104,90,0.3)'); g.addColorStop(1, 'rgba(224,104,90,0)'); return g; },
                    borderWidth: 2, pointRadius: 2, fill: true, tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(233,207,154,0.08)' }, ticks: { maxTicksLimit: 5 } } }
        }
    });
}

async function renderIncomeStreamsChart() {
    const data = await apiGet('/api/investor/income-breakdown');
    const rooms = Number(data.roomBookings) || 0;
    const amenities = Number(data.amenities) || 0;
    const events = Number(data.eventRentals) || 0;
    const total = rooms + amenities + events;
    const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);
    const streams = [
        { label: 'Room Bookings', icon: 'fa-bed', value: pct(rooms), color: 'var(--gold)' },
        { label: 'Bonfire/BBQ', icon: 'fa-fire', value: pct(amenities), color: 'var(--bronze)' },
        { label: 'Events', icon: 'fa-champagne-glasses', value: pct(events), color: 'var(--emerald)' }
    ];
    document.getElementById('incomeStreamsRings').innerHTML = streams.map((s) => `
        <div class="income-ring-item">
            <i class="fas ${s.icon}"></i>
            <div class="ring-wrap" style="background: conic-gradient(${s.color} ${s.value * 3.6}deg, rgba(255,255,255,0.08) 0deg);">
                <div class="ring-center"><strong style="font-size: 0.9rem;">${s.value}%</strong></div>
            </div>
            <p>${s.label}</p>
        </div>
    `).join('');
}

async function renderValuationGaugeAndSimulator() {
    const [valuation, summary90] = await Promise.all([
        apiGet('/api/investor-accounts/valuation'),
        apiGet(`/api/investor/summary?from=${ninetyDaysAgo()}&to=${todayStr()}`)
    ]);
    const amount = valuation.current ? valuation.current.amount : 0;
    roiBaseline.valuation = amount;
    roiBaseline.monthlyNetIncome = summary90.netProfit / 3;

    countUpTo(document.getElementById('miValuationBig'), amount, money);
    const raisedPct = amount > 0 ? Math.min(100, (valuation.totalCapitalRaised / amount) * 100) : 0;
    document.getElementById('valuationRing').style.background =
        `conic-gradient(var(--gold) ${raisedPct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;

    updateSimulator();
}

function updateSimulator() {
    const amount = Number(document.getElementById('simAmount').value || 0);
    const ownership = roiBaseline.valuation > 0 ? (amount / roiBaseline.valuation) * 100 : 0;
    const monthly = Math.max(0, roiBaseline.monthlyNetIncome * (ownership / 100));
    countUpTo(document.getElementById('simOwnership'), ownership, (v) => `${v.toFixed(2)}%`, 350);
    countUpTo(document.getElementById('simMonthly'), monthly, money, 350);
}
document.getElementById('simAmount').addEventListener('input', updateSimulator);

async function renderProjectsPreview() {
    const projects = await apiGet('/api/investor-accounts/projects');
    const el = document.getElementById('projectSpotlight');
    if (!projects.length) {
        el.innerHTML = '<p style="color: var(--text-2); font-size: 0.85rem;">No upcoming projects listed yet.</p>';
        return;
    }
    const p = projects[0];
    const img = p.images && p.images[0];
    const roiMatch = String(p.growthPotential || '').match(/(\d+(\.\d+)?)/);
    const roiPct = roiMatch ? Math.min(100, Number(roiMatch[1])) : 0;
    el.innerHTML = `
        <h4 style="font-size: 0.85rem; color: var(--gold-light); margin-bottom: 10px; font-family: 'Playfair Display', serif;"><i class="fas fa-rocket"></i> ${escapeHtml(p.name)}</h4>
        <div class="project-spotlight-media"${img ? ` style="background-image: url('${escapeHtml(img)}'); background-size: cover; background-position: center;"` : ''}>
            ${img ? '' : '<i class="fas fa-hotel"></i>'}
        </div>
        <p style="color: var(--text-2); font-size: 0.8rem;">${money(p.targetCapital)} needed &middot; ${escapeHtml(p.timeline || 'TBD')}</p>
        <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-top: 10px;">
            <span style="color: var(--text-2);">Target ROI</span><strong class="emerald">${escapeHtml(p.growthPotential || 'N/A')}</strong>
        </div>
        <div class="roi-mini-bar"><div class="roi-mini-bar-fill" style="width: ${roiPct}%;"></div></div>
    `;
}
document.getElementById('viewAllProjectsBtn').addEventListener('click', () => {
    document.querySelector('.admin-tab[data-tab="projects"]').click();
});

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

    countUpTo(document.getElementById('roiOwnership'), ownership, (v) => `${v.toFixed(2)}%`, 350);
    countUpTo(document.getElementById('roiMonthly'), monthlyDividend, money, 350);
    countUpTo(document.getElementById('roiAnnual'), annualRoi, (v) => `${v.toFixed(1)}%`, 350);
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
