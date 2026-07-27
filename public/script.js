// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
navToggle.addEventListener('click', () => navMenu.classList.toggle('active'));
navMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => navMenu.classList.remove('active'));
});

// Navbar background on scroll
const navbar = document.querySelector('.navbar');
if (navbar) {
    const toggleNavbarBg = () => navbar.classList.toggle('scrolled', window.scrollY > 40);
    toggleNavbarBg();
    window.addEventListener('scroll', toggleNavbarBg, { passive: true });
}

// Fade-in sections as they scroll into view
const revealTargets = document.querySelectorAll('.reveal');
if (revealTargets.length) {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });
    revealTargets.forEach((el) => revealObserver.observe(el));
}

// Highlight the nav link for whichever section is in view
const navLinks = Array.from(document.querySelectorAll('.nav-menu a[href^="#"]'));
const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

if (sections.length) {
    const setActiveLink = (id) => {
        navLinks.forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
    };

    const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveLink(visible.target.id);
    }, { threshold: 0.4, rootMargin: '-80px 0px -40% 0px' });

    sections.forEach((section) => sectionObserver.observe(section));
}

const roomsGrid = document.getElementById('roomsGrid');
const roomSelect = document.getElementById('roomId');
const checkinInput = document.getElementById('checkin');
const checkoutInput = document.getElementById('checkout');

let currentRooms = [];

function money(n) {
    const num = Math.round(Number(n || 0));
    return `Rs. ${num.toLocaleString('en-US')}`;
}

const AMENITY_ICONS = [
    { match: /breakfast/i, icon: 'fa-mug-hot' },
    { match: /\bac\b|air.?con/i, icon: 'fa-snowflake' },
    { match: /wi-?fi|internet/i, icon: 'fa-wifi' },
    { match: /\btv\b|led/i, icon: 'fa-tv' },
    { match: /laundry/i, icon: 'fa-shirt' },
    { match: /mattress/i, icon: 'fa-bed' },
    { match: /parking/i, icon: 'fa-square-parking' },
    { match: /view/i, icon: 'fa-mountain-sun' },
    { match: /bathroom|jacuzzi|sauna/i, icon: 'fa-bath' },
    { match: /butler|concierge/i, icon: 'fa-concierge-bell' }
];

function iconFor(feature) {
    const found = AMENITY_ICONS.find((a) => a.match.test(feature));
    return found ? found.icon : 'fa-circle-check';
}

function galleryHtml(room) {
    const images = room.images && room.images.length ? room.images : null;
    if (!images) {
        return `<div class="room-image" style="background: ${room.gradient};"></div>`;
    }
    if (images.length === 1) {
        return `<div class="room-image" style="background: url('/images/${images[0]}') center/cover no-repeat;"></div>`;
    }
    const slides = images.map((img, i) => `<div class="gallery-slide ${i === 0 ? 'active' : ''}" style="background-image: url('/images/${img}')"></div>`).join('');
    const dots = images.map((_, i) => `<button type="button" class="gallery-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Photo ${i + 1}"></button>`).join('');
    return `
        <div class="room-image room-gallery" data-count="${images.length}">
            ${slides}
            <button type="button" class="gallery-arrow prev" aria-label="Previous photo"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="gallery-arrow next" aria-label="Next photo"><i class="fas fa-chevron-right"></i></button>
            <div class="gallery-dots">${dots}</div>
        </div>
    `;
}

function pricingTiersHtml(room, mattressNote) {
    const tiers = [
        { label: '1 Guest', price: room.price_1p },
        { label: '2 Guests', price: room.price },
        { label: '3 Guests', price: room.price_3p }
    ].filter((t) => t.price !== null && t.price !== undefined);

    if (tiers.length <= 1) {
        return `
            <div class="room-pricing">
                <span class="price">${money(room.price)}</span>
                <span class="per-night">per night</span>
            </div>
        `;
    }

    return `
        <div class="room-pricing">
            <p class="pricing-label">Nightly rate by occupancy</p>
            <div class="pricing-tiers">
                ${tiers.map((t) => `
                    <div class="pricing-tier${t.label === '2 Guests' ? ' tier-highlight' : ''}">
                        <span class="tier-label">${t.label}</span>
                        <span class="tier-price">${money(t.price)}</span>
                    </div>
                `).join('')}
            </div>
            ${mattressNote ? '<p class="mattress-note"><i class="fas fa-bed"></i> Extra mattress available for additional guests</p>' : ''}
        </div>
    `;
}

