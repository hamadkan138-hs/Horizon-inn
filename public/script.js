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
        if (settings.contact_phone) {
            const digits = settings.contact_phone.replace(/\D/g, '');
            const waNumber = digits.startsWith('92') ? digits : `92${digits.replace(/^0/, '')}`;
            const waBtn = document.getElementById('whatsappFloatBtn');
            waBtn.href = `https://wa.me/${waNumber}?text=${encodeURIComponent('Hi! I have a question about booking a stay at Horizon Inn.')}`;
            waBtn.style.display = 'flex';
        }
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

        const structuredDataEl = document.getElementById('structuredData');
        if (structuredDataEl) {
            structuredDataEl.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'LodgingBusiness',
                name: 'Horizon Inn',
                description: 'Boutique guest house and event complex offering luxury rooms and the Crescent Grove Event & Hospitality Complex.',
                address: settings.contact_address || undefined,
                telephone: settings.contact_phone || undefined,
                email: settings.contact_email || undefined,
                url: 'https://horizon-inn.onrender.com/',
                image: 'https://horizon-inn.onrender.com/images/gallery/courtyard-lounge.jpg',
                priceRange: 'PKR'
            });
        }

        if (settings.ga4_measurement_id) {
            const gaScript = document.createElement('script');
            gaScript.async = true;
            gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${settings.ga4_measurement_id}`;
            document.head.appendChild(gaScript);
            window.dataLayer = window.dataLayer || [];
            function gtag() { window.dataLayer.push(arguments); }
            gtag('js', new Date());
            gtag('config', settings.ga4_measurement_id);
        }

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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
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
    const scarcityHtml = room.available && typeof room.remainingUnits === 'number' && room.remainingUnits <= 2
        ? `<span class="scarcity-badge"><i class="fas fa-triangle-exclamation"></i> Only ${room.remainingUnits} left for these dates</span>`
        : '';

    return `
        <div class="room-card fade-in-up ${room.featured ? 'featured' : ''}" style="animation-delay: ${index * 0.12}s">
            ${room.featured ? '<div class="featured-badge">Popular</div>' : ''}
            ${galleryHtml(room)}
            <div class="room-content">
                <h3>${room.name}</h3>
                <p class="room-desc">${room.description}</p>
                ${availabilityHtml}
                ${scarcityHtml}
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
        termsAccepted: document.getElementById('termsAccepted').checked,
        addons: Array.from(document.querySelectorAll('input[name="addon"]:checked')).map((el) => el.value),
        discountCode: document.getElementById('discountCode').value
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
            const referralNote = data.booking.referral_code
                ? ` Share your referral code <strong>${data.booking.referral_code}</strong> with friends — they get 10% off, and you get a Rs. 1,000 gift voucher when they book.`
                : '';
            bookingMessage.innerHTML = `Booking request received! Confirmation #${data.booking.id} — status: Pending review. We'll confirm shortly by email at ${data.booking.email}.${referralNote}`;
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

/* ==================================================================
   Crescent Grove: Facility Showcase, Become-a-Partner lead capture,
   and the public Investment Yield Calculator.
   ================================================================== */
const CATERING_CATEGORY_LABELS = {
    platters: 'Platters', high_tea: 'High Tea', espresso_bar: 'Espresso Bar', live_bbq: 'Live BBQ'
};

let allFacilities = [];
let allCateringItems = [];
let facilityGalleryState = { images: [], index: 0 };

function facilityCardHtml(f, i) {
    const image = f.images && f.images[0] ? f.images[0] : '';
    return `
        <div class="facility-card" data-id="${f.id}" style="animation-delay: ${i * 0.1}s">
            <div class="facility-media" style="${image ? `background-image: url('${image}');` : ''}">
                ${f.isBuyout ? '<span class="facility-buyout-chip">Full Buyout</span>' : ''}
            </div>
            <div class="facility-body">
                <h3>${escapeHtml(f.name)}</h3>
                <div class="facility-meta">
                    <span><i class="fas fa-ruler-combined"></i>${f.sizeSqft.toLocaleString()} sq ft</span>
                    <span><i class="fas fa-users"></i>Up to ${f.capacity} guests</span>
                </div>
                <p>${escapeHtml(f.description)}</p>
                <div class="facility-rate-row">
                    <div class="facility-rate">${money(f.baseDayRate)}<span>per day</span></div>
                    <button type="button" class="facility-view-btn">View Details</button>
                </div>
            </div>
        </div>
    `;
}

async function loadFacilities() {
    const grid = document.getElementById('facilityGrid');
    if (!grid) return;
    try {
        const [facilities, catering] = await Promise.all([
            fetch('/api/venues/public').then((r) => r.json()),
            fetch('/api/venues/public/catering-menu').then((r) => r.json())
        ]);
        allFacilities = facilities;
        allCateringItems = catering;
        grid.innerHTML = facilities.map(facilityCardHtml).join('');
        grid.querySelectorAll('.facility-card').forEach((card) => {
            card.addEventListener('click', () => openFacilityModal(Number(card.dataset.id)));
        });
    } catch (err) {
        grid.innerHTML = '<p style="color: #9ca3af; text-align: center; grid-column: 1 / -1;">Could not load facilities right now.</p>';
    }
}

function renderFacilityGallery(images) {
    facilityGalleryState = { images: images.length ? images : [''], index: 0 };
    const wrap = document.getElementById('facilityModalGallery');
    if (!images.length) {
        wrap.innerHTML = '<div class="fm-slide active" style="background: linear-gradient(135deg, #14151a, rgba(212,175,55,0.18)); display: flex; align-items: center; justify-content: center; color: #e8c874; font-size: 2rem;"><i class="fas fa-image"></i></div>';
        return;
    }
    wrap.innerHTML = `
        ${images.map((src, i) => `<div class="fm-slide ${i === 0 ? 'active' : ''}" style="background-image: url('${src}')"></div>`).join('')}
        ${images.length > 1 ? `
            <button type="button" class="fm-nav prev"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="fm-nav next"><i class="fas fa-chevron-right"></i></button>
            <div class="fm-dots">${images.map((_, i) => `<span class="${i === 0 ? 'active' : ''}"></span>`).join('')}</div>
        ` : ''}
    `;
    if (images.length > 1) {
        const show = (i) => {
            facilityGalleryState.index = (i + images.length) % images.length;
            wrap.querySelectorAll('.fm-slide').forEach((s, idx) => s.classList.toggle('active', idx === facilityGalleryState.index));
            wrap.querySelectorAll('.fm-dots span').forEach((d, idx) => d.classList.toggle('active', idx === facilityGalleryState.index));
        };
        wrap.querySelector('.fm-nav.prev').addEventListener('click', () => show(facilityGalleryState.index - 1));
        wrap.querySelector('.fm-nav.next').addEventListener('click', () => show(facilityGalleryState.index + 1));
    }
}

function renderCateringTabs() {
    const categories = Array.from(new Set(allCateringItems.map((c) => c.category)));
    const tabsEl = document.getElementById('cateringTabs');
    tabsEl.innerHTML = categories.map((cat, i) => `<button type="button" class="catering-tab ${i === 0 ? 'active' : ''}" data-cat="${cat}">${CATERING_CATEGORY_LABELS[cat] || cat}</button>`).join('');
    const renderList = (cat) => {
        const items = allCateringItems.filter((c) => c.category === cat);
        document.getElementById('cateringItemsList').innerHTML = items.map((c) => `
            <div class="catering-item-row">
                <div><div class="ci-name">${escapeHtml(c.name)}</div><div class="ci-desc">${escapeHtml(c.description)}</div></div>
                <div class="ci-price">${money(c.price)}</div>
            </div>
        `).join('');
    };
    tabsEl.querySelectorAll('.catering-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            tabsEl.querySelectorAll('.catering-tab').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderList(btn.dataset.cat);
        });
    });
    if (categories.length) renderList(categories[0]);
}

