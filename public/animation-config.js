/**
 * Animation Configuration & Constants
 * Timing, easing, prefers-reduced-motion detection
 */

const ANIMATION_CONFIG = {
  // Easing Functions
  easing: 'cubicBezier(0.4, 0, 0.2, 1)',
  easingFast: 'cubicBezier(0.4, 0, 1, 1)',
  easingQuad: 'easeOutQuad',
  easingCubic: 'easeOutCubic',
  easingElastic: 'easeOutElastic(1, .6)',
  easingSpring: 'cubicBezier(0.34, 1.56, 0.64, 1)',

  // Timing (milliseconds)
  fast: 200,
  normal: 300,
  slow: 500,
  verySlow: 800,

  // Stagger Delays
  staggerSmall: 75,
  staggerNormal: 100,
  staggerLarge: 150,

  // Animation Durations
  cardEnter: 500,
  countUp: 1200,
  chartDraw: 600,
  panelSlide: 300,
  panelSlideUp: 400,
  transition: 300,
  fadeIn: 300,
  fadeOut: 200,

  // Scale Factors
  scaleHover: 1.02,
  scaleLarge: 1.05,
  scalePress: 0.98,

  // Loading States
  skeletonShimmer: 1800,
  skeletonFadeDuration: 200,
  loadingDelay: 200,

  // Accessibility
  prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,

  /**
   * Get animation config, respecting prefers-reduced-motion
   * @returns {Object} Animation config with instant durations if reduced motion
   */
  getConfig() {
    if (this.prefersReducedMotion) {
      return {
        duration: 1,
        easing: 'linear'
      };
    }
    return {
      duration: this.normal,
      easing: this.easing
    };
  }
};

/**
 * LoadingStateManager — Skeleton → Data Transitions
 * Coordinates loading skeleton display with smooth content animation
 */
class LoadingStateManager {
  constructor(skeletonSelector, contentSelector, config = {}) {
    this.skeleton = typeof skeletonSelector === 'string'
      ? document.querySelector(skeletonSelector)
      : skeletonSelector;

    this.content = typeof contentSelector === 'string'
      ? document.querySelector(contentSelector)
      : contentSelector;

    this.config = {
      delayBeforeHide: 200,
      staggerDelay: 100,
      duration: 500,
      respectedReducedMotion: true,
      ...config
    };

    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Render data into content element
   * @param {Function} renderFn - Function that populates content element
   */
  renderContent(renderFn) {
    if (typeof renderFn === 'function') {
      renderFn(this.content);
    }
  }

  /**
   * Animate content in with stagger
   * @returns {Promise} Resolves when animation completes
   */
  async animateIn() {
    if (!this.content) return;

    const rows = this.content.querySelectorAll('.animate-row');
    if (rows.length === 0) return;

    if (this.prefersReducedMotion) {
      rows.forEach(row => {
        row.style.opacity = '1';
        row.style.transform = 'translateY(0)';
      });
      return;
    }

    // anime.stagger() only produces a per-target delay value — it isn't an
    // entry point itself. The animation call is anime({...}), with
    // anime.stagger() passed as the `delay` value for the stagger effect.
    return anime({
      targets: rows,
      opacity: [0, 1],
      translateY: [12, 0],
      delay: anime.stagger(this.config.staggerDelay),
      easing: ANIMATION_CONFIG.easing,
      duration: this.config.duration
    }).finished;
  }

  /**
   * Hide skeleton with fade out
   */
  async hideSkeleton() {
    if (!this.skeleton) return;

    await new Promise(resolve => {
      setTimeout(() => {
        if (this.prefersReducedMotion) {
          this.skeleton.style.display = 'none';
          resolve();
        } else {
          anime({
            targets: this.skeleton,
            opacity: [1, 0],
            duration: this.config.delayBeforeHide,
            easing: 'easeOutQuad',
            complete: () => {
              this.skeleton.style.display = 'none';
              resolve();
            }
          });
        }
      }, this.config.delayBeforeHide);
    });
  }

  /**
   * Complete load cycle: show skeleton → fetch data → hide skeleton → animate content in
   * @param {Function} fetchFn - Async function that fetches data
   * @param {Function} renderFn - Function that renders data into content
   * @returns {Promise} Resolves when all animations complete
   */
  async loadAndAnimate(fetchFn, renderFn = null) {
    try {
      // 1. Show skeleton
      if (this.skeleton) {
        this.skeleton.style.display = 'block';
      }
      if (this.content) {
        this.content.style.display = 'none';
      }

      // 2. Fetch data
      const data = await fetchFn();

      // 3. Render content
      this.renderContent(renderFn);
      if (this.content) {
        this.content.style.display = 'block';
      }

      // 4. Hide skeleton
      await this.hideSkeleton();

      // 5. Animate content in
      await this.animateIn();

      return data;
    } catch (err) {
      console.error('LoadingStateManager error:', err);
      throw err;
    }
  }

  /**
   * Show error state
   * @param {string} errorMessage - Error message to display
   */
  showError(errorMessage) {
    if (this.skeleton) {
      this.skeleton.style.display = 'none';
    }

    if (this.content) {
      this.content.innerHTML = `
        <div style="
          padding: 20px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 12px;
          color: #F87171;
          text-align: center;
        ">
          <strong>Error:</strong> ${errorMessage}
        </div>
      `;
      this.content.style.display = 'block';
    }
  }
}
