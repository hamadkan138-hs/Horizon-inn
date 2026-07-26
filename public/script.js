// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
navToggle.addEventListener('click', () => navMenu.classList.toggle('active'));
navMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => navMenu.classList.remove('active'));
});

const roomsGrid = document.getElementById('roomsGrid');
const roomSelect = document.getElementById('roomId');
const checkinInput = document.getElementById('checkin');
const checkoutInput = document.getElementById('checkout');

let currentRooms = [];

function roomCardHtml(room) {
    const featuresHtml = room.features.map((f) => `<li><i class="fas fa-check"></i> ${f}</li>`).join('');
    const availabilityHtml = typeof room.available === 'boolean'
        ? `<span class="availability-badge ${room.available ? 'available' : 'unavailable'}">${room.available ? 'Available' : 'Fully booked'}</span>`
        : '';

    return `
        <div class="room-card ${room.featured ? 'featured' : ''}">
            ${room.featured ? '<div class="featured-badge">Popular</div>' : ''}
            <div class="room-image" style="background: ${room.gradient};"></div>
            <div class="room-content">
                <h3>${room.name}</h3>
                <p class="room-desc">${room.description}</p>
                ${availabilityHtml}
                <ul class="room-features">${featuresHtml}</ul>
                <div class="room-pricing">
                    <span class="price">$${room.price}</span>
                    <span class="per-night">per night</span>
                </div>
                <a href="#booking" class="book-btn ${room.featured ? 'primary' : ''}" data-room-id="${room.id}">Book Now</a>
            </div>
        </div>
    `;
}

function renderRooms(rooms) {
    roomsGrid.innerHTML = rooms.map(roomCardHtml).join('');
    roomsGrid.querySelectorAll('.book-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            roomSelect.value = btn.dataset.roomId;
        });
    });
}

function renderRoomOptions(rooms) {
    roomSelect.innerHTML = '<option value="">Select a room</option>' +
        rooms.map((room) => `<option value="${room.id}">${room.name} - $${room.price}/night</option>`).join('');
}

async function loadRooms() {
    try {
        const params = new URLSearchParams();
        if (checkinInput.value) params.set('checkin', checkinInput.value);
        if (checkoutInput.value) params.set('checkout', checkoutInput.value);

        const res = await fetch(`/api/rooms?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load rooms');
        currentRooms = await res.json();
        renderRooms(currentRooms);
        renderRoomOptions(currentRooms);
    } catch (err) {
        roomsGrid.innerHTML = '<p class="error-text">Could not load rooms right now. Please refresh the page.</p>';
    }
}

checkinInput.addEventListener('change', loadRooms);
checkoutInput.addEventListener('change', loadRooms);
loadRooms();

// Booking form
const bookingForm = document.getElementById('bookingForm');
const bookingMessage = document.getElementById('bookingMessage');

bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookingMessage.textContent = '';
    bookingMessage.className = 'form-message';

    const payload = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        roomId: Number(roomSelect.value),
        checkin: checkinInput.value,
        checkout: checkoutInput.value,
        guests: Number(document.getElementById('guests').value),
        specialRequests: document.getElementById('special').value
    };

    const submitBtn = bookingForm.querySelector('.submit-btn');
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
            bookingMessage.textContent = data.error || 'Something went wrong. Please try again.';
            bookingMessage.classList.add('error');
        } else {
            bookingMessage.textContent = `Booking confirmed! Confirmation #${data.booking.id} — we'll email you at ${data.booking.email}.`;
            bookingMessage.classList.add('success');
            bookingForm.reset();
            loadRooms();
        }
    } catch (err) {
        bookingMessage.textContent = 'Network error. Please check your connection and try again.';
        bookingMessage.classList.add('error');
    } finally {
        submitBtn.disabled = false;
    }
});

// Contact form
const contactForm = document.getElementById('contactForm');
const contactFormMessage = document.getElementById('contactFormMessage');

contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    contactFormMessage.textContent = '';
    contactFormMessage.className = 'form-message';

    const payload = {
        name: document.getElementById('contactName').value,
        email: document.getElementById('contactEmail').value,
        message: document.getElementById('contactMessage').value
    };

    const submitBtn = contactForm.querySelector('.submit-btn');
    submitBtn.disabled = true;

    try {
        const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok) {
            contactFormMessage.textContent = data.error || 'Something went wrong. Please try again.';
            contactFormMessage.classList.add('error');
        } else {
            contactFormMessage.textContent = 'Message sent! We will get back to you soon.';
            contactFormMessage.classList.add('success');
            contactForm.reset();
        }
    } catch (err) {
        contactFormMessage.textContent = 'Network error. Please check your connection and try again.';
        contactFormMessage.classList.add('error');
    } finally {
        submitBtn.disabled = false;
    }
});