function roomCardHtml(room, index) {
    const mattressFeature = room.features.find((f) => /extra mattress/i.test(f));
    const mainFeatures = room.features.filter((f) => f !== mattressFeature);
    const featuresHtml = mainFeatures.map((f) => `<li><i class="fas ${iconFor(f)}"></i> ${f}</li>`).join('');
    const availabilityHtml = typeof room.available === 'boolean'
        ? `<span class="availability-badge ${room.available ? 'available' : 'unavailable'}">${room.available ? 'Available' : 'Fully booked'}</span>`
        : '';

    return `
        <div class="room-card fade-in-up ${room.featured ? 'featured' : ''}" style="animation-delay: ${index * 0.12}s">
            ${room.featured ? '<div class="featured-badge">Popular</div>' : ''}
            ${galleryHtml(room)}
            <div class="room-content">
                <h3>${room.name}</h3>
                <p class="room-desc">${room.description}</p>
                ${availabilityHtml}
                <ul class="room-features">${featuresHtml}</ul>
                ${pricingTiersHtml(room, mattressFeature)}
                <a href="#booking" class="book-btn ${room.featured ? 'primary' : ''}" data-room-id="${room.id}">Book Now</a>
            </div>
        </div>
    `;
}

function initGallerySliders() {
    roomsGrid.querySelectorAll('.room-gallery').forEach((gallery) => {
        const slides = gallery.querySelectorAll('.gallery-slide');
        const dots = gallery.querySelectorAll('.gallery-dot');
        let current = 0;

        const show = (i) => {
            current = (i + slides.length) % slides.length;
            slides.forEach((s, idx) => s.classList.toggle('active', idx === current));
            dots.forEach((d, idx) => d.classList.toggle('active', idx === current));
        };

        gallery.querySelector('.gallery-arrow.prev').addEventListener('click', (e) => {
            e.preventDefault();
            show(current - 1);
        });
        gallery.querySelector('.gallery-arrow.next').addEventListener('click', (e) => {
            e.preventDefault();
            show(current + 1);
        });
        dots.forEach((dot) => {
            dot.addEventListener('click', (e) => {
                e.preventDefault();
                show(Number(dot.dataset.index));
            });
        });
    });
}

function renderRooms(rooms) {
    roomsGrid.innerHTML = rooms.map(roomCardHtml).join('');
    roomsGrid.querySelectorAll('.book-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            roomSelect.value = btn.dataset.roomId;
        });
    });
    initGallerySliders();
}

function renderRoomOptions(rooms) {
    roomSelect.innerHTML = '<option value="">Select a room</option>' +
        rooms.map((room) => `<option value="${room.id}">${room.name} - ${money(room.price)}/night</option>`).join('');
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
const paymentMethodSelect = document.getElementById('paymentMethod');
const transactionIdGroup = document.getElementById('transactionIdGroup');
const transactionIdInput = document.getElementById('transactionId');
const paymentInstructions = document.getElementById('paymentInstructions');

const PAYMENT_INSTRUCTIONS = {
    bank_transfer: 'Bank: [Add your bank name] &middot; Account Title: Horizon Inn &middot; Account Number: [Add your account number] &middot; Please transfer the total amount and enter the transaction/reference ID below.',
    easypaisa: 'EasyPaisa Account: [Add your EasyPaisa number] &middot; Please send the total amount and enter the transaction ID below.',
    jazzcash: 'JazzCash Account: [Add your JazzCash number] &middot; Please send the total amount and enter the transaction ID below.'
};

function updatePaymentMethodUI() {
    const method = paymentMethodSelect.value;
    const needsTransaction = method !== 'pay_at_property';

    transactionIdGroup.style.display = needsTransaction ? 'flex' : 'none';
    transactionIdInput.required = needsTransaction;
    if (!needsTransaction) transactionIdInput.value = '';

    if (needsTransaction && PAYMENT_INSTRUCTIONS[method]) {
        paymentInstructions.innerHTML = PAYMENT_INSTRUCTIONS[method];
        paymentInstructions.style.display = 'block';
    } else {
        paymentInstructions.style.display = 'none';
    }
}

paymentMethodSelect.addEventListener('change', updatePaymentMethodUI);
updatePaymentMethodUI();

bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookingMessage.textContent = '';
    bookingMessage.className = 'form-message';

    const payload = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        cnic: document.getElementById('cnic').value,
        maritalStatus: document.getElementById('maritalStatus').value,
        address: document.getElementById('address').value,
        roomId: Number(roomSelect.value),
        checkin: checkinInput.value,
        checkout: checkoutInput.value,
        guests: Number(document.getElementById('guests').value),
        purposeOfStay: document.getElementById('purposeOfStay').value,
        arrivalTime: document.getElementById('arrivalTime').value,
        vehicleNumber: document.getElementById('vehicleNumber').value,
        arrivalFrom: document.getElementById('arrivalFrom').value,
        departureTo: document.getElementById('departureTo').value,
        paymentMethod: paymentMethodSelect.value,
        transactionId: transactionIdInput.value,
        specialRequests: document.getElementById('special').value,
        termsAccepted: document.getElementById('termsAccepted').checked
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
            bookingMessage.textContent = `Booking request received! Confirmation #${data.booking.id} — status: Pending review. We'll confirm shortly by email at ${data.booking.email}.`;
            bookingMessage.classList.add('success');
            bookingForm.reset();
            updatePaymentMethodUI();
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
