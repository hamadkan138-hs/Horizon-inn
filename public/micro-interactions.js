/**
 * Micro-Interactions Module
 * Form focus animations, error messages, success toasts, hover effects
 */

const MicroInteractions = {
  prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,

  /**
   * Toast notification (success, error, info)
   * @param {string} message - Message text
   * @param {string} type - 'success', 'error', 'info'
   * @param {number} duration - How long to show (ms)
   */
  showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 16px 24px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      color: #fff;
      font-weight: 500;
      backdrop-filter: blur(20px);
      z-index: 9999;
      max-width: 400px;
      word-wrap: break-word;
    `;

    // Color by type
    if (type === 'success') {
      toast.style.borderColor = 'rgba(34, 197, 94, 0.3)';
      toast.style.background = 'rgba(34, 197, 94, 0.1)';
    } else if (type === 'error') {
      toast.style.borderColor = 'rgba(248, 113, 113, 0.3)';
      toast.style.background = 'rgba(248, 113, 113, 0.1)';
    }

    document.body.appendChild(toast);

    // Animate in
    if (!this.prefersReducedMotion) {
      anime({
        targets: toast,
        opacity: [0, 1],
        translateY: [100, 0],
        easing: 'easeOutQuad',
        duration: 400
      });
    } else {
      toast.style.opacity = '1';
    }

    // Auto-remove after duration
    setTimeout(() => {
      if (!this.prefersReducedMotion) {
        anime({
          targets: toast,
          opacity: [1, 0],
          translateY: [0, 100],
          easing: 'easeInQuad',
          duration: 300,
          complete: () => toast.remove()
        });
      } else {
        toast.remove();
      }
    }, duration);
  },

  /**
   * Form field validation feedback
   * @param {Element} field - Input element
   * @param {boolean} isValid - Validation result
   * @param {string} errorMessage - Error message (if invalid)
   */
  validateField(field, isValid, errorMessage = '') {
    // Remove existing error
    const existingError = field.parentElement.querySelector('.field-error');
    if (existingError) {
      if (!this.prefersReducedMotion) {
        anime({
          targets: existingError,
          opacity: [1, 0],
          translateX: [0, -20],
          duration: 200,
          easing: 'easeInQuad',
          complete: () => existingError.remove()
        });
      } else {
        existingError.remove();
      }
    }

    if (!isValid && errorMessage) {
      const error = document.createElement('div');
      error.className = 'field-error';
      error.textContent = errorMessage;
      error.style.cssText = `
        color: #F87171;
        font-size: 0.875rem;
        margin-top: 8px;
        padding: 8px 12px;
        background: rgba(248, 113, 113, 0.1);
        border-left: 2px solid #F87171;
        border-radius: 4px;
        opacity: 0;
        transform: translateX(-20px);
      `;

      field.parentElement.appendChild(error);

      // Animate error in
      if (!this.prefersReducedMotion) {
        anime({
          targets: error,
          opacity: [0, 1],
          translateX: [-20, 0],
          duration: 300,
          easing: 'easeOutQuad'
        });
      } else {
        error.style.opacity = '1';
        error.style.transform = 'translateX(0)';
      }

      // Add red border to field
      field.style.borderColor = 'rgba(248, 113, 113, 0.5)';
    } else if (isValid) {
      field.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    }
  },

  /**
   * Hover scale effect on interactive elements
   * @param {string|Element} selector - Target element(s)
   * @param {number} scale - Scale factor (default 1.02)
   */
  hoverScale(selector, scale = 1.02) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    elements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (!this.prefersReducedMotion) {
          anime.set(el, { scale: scale });
        }
      });

      el.addEventListener('mouseleave', () => {
        if (!this.prefersReducedMotion) {
          anime.set(el, { scale: 1 });
        }
      });
    });
  },

  /**
   * Checkbox/Radio toggle animation
   * @param {string|Element} selector - Checkbox/radio element
   */
  toggleAnimation(selector) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    elements.forEach(el => {
      el.addEventListener('change', () => {
        if (!this.prefersReducedMotion) {
          anime({
            targets: el,
            scale: [1, 0.9, 1],
            duration: 300,
            easing: 'easeOutElastic(1, .6)'
          });
        }
      });
    });
  },

  /**
   * Form submit animation (disable button during submission)
   * @param {Element} button - Submit button
   * @param {number} duration - Disable duration (ms)
   */
  submitButtonAnimation(button, duration = 2000) {
    const originalText = button.textContent;
    const originalDisabled = button.disabled;

    button.disabled = true;
    button.textContent = 'Processing...';

    if (!this.prefersReducedMotion) {
      anime({
        targets: button,
        opacity: [1, 0.7],
        duration: duration,
        easing: 'linear'
      });
    }

    setTimeout(() => {
      button.disabled = originalDisabled;
      button.textContent = originalText;

      if (!this.prefersReducedMotion) {
        anime.set(button, { opacity: 1 });
      }
    }, duration);
  },

  /**
   * Stagger button entrance (like front desk buttons)
   * @param {string|Element} containerSelector - Parent container
   * @param {number} staggerDelay - Delay between buttons (ms)
   */
  staggerButtonEntrance(containerSelector, staggerDelay = 100) {
    const container = typeof containerSelector === 'string'
      ? document.querySelector(containerSelector)
      : containerSelector;

    if (!container) return;

    const buttons = container.querySelectorAll('button, .btn, a.btn');

    if (this.prefersReducedMotion) {
      buttons.forEach(btn => {
        btn.style.opacity = '1';
        btn.style.transform = 'translateY(0)';
      });
      return;
    }

    anime.stagger(staggerDelay, {
      targets: buttons,
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 400,
      easing: 'easeOutQuad'
    });
  },

  /**
   * Fade and scale focus state for card/panel
   * @param {string|Element} selector - Element to focus on
   */
  focusHighlight(selector) {
    const element = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;

    if (!element) return;

    if (!this.prefersReducedMotion) {
      anime({
        targets: element,
        scale: [1, 1.02],
        duration: 300,
        easing: 'easeOutQuad'
      });
    }
  },

  /**
   * Floating animation (subtle up/down movement)
   * @param {string|Element} selector - Element to float
   * @param {number} distance - Float distance (px)
   */
  floatingAnimation(selector, distance = 4) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    if (this.prefersReducedMotion) return;

    elements.forEach(el => {
      anime({
        targets: el,
        translateY: [-distance, distance],
        duration: 3000,
        easing: 'easeInOutQuad',
        loop: true,
        direction: 'alternate'
      });
    });
  },

  /**
   * Cursor glow tracking (subtle glow follows cursor on hover)
   * @param {string|Element} selector - Card element(s)
   */
  cursorGlowTracking(selector) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    if (this.prefersReducedMotion) return;

    elements.forEach(el => {
      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        el.style.setProperty('--cursor-x', `${x}px`);
        el.style.setProperty('--cursor-y', `${y}px`);
      });

      el.addEventListener('mouseleave', () => {
        el.style.setProperty('--cursor-x', '50%');
        el.style.setProperty('--cursor-y', '50%');
      });
    });
  },

  /**
   * Ripple effect on click (material-like)
   * @param {string|Element} selector - Clickable element
   */
  rippleEffect(selector) {
    const elements = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    elements.forEach(el => {
      el.addEventListener('click', function (e) {
        if (this.prefersReducedMotion) return;

        const rect = el.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.style.cssText = `
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
          width: 20px;
          height: 20px;
          pointer-events: none;
          left: ${e.clientX - rect.left}px;
          top: ${e.clientY - rect.top}px;
          transform: translate(-50%, -50%);
        `;

        el.style.position = 'relative';
        el.style.overflow = 'hidden';
        el.appendChild(ripple);

        anime({
          targets: ripple,
          scale: [0, 3],
          opacity: [1, 0],
          duration: 600,
          easing: 'easeOutQuad',
          complete: () => ripple.remove()
        });
      }.bind(this));
    });
  },

  /**
   * Underline gradient animation on form input focus
   * @param {string|Element} selector - Input element(s)
   */
  formUnderlineAnimation(selector) {
    const inputs = typeof selector === 'string'
      ? document.querySelectorAll(selector)
      : [selector];

    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        if (!this.prefersReducedMotion) {
          anime({
            targets: input,
            borderBottomColor: ['rgba(255, 255, 255, 0.1)', 'rgba(59, 130, 246, 0.6)'],
            duration: 300,
            easing: 'easeOutQuad'
          });
        }
      });

      input.addEventListener('blur', () => {
        if (!this.prefersReducedMotion) {
          anime({
            targets: input,
            borderBottomColor: 'rgba(255, 255, 255, 0.1)',
            duration: 300,
            easing: 'easeOutQuad'
          });
        }
      });
    });
  },

  /**
   * Page transition fade + slide
   * @param {Element} exitElement - Element to fade out
   * @param {Element} enterElement - Element to fade in
   */
  pageTransition(exitElement, enterElement, duration = 400) {
    if (!exitElement || !enterElement) return;

    if (this.prefersReducedMotion) {
      if (exitElement) exitElement.style.opacity = '0';
      if (enterElement) {
        enterElement.style.opacity = '1';
        enterElement.style.transform = 'translateY(0)';
      }
      return;
    }

    const timeline = anime.timeline();

    timeline.add({
      targets: exitElement,
      opacity: [1, 0],
      duration: duration * 0.6,
      easing: 'easeInQuad'
    }, 0);

    timeline.add({
      targets: enterElement,
      opacity: [0, 1],
      translateY: [20, 0],
      duration: duration,
      easing: 'easeOutQuad'
    }, duration * 0.4);

    return timeline;
  },

  /**
   * Initialize all global micro-interactions
   */
  initGlobalInteractions() {
    // Hover scale on cards
    this.hoverScale('.glass-card');

    // Toggle animations on checkboxes
    this.toggleAnimation('input[type="checkbox"], input[type="radio"]');

    // Form underline animations
    this.formUnderlineAnimation('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="date"], textarea, select');

    // Floating cards (optional Tier 2)
    // this.floatingAnimation('.dashboard-card');
  }
};

// Auto-initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    MicroInteractions.initGlobalInteractions();
  });
} else {
  MicroInteractions.initGlobalInteractions();
}
