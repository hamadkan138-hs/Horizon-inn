/**
 * Animation Engine — anime.js orchestration patterns
 * Reusable functions for luxury micro-interactions
 */

// Check if anime.js is loaded
if (typeof anime === 'undefined') {
  console.error('anime.js not loaded. Include <script src="https://cdn.jsdelivr.net/npm/anime@3.2.1/lib/anime.min.js"></script>');
}

const AnimationEngine = {
  // Detect prefers-reduced-motion
  prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,

  /**
   * Stagger fade + slide up on card load
   * @param {string|Element} selector - CSS selector or element
   * @param {number} staggerDelay - Delay between cards (ms)
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  staggerFadeSlideUp(selector, staggerDelay = 100, duration = 500) {
    // If anime.js failed to load (CDN blocked, ad-blocker, network issue),
    // fall back to revealing content instantly instead of leaving it stuck
    // at opacity:0 forever — the same fallback already used for
    // prefers-reduced-motion, since a missing animation library must never
    // be able to permanently hide real content.
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      document.querySelectorAll(selector).forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      return null;
    }

    // anime.stagger() produces a per-target delay value, not an entry point —
    // the animation call is anime({...}) with anime.stagger() as the `delay`.
    return anime({
      targets: selector,
      opacity: [0, 1],
      translateY: [20, 0],
      delay: anime.stagger(staggerDelay),
      easing: 'cubicBezier(0.4, 0, 0.2, 1)',
      duration: duration
    });
  },

  /**
   * Count up animation for numbers (KPI metrics, totals, etc.)
   * @param {string|Element} selector - Target element or selector
   * @param {number} targetValue - Final value to count to
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  countUp(selector, targetValue, duration = 1200) {
    // Same fallback as every other animation here: if anime.js didn't load,
    // jump straight to the final value instead of throwing and silently
    // aborting whatever code runs after this call (this sits inline in
    // several places with no per-call try/catch, so an uncaught throw here
    // has previously taken out the rest of the calling function too).
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (el) el.textContent = targetValue.toLocaleString();
      return null;
    }

    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) return null;

    // Extract prefix and suffix from existing text (e.g. "Rs. 500" or "85%")
    const originalText = element.textContent;
    const numberMatch = originalText.match(/\d+/);
    let prefix = '';
    let suffix = '';

    if (numberMatch) {
      const numberIndex = originalText.indexOf(numberMatch[0]);
      prefix = originalText.substring(0, numberIndex);
      suffix = originalText.substring(numberIndex + numberMatch[0].length);
    }

    const startValue = parseInt(originalText.replace(/\D/g, '')) || 0;

    return anime({
      targets: { value: startValue },
      value: targetValue,
      easing: 'easeOutCubic',
      duration: duration,
      round: 1,
      update(anim) {
        element.textContent = prefix + Math.round(anim.progress * targetValue).toLocaleString() + suffix;
      }
    });
  },

  /**
   * Glow effect on hover (soft blue/purple aura)
   * @param {string|Element} selector - Target element(s)
   */
  glowOnHover(selector) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    elements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (!this.prefersReducedMotion) {
          el.style.boxShadow = '0 30px 80px rgba(59, 130, 246, 0.3), inset 0 1px 1px rgba(255,255,255,0.1)';
        }
      });

      el.addEventListener('mouseleave', () => {
        el.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.1)';
      });
    });
  },

  /**
   * Press feedback animation on click
   * @param {string|Element} selector - Button or clickable element
   */
  pressAnimation(selector) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    elements.forEach(el => {
      el.addEventListener('mousedown', () => {
        if (!this.prefersReducedMotion) {
          anime.set(el, { scale: 0.98 });
          anime({
            targets: el,
            scale: 1,
            duration: 150,
            easing: 'easeOutQuad'
          });
        }
      });
    });
  },

  /**
   * Slide panel in from right (drawer/modal entrance)
   * @param {string|Element} selector - Panel element
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  slidePanelFromRight(selector, duration = 300) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (el) {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
      }
      return null;
    }

    return anime({
      targets: selector,
      opacity: [0, 1],
      translateX: [100, 0],
      easing: 'cubicBezier(0.34, 1.56, 0.64, 1)',
      duration: duration
    });
  },

  /**
   * Slide panel up from bottom (Apple Wallet style)
   * @param {string|Element} selector - Panel element
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  slidePanelFromBottom(selector, duration = 400) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (el) {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }
      return null;
    }

    return anime({
      targets: selector,
      opacity: [0, 1],
      translateY: [100, 0],
      easing: 'cubicBezier(0.34, 1.56, 0.64, 1)',
      duration: duration
    });
  },

  /**
   * Expandable card (like front desk lookup)
   * @param {string|Element} cardSelector - Card to expand
   * @param {string|Element} contentSelector - Content that reveals
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  expandCard(cardSelector, contentSelector, duration = 400) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const card = typeof cardSelector === 'string' ? document.querySelector(cardSelector) : cardSelector;
      const content = typeof contentSelector === 'string' ? document.querySelector(contentSelector) : contentSelector;

      if (card) card.style.minHeight = 'auto';
      if (content) content.style.opacity = '1';
      return null;
    }

    const card = typeof cardSelector === 'string' ? document.querySelector(cardSelector) : cardSelector;
    if (!card) return null;

    const initialHeight = card.offsetHeight;
    const content = typeof contentSelector === 'string' ? document.querySelector(contentSelector) : contentSelector;
    const finalHeight = initialHeight + (content ? content.offsetHeight : 200);

    return anime({
      targets: card,
      minHeight: [initialHeight, finalHeight],
      opacity: [1, 1],
      easing: 'easeInOutQuad',
      duration: duration
    });
  },

  /**
   * Fade out + fade in (tab/page transition)
   * @param {string|Element} oldSelector - Element to fade out
   * @param {string|Element} newSelector - Element to fade in
   * @param {number} duration - Each animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  fadeTransition(oldSelector, newSelector, duration = 300) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const oldEl = typeof oldSelector === 'string' ? document.querySelector(oldSelector) : oldSelector;
      const newEl = typeof newSelector === 'string' ? document.querySelector(newSelector) : newSelector;

      if (oldEl) oldEl.style.opacity = '0';
      if (newEl) newEl.style.opacity = '1';
      return null;
    }

    const timeline = anime.timeline();

    timeline.add({
      targets: oldSelector,
      opacity: [1, 0],
      duration: duration * 0.6,
      easing: 'easeInQuad'
    }, 0);

    timeline.add({
      targets: newSelector,
      opacity: [0, 1],
      duration: duration,
      easing: 'easeOutQuad'
    }, duration * 0.4);

    return timeline;
  },

  /**
   * Glow pulse (real-time status updates)
   * @param {string|Element} selector - Target element
   * @param {number} pulses - Number of pulse cycles
   */
  glowPulse(selector, pulses = 1) {
    if (this.prefersReducedMotion) return;

    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) return;

    anime({
      targets: element,
      boxShadow: [
        { value: '0 0 0 0 rgba(59, 130, 246, 0.4)' },
        { value: '0 0 0 8px rgba(59, 130, 246, 0.1)' }
      ],
      easing: 'easeInOutQuad',
      duration: 2000,
      loop: pulses > 1 ? pulses : false
    });
  },

  /**
   * Chart bar growth animation (from 0 height to target)
   * @param {string|Element} barSelector - Bar element(s)
   * @param {string} heightProperty - 'height' or 'width'
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  chartBarGrow(barSelector, heightProperty = 'height', duration = 600) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      document.querySelectorAll(barSelector).forEach(el => {
        el.style[heightProperty] = el.dataset.targetHeight || '100%';
      });
      return null;
    }

    return anime({
      targets: barSelector,
      [heightProperty]: (el) => el.dataset.targetHeight || '100%',
      easing: 'easeOutQuad',
      duration: duration
    });
  },

  /**
   * Input underline animation (gradient focus state)
   * @param {string|Element} inputSelector - Input element
   */
  inputUnderlineAnimation(inputSelector) {
    const input = typeof inputSelector === 'string'
      ? document.querySelector(inputSelector)
      : inputSelector;

    if (!input) return;

    input.addEventListener('focus', () => {
      if (!this.prefersReducedMotion) {
        anime({
          targets: input,
          borderBottomColor: 'rgba(59, 130, 246, 0.8)',
          duration: 300,
          easing: 'easeOutQuad'
        });
      }
    });

    input.addEventListener('blur', () => {
      anime({
        targets: input,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
        duration: 300,
        easing: 'easeOutQuad'
      });
    });
  },

  /**
   * Error message slide in from left with pulse highlight
   * @param {string|Element} errorSelector - Error message element
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  errorSlideIn(errorSelector, duration = 300) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const el = typeof errorSelector === 'string' ? document.querySelector(errorSelector) : errorSelector;
      if (el) {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
      }
      return null;
    }

    const timeline = anime.timeline();

    timeline.add({
      targets: errorSelector,
      opacity: [0, 1],
      translateX: [-20, 0],
      duration: duration,
      easing: 'easeOutQuad'
    }, 0);

    timeline.add({
      targets: errorSelector,
      backgroundColor: ['rgba(248, 113, 113, 0.15)', 'rgba(248, 113, 113, 0)'],
      duration: 800,
      easing: 'easeInQuad'
    }, 0);

    return timeline;
  },

  /**
   * Success toast slide in from bottom
   * @param {string|Element} toastSelector - Toast element
   * @param {number} duration - Animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  toastSlideIn(toastSelector, duration = 400) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const el = typeof toastSelector === 'string' ? document.querySelector(toastSelector) : toastSelector;
      if (el) {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }
      return null;
    }

    return anime({
      targets: toastSelector,
      opacity: [0, 1],
      translateY: [100, 0],
      easing: 'easeOutQuad',
      duration: duration
    });
  },

  /**
   * Page transition fade + slide (tab/section change)
   * @param {string|Element} exitSelector - Element to fade out
   * @param {string|Element} enterSelector - Element to fade in
   * @param {number} duration - Total animation duration (ms)
   * @returns {anime.AnimeInstance}
   */
  pageTransition(exitSelector, enterSelector, duration = 400) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const exitEl = typeof exitSelector === 'string' ? document.querySelector(exitSelector) : exitSelector;
      const enterEl = typeof enterSelector === 'string' ? document.querySelector(enterSelector) : enterSelector;
      if (exitEl) exitEl.style.opacity = '0';
      if (enterEl) {
        enterEl.style.opacity = '1';
        enterEl.style.transform = 'translateY(0)';
      }
      return null;
    }

    const timeline = anime.timeline();

    timeline.add({
      targets: exitSelector,
      opacity: [1, 0],
      duration: duration * 0.5,
      easing: 'easeInQuad'
    }, 0);

    timeline.add({
      targets: enterSelector,
      opacity: [0, 1],
      translateY: [20, 0],
      duration: duration,
      easing: 'easeOutQuad'
    }, duration * 0.3);

    return timeline;
  },

  /**
   * Animate modal summary breakdown items (stagger fade + slide)
   * @param {string|Element} summarySelector - Modal summary container
   */
  animateModalSummary(summarySelector, baseDelay = 100) {
    if (this.prefersReducedMotion || typeof anime === 'undefined') {
      const container = typeof summarySelector === 'string'
        ? document.querySelector(summarySelector)
        : summarySelector;
      if (container) {
        container.querySelectorAll('div').forEach(item => {
          item.style.opacity = '1';
          item.style.transform = 'translateX(0)';
        });
      }
      return;
    }

    const container = typeof summarySelector === 'string'
      ? document.querySelector(summarySelector)
      : summarySelector;
    if (!container) return;

    const items = container.querySelectorAll('div');
    items.forEach((item, index) => {
      anime({
        targets: item,
        opacity: [0, 1],
        translateX: [-12, 0],
        easing: 'easeOutQuad',
        duration: 400,
        delay: index * baseDelay + 100
      });
    });
  },

  /**
   * Show toast notification (success or error)
   * @param {string} message - Toast message text
   * @param {string} type - 'success' or 'error'
   * @param {number} duration - Auto-dismiss duration (ms), 0 = manual
   */
  showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;

    const icon = type === 'success'
      ? '<i class="fas fa-check-circle"></i>'
      : '<i class="fas fa-exclamation-circle"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    document.body.appendChild(toast);

    // Animate in
    this.toastSlideIn(toast, 300);

    // Auto-dismiss if duration > 0
    if (duration > 0) {
      setTimeout(() => {
        if (!this.prefersReducedMotion) {
          anime({
            targets: toast,
            opacity: [1, 0],
            translateY: [0, 40],
            duration: 300,
            easing: 'easeInQuad',
            complete: () => toast.remove()
          });
        } else {
          toast.remove();
        }
      }, duration);
    }

    return toast;
  },

  /**
   * Initialize all global interactions
   */
  initGlobalInteractions() {
    // Glass cards hover glow
    this.glowOnHover('.glass-card');

    // Button press feedback
    this.pressAnimation('button, .btn, a.btn');

    // Input focus animations
    document.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], textarea').forEach(input => {
      this.inputUnderlineAnimation(input);
    });
  }
};

// Auto-initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    AnimationEngine.initGlobalInteractions();
  });
} else {
  AnimationEngine.initGlobalInteractions();
}
