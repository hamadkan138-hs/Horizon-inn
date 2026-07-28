const nodemailer = require('nodemailer');
const { getDailySummary } = require('./dailySummary');

function money(n) {
  const num = Math.round(Number(n || 0));
  return num < 0 ? `-Rs. ${Math.abs(num).toLocaleString('en-US')}` : `Rs. ${num.toLocaleString('en-US')}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Gmail SMTP via an App Password (not the account's real password — Gmail
// requires 2-Step Verification to be on before it will issue one). Reads
// from environment variables only, so no credential ever lives in the
// codebase or git history. Returns null (feature quietly disabled) if
// they're not set, rather than crashing the server.
function getTransporter() {
  const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD }
  });
}

function statTile(label, value) {
  return `
    <td style="padding:14px 18px; background:#f8f7f3; border-radius:6px;">
      <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#6f7180;">${label}</div>
      <div style="font-size:20px; font-weight:700; color:#14161f; margin-top:4px;">${value}</div>
    </td>
    <td style="width:10px;"></td>
  `;
}

function bookingRowsHtml(rows, emptyLabel) {
  if (!rows.length) {
    return `<tr><td colspan="3" style="padding:10px; color:#6f7180; font-style:italic;">${emptyLabel}</td></tr>`;
  }
  return rows.map((b) => `
    <tr>
      <td style="padding:8px 10px; border-bottom:1px solid #ece8de;">${escapeHtml(b.name)}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #ece8de;">${escapeHtml(b.room_name)}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #ece8de; text-align:right;">${money(b.balance)} due</td>
    </tr>
  `).join('');
}

function renderSummaryHtml(summary) {
  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width:600px; margin:0 auto; color:#23242c;">
    <h2 style="color:#14161f; border-bottom:2px solid #c6a15b; padding-bottom:10px; margin-bottom:4px;">Horizon Inn &middot; Daily Summary</h2>
    <p style="color:#6f7180; margin-top:0;">${summary.date}</p>

    <table cellpadding="0" cellspacing="0" style="margin: 18px 0;">
      <tr>
        ${statTile('Check-ins', summary.checkins.length)}
        ${statTile('Check-outs', summary.checkouts.length)}
        ${statTile('Cash Received', money(summary.cashReceivedToday))}
        ${statTile('Outstanding', money(summary.outstandingTotal))}
      </tr>
    </table>

    <h3 style="color:#14161f; font-size:15px; margin-bottom:6px;">Today's Check-ins</h3>
    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
      ${bookingRowsHtml(summary.checkins, 'No check-ins scheduled today.')}
    </table>

    <h3 style="color:#14161f; font-size:15px; margin-bottom:6px;">Today's Check-outs</h3>
    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:20px;">
      ${bookingRowsHtml(summary.checkouts, 'No check-outs scheduled today.')}
    </table>

    ${summary.outstandingBookings.length ? `
      <h3 style="color:#14161f; font-size:15px; margin-bottom:6px;">Outstanding Balances (all active stays)</h3>
      <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; font-size:14px;">
        ${bookingRowsHtml(summary.outstandingBookings, '')}
      </table>
    ` : ''}

    <p style="color:#6f7180; font-size:12px; margin-top:28px; border-top:1px solid #ece8de; padding-top:12px;">
      Automated daily summary from your Horizon Inn admin dashboard. Log in for full details.
    </p>
  </div>
  `;
}

function renderSummaryText(summary) {
  const lines = [
    `Horizon Inn — Daily Summary (${summary.date})`,
    '',
    `Check-ins: ${summary.checkins.length}`,
    `Check-outs: ${summary.checkouts.length}`,
    `Cash received today: ${money(summary.cashReceivedToday)}`,
    `Outstanding balance (all active stays): ${money(summary.outstandingTotal)}`,
    '',
    'Today\'s check-ins:',
    ...(summary.checkins.length
      ? summary.checkins.map((b) => `  - ${b.name} (${b.room_name}) — ${money(b.balance)} due`)
      : ['  (none)']),
    '',
    'Today\'s check-outs:',
    ...(summary.checkouts.length
      ? summary.checkouts.map((b) => `  - ${b.name} (${b.room_name}) — ${money(b.balance)} due`)
      : ['  (none)'])
  ];
  return lines.join('\n');
}

const SITE_URL = process.env.SITE_URL || 'https://horizon-inn.onrender.com';