function openFacilityModal(id) {
    const f = allFacilities.find((x) => x.id === id);
    if (!f) return;
    document.getElementById('facilityModalName').textContent = f.name;
    document.getElementById('facilityModalSize').textContent = `${f.sizeSqft.toLocaleString()} sq ft`;
    document.getElementById('facilityModalCapacity').textContent = `Up to ${f.capacity} guests`;
    document.getElementById('facilityModalRate').textContent = `${money(f.baseDayRate)}/day`;
    document.getElementById('facilityModalDescription').textContent = f.description;
    document.getElementById('facilityModalAmenities').innerHTML = f.amenities.map((a) => `<span class="amenity-tag">${escapeHtml(a)}</span>`).join('');
    renderFacilityGallery(f.images || []);
    renderCateringTabs();
    document.getElementById('facilityModalOverlay').style.display = 'flex';
}

document.getElementById('facilityModalCloseBtn')?.addEventListener('click', () => {
    document.getElementById('facilityModalOverlay').style.display = 'none';
});
document.getElementById('facilityModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'facilityModalOverlay') e.target.style.display = 'none';
});

/* ---- Become a Partner: multi-step lead capture ---- */
let partnerSelection = { tier: '', type: '' };

function showPartnerStep(step) {
    document.querySelectorAll('.partner-step').forEach((el) => el.classList.toggle('active', el.dataset.step === String(step)));
    const totalSteps = 3;
    document.querySelectorAll('#partnerStepIndicator span').forEach((el, i) => {
        el.classList.toggle('done', step === 'success' || i < Number(step));
    });
}

