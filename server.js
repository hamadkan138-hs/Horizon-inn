const path = require('path');
const express = require('express');
const cron = require('node-cron');
const { init } = require('./db');
const { sendDailySummaryEmail } = require('./lib/mailer');

const roomsRouter = require('./routes/rooms');
const bookingsRouter = require('./routes/bookings');
const contactRouter = require('./routes/contact');
const rateRulesRouter = require('./routes/rateRules');
const expensesRouter = require('./routes/expenses');
const guestsRouter = require('./routes/guests');
const reportsRouter = require('./routes/reports');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const publicInvoiceRouter = require('./routes/publicInvoice');
const settingsRouter = require('./routes/settings');
const mediaRouter = require('./routes/media');
const investorRouter = require('./routes/investor');
const handoversRouter = require('./routes/handovers');
const physicalRoomsRouter = require('./routes/physicalRooms');
const investorAccountsRouter = require('./routes/investorAccounts');
const venuesRouter = require('./routes/venues');
const investorLeadsRouter = require('./routes/investorLeads');
const reviewsRouter = require('./routes/reviews');
const statsRouter = require('./routes/stats');
const promoCodesRouter = require('./routes/promoCodes');
const giftVouchersRouter = require('./routes/giftVouchers');
const corporateAccountsRouter = require('./routes/corporateAccounts');
const abandonedBookingsRouter = require('./routes/abandonedBookings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/contact', contactRouter);
app.use('/api/rate-rules', rateRulesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api/public-invoice', publicInvoiceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/investor', investorRouter);
app.use('/api/handovers', handoversRouter);
app.use('/api/physical-rooms', physicalRoomsRouter);
app.use('/api/investor-accounts', investorAccountsRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/investor-leads', investorLeadsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/promo-codes', promoCodesRouter);
app.use('/api/gift-vouchers', giftVouchersRouter);
app.use('/api/corporate-accounts', corporateAccountsRouter);
app.use('/api/abandoned-bookings', abandonedBookingsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Horizon Inn server running on port ${PORT}`);
    });

    // Automated daily summary email — only runs if EMAIL_USER and
    // EMAIL_APP_PASSWORD are configured (see README for setup). Scheduled
    // in Pakistan time directly so it doesn't drift with the server's own
    // timezone or need UTC conversion.
    if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
      cron.schedule('0 8 * * *', () => {
        sendDailySummaryEmail().catch((err) => console.error('Daily summary email failed:', err));
      }, { timezone: 'Asia/Karachi' });
      console.log('Daily summary email scheduled for 8:00 AM PKT.');
    } else {
      console.log('Daily summary email disabled — set EMAIL_USER and EMAIL_APP_PASSWORD to enable it.');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
