const path = require('path');
const express = require('express');

const roomsRouter = require('./routes/rooms');
const bookingsRouter = require('./routes/bookings');
const contactRouter = require('./routes/contact');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/contact', contactRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Horizon Inn server running on port ${PORT}`);
});