document.getElementById('openPartnerModalBtn')?.addEventListener('click', () => {
    document.getElementById('partnerModalOverlay').style.display = 'flex';
    showPartnerStep(1);
});
document.getElementById('partnerModalCloseBtn')?.addEventListener('click', () => {
    document.getElementById('partnerModalOverlay').style.display = 'none';
});
document.getElementById('partnerModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'partnerModalOverlay') e.target.style.display = 'none';
});

document.querySelectorAll('#partnerForm [data-next]').forEach((btn) => {
    btn.addEventListener('click', () => showPartnerStep(btn.dataset.next));
});
document.querySelectorAll('#partnerForm [data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showPartnerStep(btn.dataset.back));
});

document.querySelectorAll('#partnerTierOptions .tier-option').forEach((el) => {
    el.addEventListener('click', () => {
        document.querySelectorAll('#partnerTierOptions .tier-option').forEach((o) => o.classList.remove('selected'));
        el.classList.add('selected');
        partnerSelection.tier = el.dataset.value;
    });
});
document.querySelectorAll('#partnerTypeOptions .tier-option').forEach((el) => {
    el.addEventListener('click', () => {
        document.querySelectorAll('#partnerTypeOptions .tier-option').forEach((o) => o.classList.remove('selected'));
        el.classList.add('selected');
        partnerSelection.type = el.dataset.value;
    });
});

document.getElementById('partnerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('partnerFormMessage');
    try {
        const res = await fetch('/api/investor-leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName: document.getElementById('partnerFullName').value,
                phone: document.getElementById('partnerPhone').value,
                email: document.getElementById('partnerEmail').value,
                location: document.getElementById('partnerLocation').value,
                investmentTier: partnerSelection.tier,
                investmentType: partnerSelection.type,
                notes: document.getElementById('partnerNotes').value
            })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Something went wrong');
        showPartnerStep('success');
        document.getElementById('partnerForm').reset();
        partnerSelection = { tier: '', type: '' };
        document.querySelectorAll('.tier-option').forEach((o) => o.classList.remove('selected'));
    } catch (err) {
        msg.style.color = '#e0685a';
        msg.textContent = err.message;
    }
});

/* ---- Public Investment Yield Calculator ---- */
let roiCalcChartInstance = null;
const WORKING_VALUATION = 20000000;

