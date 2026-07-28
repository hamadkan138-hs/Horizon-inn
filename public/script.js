// Site content — hero copy, contact details, policies and the offers banner all
// come from the admin-editable settings API instead of being hardcoded here.
async function loadSiteSettings() {
    try {
        const settings = await fetch('/api/settings').then((r) => r.json());

        if (settings.hero_eyebrow) document.getElementById('heroEyebrow').textContent = settings.hero_eyebrow;
        if (settings.hero_heading) document.getElementById('heroHeading').textContent = settings.hero_heading;
        if (settings.hero_subtext) document.getElementById('heroSubtext').textContent = settings.hero_subtext;

        if (settings.offers_enabled === '1' && settings.offers_text) {
            document.getElementById('offersBannerText').textContent = settings.offers_text;
            document.getElementById('offersBanner').style.display = 'flex';
            document.body.classList.add('has-offer');
        }

        if (settings.contact_address) document.getElementById('contactAddress').innerHTML = settings.contact_address.replace(/\n/g, '<br>');
        if (settings.contact_phone) document.getElementById('contactPhone').textContent = settings.contact_phone;
        if (settings.contact_email) document.getElementById('contactEmailDisplay').textContent = settings.contact_email;
        if (settings.contact_hours) document.getElementById('contactHours').textContent = settings.contact_hours;
        if (settings.contact_map_embed) document.getElementById('contactMapEmbed').src = settings.contact_map_embed;
        if (settings.contact_map_link) {
            const mapLink = document.getElementById('contactMapLink');
            mapLink.href = settings.contact_map_link;
            mapLink.style.display = 'inline-flex';
        }
        if (settings.contact_facebook) {
            document.getElementById('contactFacebookLink').href = settings.contact_facebook;
            document.getElementById('contactFacebookItem').style.display = 'flex';
        }

        PAYMENT_INSTRUCTIONS = buildPaymentInstructions(settings);
        updatePaymentMethodUI();

        if (settings.policies_text) {
            const termsBox = document.getElementById('termsBox');
            termsBox.innerHTML = settings.policies_text.split(/\n\s*\n/).map((para) => {
                const colonIndex = para.indexOf(':');
                if (colonIndex === -1) return `<p>${para}</p>`;
                const label = para.slice(0, colonIndex + 1);
                const rest = para.slice(colonIndex + 1);
                return `<p><strong>${label}</strong>${rest}</p>`;
            }).join('');
        }
    } catch (err) { /* fall back to the static markup already in the page */ }
}
loadSiteSettings();

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

function initGallerySliders(container) {
    (container || roomsGrid).querySelectorAll('.room-gallery').forEach((gallery) => {
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

// Upcoming expansion projects — public read-only teaser so prospective
// investors browsing the main site can see what's coming without logging in.
const projectsGrid = document.getElementById('projectsGrid');
const PROJECT_STATUS_LABELS = { planned: 'Planned', in_progress: 'Under Construction', completed: 'Completed' };

function projectGalleryHtml(project) {
    const images = Array.isArray(project.images) ? project.images.filter(Boolean) : [];
    if (!images.length) {
        return '<div class="room-image" style="background: linear-gradient(135deg, #2c2620, #6b5a3a);"></div>';
    }
    if (images.length === 1) {
        return `<div class="room-image" style="background: url('${images[0]}') center/cover no-repeat;"></div>`;
    }
    const slides = images.map((img, i) => `<div class="gallery-slide ${i === 0 ? 'active' : ''}" style="background-image: url('${img}')"></div>`).join('');
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

function projectCardHtml(project, index) {
    const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
    const metaItems = [
        project.location ? `<li><i class="fas fa-map-marker-alt"></i> ${project.location}</li>` : '',
        (project.timeline && project.timeline !== 'TBD') ? `<li><i class="fas fa-calendar"></i> Target: ${project.timeline}</li>` : ''
    ].filter(Boolean).join('');

    return `
        <div class="room-card fade-in-up" style="animation-delay: ${index * 0.12}s">
            <div class="featured-badge">${statusLabel}</div>
            ${projectGalleryHtml(project)}
            <div class="room-content">
                <h3>${project.name}</h3>
                <p class="room-desc">${project.description}</p>
                ${metaItems ? `<ul class="room-features">${metaItems}</ul>` : ''}
                <a href="#contact" class="book-btn primary">Interested in Investing?</a>
            </div>
        </div>
    `;
}

function renderProjects(projects) {
    const section = projectsGrid.closest('section');
    if (!projects.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    projectsGrid.innerHTML = projects.map(projectCardHtml).join('');
    initGallerySliders(projectsGrid);
}

async function loadProjects() {
    try {
        const res = await fetch('/api/investor-accounts/public/projects');
        if (!res.ok) throw new Error('Failed to load projects');
        const projects = await res.json();
        renderProjects(projects);
    } catch (err) {
        projectsGrid.closest('section').style.display = 'none';
    }
}

loadProjects();

// Booking form
const bookingForm = document.getElementById('bookingForm');
const bookingMessage = document.getElementById('bookingMessage');
const paymentMethodSelect = document.getElementById('paymentMethod');
const transactionIdGroup = document.getElementById('transactionIdGroup');
const transactionIdInput = document.getElementById('transactionId');
const paymentInstructions = document.getElementById('paymentInstructions');

const PAYMENT_FOLLOWUP = 'After transferring, please send us a screenshot on WhatsApp along with your booking name and dates, then enter the transaction/reference ID below. An advance payment is required to confirm your booking, and your room is locked once that payment is confirmed.';

function buildPaymentInstructions(settings) {
    const bankLine = [
        settings.payment_bank_name ? `Bank: ${settings.payment_bank_name}` : '',
        settings.payment_bank_title ? `Account Title: ${settings.payment_bank_title}` : '',
        settings.payment_bank_account ? `Account Number: ${settings.payment_bank_account}` : '',
        settings.payment_bank_iban ? `IBAN: ${settings.payment_bank_iban}` : '',
        settings.payment_bank_branch ? `Branch: ${settings.payment_bank_branch}` : ''
    ].filter(Boolean).join(' &middot; ');

    const easypaisaLine = [
        settings.payment_easypaisa_title ? `Account Title: ${settings.payment_easypaisa_title}` : '',
        settings.payment_easypaisa_number ? `Mobile Number: ${settings.payment_easypaisa_number}` : ''
    ].filter(Boolean).join(' &middot; ');

    const jazzcashLine = [
        settings.payment_jazzcash_title ? `Account Title: ${settings.payment_jazzcash_title}` : '',
        settings.payment_jazzcash_number ? `Mobile Number: ${settings.payment_jazzcash_number}` : ''
    ].filter(Boolean).join(' &middot; ');

    const contactFallback = 'Please contact us via WhatsApp or phone to arrange this payment method.';

    return {
        bank_transfer: bankLine ? `${bankLine}<br>${PAYMENT_FOLLOWUP}` : contactFallback,
        easypaisa: easypaisaLine ? `${easypaisaLine}<br>${PAYMENT_FOLLOWUP}` : contactFallback,
        jazzcash: jazzcashLine ? `${jazzcashLine}<br>${PAYMENT_FOLLOWUP}` : contactFallback
    };
}

let PAYMENT_INSTRUCTIONS = {
    bank_transfer: 'Loading payment details&hellip;',
    easypaisa: 'Loading payment details&hellip;',
    jazzcash: 'Loading payment details&hellip;'
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
    document.getElementById('paymentSecurityNote').style.display = needsTransaction ? 'flex' : 'none';
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