function renderBookingConfirmationHtml(booking, room) {
  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; max-width:600px; margin:0 auto; color:#23242c;">
    <h2 style="color:#14161f; border-bottom:2px solid #c6a15b; padding-bottom:10px; margin-bottom:4px;">Booking Confirmed &mdash; Horizon Inn</h2>
    <p>Dear ${escapeHtml(booking.name)},</p>
    <p>Thank you for booking with us. Here are your stay details:</p>

    <table cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; font-size:14px; margin:16px 0;">
      <tr><td style="padding:6px 0; color:#6f7180;">Invoice Number</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeHtml(booking.invoice_number)}</td></tr>
      <tr><td style="padding:6px 0; color:#6f7180;">Room</td><td style="padding:6px 0; text-align:right;">${escapeHtml(room.name)}</td></tr>
      <tr><td style="padding:6px 0; color:#6f7180;">Check-in</td><td style="padding:6px 0; text-align:right;">${escapeHtml(booking.checkin)}</td></tr>
      <tr><td style="padding:6px 0; color:#6f7180;">Check-out</td><td style="padding:6px 0; text-align:right;">${escapeHtml(booking.checkout)}</td></tr>
      <tr><td style="padding:6px 0; color:#6f7180;">Guests</td><td style="padding:6px 0; text-align:right;">${escapeHtml(booking.guests)}</td></tr>
      <tr><td style="padding:10px 0 6px; color:#6f7180; border-top:1px solid #ece8de;">Total Amount</td><td style="padding:10px 0 6px; text-align:right; font-weight:700; border-top:1px solid #ece8de;">${money(booking.total_amount)}</td></tr>
      <tr><td style="padding:6px 0; color:#6f7180;">Payment Status</td><td style="padding:6px 0; text-align:right; text-transform:capitalize;">${escapeHtml(booking.payment_status)}</td></tr>
    </table>

    <p style="font-size:14px;">
      To manage or check on your booking anytime, visit
      <a href="${SITE_URL}/manage-booking.html" style="color:#8a6d3b;">${SITE_URL}/manage-booking.html</a>
      and look it up with your invoice number and phone number.
    </p>

    <div style="background:#f8f7f3; border-radius:6px; padding:16px 20px; margin:20px 0;">
      <p style="margin:0 0 6px; font-size:14px;"><strong>Share &amp; earn:</strong> give friends your referral code and they'll get 10% off &mdash; you'll get a Rs. 1,000 gift voucher when they book.</p>
      <div style="font-size:18px; font-weight:700; letter-spacing:0.08em; color:#14161f;">${escapeHtml(booking.referral_code)}</div>
    </div>

    <p style="color:#6f7180; font-size:12px; margin-top:28px; border-top:1px solid #ece8de; padding-top:12px;">
      We look forward to hosting you. If anything above looks incorrect, please contact us as soon as possible.
    </p>
  </div>
  `;
}

function renderBookingConfirmationText(booking, room) {
  return [
    `Booking Confirmed — Horizon Inn`,
    '',
    `Dear ${booking.name},`,
    'Thank you for booking with us. Here are your stay details:',
    '',
    `Invoice Number: ${booking.invoice_number}`,
    `Room: ${room.name}`,
    `Check-in: ${booking.checkin}`,
    `Check-out: ${booking.checkout}`,
    `Guests: ${booking.guests}`,
    `Total Amount: ${money(booking.total_amount)}`,
    `Payment Status: ${booking.payment_status}`,
    '',
    `Manage your booking: ${SITE_URL}/manage-booking.html (use your invoice number + phone number)`,
    '',
    `Share & earn: give friends your referral code "${booking.referral_code}" for 10% off — you get a Rs. 1,000 voucher when they book.`
  ].join('\n');
}

async function sendBookingConfirmationEmail(booking, room) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[bookingConfirmationEmail] Skipped — EMAIL_USER / EMAIL_APP_PASSWORD are not configured.');
    return { sent: false, reason: 'Email is not configured on this server.' };
  }
  if (!booking.email) return { sent: false, reason: 'No guest email on file' };

  await transporter.sendMail({
    from: `"Horizon Inn" <${process.env.EMAIL_USER}>`,
    to: booking.email,
    subject: `Your Horizon Inn Booking Confirmation — ${booking.invoice_number}`,
    html: renderBookingConfirmationHtml(booking, room),
    text: renderBookingConfirmationText(booking, room)
  });

  return { sent: true };
}

async function sendDailySummaryEmail(dateOverride) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[dailySummaryEmail] Skipped — EMAIL_USER / EMAIL_APP_PASSWORD are not configured.');
    return { sent: false, reason: 'Email is not configured on this server (set EMAIL_USER and EMAIL_APP_PASSWORD).' };
  }

  const summary = await getDailySummary(dateOverride);
  const to = process.env.EMAIL_TO || process.env.EMAIL_USER;

  await transporter.sendMail({
    from: `"Horizon Inn" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Horizon Inn Daily Summary — ${summary.date}`,
    html: renderSummaryHtml(summary),
    text: renderSummaryText(summary)
  });

  return { sent: true };
}

module.exports = { sendDailySummaryEmail, sendBookingConfirmationEmail };