function renderRoiCalculator() {
    const investment = Number(document.getElementById('roiCalcInvestment').value);
    const occupancy = Number(document.getElementById('roiCalcOccupancy').value);
    const rate = Number(document.getElementById('roiCalcRate').value);

    document.getElementById('roiCalcInvestmentLabel').textContent = money(investment);
    document.getElementById('roiCalcOccupancyLabel').textContent = `${occupancy}%`;
    document.getElementById('roiCalcRateLabel').textContent = `${money(rate)}`;

    const grossAnnualRevenue = rate * 365 * (occupancy / 100);
    const marginPct = 25 + ((occupancy - 30) / (90 - 30)) * 15;
    const netProfit = grossAnnualRevenue * (marginPct / 100);
    const ownershipShare = Math.min(investment / WORKING_VALUATION, 1);
    const investorPayoutYear1 = netProfit * ownershipShare;
    const roiPct = investment > 0 ? (investorPayoutYear1 / investment) * 100 : 0;
    const paybackMonths = investorPayoutYear1 > 0 ? (investment / (investorPayoutYear1 / 12)) : Infinity;
    const paybackText = !isFinite(paybackMonths) ? '—'
        : paybackMonths < 24 ? `${Math.round(paybackMonths)} months`
        : `${(paybackMonths / 12).toFixed(1)} years`;

    document.getElementById('roiCalcGrossRevenue').textContent = money(grossAnnualRevenue);
    document.getElementById('roiCalcNetPayout').textContent = money(investorPayoutYear1);
    document.getElementById('roiCalcRoiPct').textContent = `${roiPct.toFixed(1)}%`;
    document.getElementById('roiCalcPayback').textContent = paybackText;

    const year2 = investorPayoutYear1 * 1.08;
    const year3 = year2 * 1.08;
    const cumulativeYear1 = investorPayoutYear1;
    const cumulativeYear3 = investorPayoutYear1 + year2 + year3;

    const canvas = document.getElementById('roiCalcChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (roiCalcChartInstance) roiCalcChartInstance.destroy();
    roiCalcChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: ['Year 1 (cumulative)', 'Year 3 (cumulative)'],
            datasets: [{
                label: 'Investor Payout (Rs.)',
                data: [cumulativeYear1, cumulativeYear3],
                backgroundColor: ['#d4af37', '#10b981'],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.06)' } }
            }
        }
    });
}

['roiCalcInvestment', 'roiCalcOccupancy', 'roiCalcRate'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderRoiCalculator);
});

if (document.getElementById('facilityGrid')) {
    loadFacilities();
    renderRoiCalculator();
}

/* ==================================================================
   Guest Reviews — public display + submission form
   ================================================================== */
const REVIEW_SOURCE_LABELS = { site: 'Horizon Inn', google: 'Google', tripadvisor: 'TripAdvisor' };

function starsHtml(rating) {
    return Array.from({ length: 5 }, (_, i) => `<i class="fas fa-star" style="${i < rating ? '' : 'opacity: 0.25;'}"></i>`).join('');
}

function reviewCardHtml(r) {
    return `
        <div class="review-card">
            <div class="review-stars">${starsHtml(r.rating)}</div>
            ${r.comment ? `<p class="review-comment">&ldquo;${escapeHtml(r.comment)}&rdquo;</p>` : ''}
            <div class="review-meta">
                <strong>${escapeHtml(r.guestName)}</strong>
                <span class="review-source">${REVIEW_SOURCE_LABELS[r.source] || r.source}</span>
            </div>
        </div>
    `;
}

async function loadReviews() {
    const grid = document.getElementById('reviewGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/reviews/public');
        if (!res.ok) throw new Error('Failed to load reviews');
        const reviews = await res.json();
        grid.innerHTML = reviews.length
            ? reviews.map(reviewCardHtml).join('')
            : '<p style="text-align: center; grid-column: 1 / -1; color: var(--text-light);">No reviews yet — be the first to share your stay.</p>';
    } catch (err) {
        grid.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; color: var(--text-light);">Could not load reviews right now.</p>';
    }
}

