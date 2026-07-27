const path = require('path');
const express = require('express');
const { init } = require('./db');

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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Horizon Inn server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