document.getElementById('openReviewFormBtn')?.addEventListener('click', () => {
    const form = document.getElementById('reviewForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.querySelectorAll('#starPicker i').forEach((star) => {
    star.addEventListener('click', () => {
        const value = Number(star.dataset.value);
        document.getElementById('reviewRating').value = value;
        document.querySelectorAll('#starPicker i').forEach((s) => {
            s.classList.toggle('active', Number(s.dataset.value) <= value);
        });
    });
});

document.getElementById('reviewForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('reviewFormMessage');
    const rating = Number(document.getElementById('reviewRating').value);
    if (!rating) {
        msg.style.color = '#a5473c';
        msg.textContent = 'Please select a star rating.';
        return;
    }
    try {
        const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guestName: document.getElementById('reviewGuestName').value,
                rating,
                comment: document.getElementById('reviewComment').value
            })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Something went wrong');
        msg.style.color = '#3d7a4f';
        msg.textContent = 'Thank you! Your review will appear once approved.';
        document.getElementById('reviewForm').reset();
        document.querySelectorAll('#starPicker i').forEach((s) => s.classList.remove('active'));
        document.getElementById('reviewRating').value = 0;
    } catch (err) {
        msg.style.color = '#a5473c';
        msg.textContent = err.message;
    }
});

loadReviews();

/* ==================================================================
   Sales features: social proof bar, abandoned-booking capture,
   exit-intent offer.
   ================================================================== */
async function loadSocialProof() {
    const bar = document.getElementById('socialProofBar');
    if (!bar) return;
    try {
        const res = await fetch('/api/stats/public');
        if (!res.ok) throw new Error('Failed to load stats');
        const stats = await res.json();
        const items = [
            { value: stats.guestsHosted, label: 'Guests Hosted' },
            { value: stats.eventsHosted, label: 'Events at Crescent Grove' },
            { value: stats.reviewCount, label: 'Guest Reviews' },
            { value: stats.averageRating || '—', label: 'Average Rating' }
        ].filter((item) => Number(item.value) > 0 || item.label === 'Average Rating' && stats.reviewCount > 0);
        if (!items.length) return;
        document.getElementById('socialProofGrid').innerHTML = items.map((item) => `
            <div><span class="stat-value">${item.value}${item.label === 'Average Rating' ? ' / 5' : '+'}</span><span class="stat-label">${item.label}</span></div>
        `).join('');
        bar.style.display = 'block';
    } catch (err) { /* fail silently — not critical */ }
}
loadSocialProof();

// Abandoned-booking capture: once name + email + phone are all filled in,
// record interest (debounced) so staff can follow up if the guest never
// actually submits. Fires on blur of the phone field, the last of the three.
let abandonedCaptureTimer = null;
const abandonedPhoneInput = document.getElementById('phone');
if (abandonedPhoneInput) {
    abandonedPhoneInput.addEventListener('blur', () => {
        clearTimeout(abandonedCaptureTimer);
        abandonedCaptureTimer = setTimeout(() => {
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const phone = document.getElementById('phone').value;
            if (!name || !phone || (!email && !phone)) return;
            fetch('/api/abandoned-bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name, email, phone,
                    roomId: roomSelect.value ? Number(roomSelect.value) : null,
                    checkin: checkinInput.value, checkout: checkoutInput.value
                })
            }).catch(() => { /* best-effort */ });
        }, 600);
    });
}

// Exit-intent offer — shown once per browser session, only when the mouse
// leaves via the top of the viewport (the classic "about to close the tab"
// signal), and never if the guest already reached the booking form.
(() => {
    const overlay = document.getElementById('exitIntentOverlay');
    if (!overlay || sessionStorage.getItem('exitIntentShown')) return;

    const trigger = (e) => {
        if (e.clientY > 0) return;
        const bookingSection = document.getElementById('booking');
        const rect = bookingSection ? bookingSection.getBoundingClientRect() : null;
        if (rect && rect.top < window.innerHeight) return; // already at/near the booking form
        overlay.style.display = 'flex';
        sessionStorage.setItem('exitIntentShown', '1');
        document.removeEventListener('mouseleave', trigger);
    };
    document.addEventListener('mouseleave', trigger);

    document.getElementById('exitIntentCloseBtn').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.getElementById('exitIntentBookBtn').addEventListener('click', () => { overlay.style.display = 'none'; });
})();
