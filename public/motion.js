/**
 * Motion & Mouse Movement Physics with Typewriter Animation & Navbar Scroll
 */

document.addEventListener('DOMContentLoaded', () => {
  initCursorSpotlight();
  init3DTiltCards();
  initMagneticButtons();
  initScrollObserver();
  initNavbarScrollAnimation();
  initTypewriterEffect();
});

/* 1. Typewriter Animation for Hero Title */
function initTypewriterEffect() {
  const target = document.getElementById('typewriterWord');
  if (!target) return;

  const words = ['Member.', 'Student.', 'Technologist.', 'Innovator.', 'Peer.'];
  let wordIndex = 0;
  let charIndex = 0;
  let isDeleting = false;

  function type() {
    const currentWord = words[wordIndex];

    if (isDeleting) {
      target.textContent = currentWord.substring(0, charIndex - 1);
      charIndex--;
    } else {
      target.textContent = currentWord.substring(0, charIndex + 1);
      charIndex++;
    }

    let speed = isDeleting ? 50 : 110;

    if (!isDeleting && charIndex === currentWord.length) {
      speed = 2200; // Hold full word
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      wordIndex = (wordIndex + 1) % words.length;
      speed = 400;
    }

    setTimeout(type, speed);
  }

  type();
}

/* 2. Navbar Scroll Compression Animation */
function initNavbarScrollAnimation() {
  const headerNav = document.querySelector('.header-nav');
  if (!headerNav) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      headerNav.classList.add('scrolled');
    } else {
      headerNav.classList.remove('scrolled');
    }
  });
}

/* 3. Cursor Spotlight Following Pointer */
function initCursorSpotlight() {
  const spotlight = document.createElement('div');
  spotlight.id = 'cursorSpotlight';
  spotlight.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, rgba(56, 189, 248, 0.04) 50%, transparent 80%);
    pointer-events: none;
    z-index: 2;
    transform: translate(-50%, -50%);
    transition: opacity 0.3s ease;
    opacity: 0;
  `;
  document.body.appendChild(spotlight);

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let currentX = mouseX;
  let currentY = mouseY;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    spotlight.style.opacity = '1';
  });

  window.addEventListener('mouseleave', () => {
    spotlight.style.opacity = '0';
  });

  function renderSpotlight() {
    currentX += (mouseX - currentX) * 0.15;
    currentY += (mouseY - currentY) * 0.15;
    spotlight.style.left = `${currentX}px`;
    spotlight.style.top = `${currentY}px`;
    requestAnimationFrame(renderSpotlight);
  }

  renderSpotlight();
}

/* 4. 3D Tilt Parallax on Glass Cards */
function init3DTiltCards() {
  const cards = document.querySelectorAll('.glass-card, .feature-card, .showcase-card');
  if (window.innerWidth < 768) return;

  cards.forEach((card) => {
    card.style.transformStyle = 'preserve-3d';
    card.style.transition = 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease';

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -6;
      const rotateY = ((x - centerX) / centerX) * 6;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.015, 1.015, 1.015)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  });
}

/* 5. Magnetic Hover Physics on Buttons */
function initMagneticButtons() {
  const magneticBtns = document.querySelectorAll('.btn-liquid');

  magneticBtns.forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - (rect.left + rect.width / 2);
      const y = e.clientY - (rect.top + rect.height / 2);

      btn.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px) scale(1.03)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0px, 0px) scale(1)';
    });
  });
}

/* 6. Intersection Observer Entrance Animations */
function initScrollObserver() {
  const animatedElements = document.querySelectorAll('.feature-card, .glass-card, .hero-title, .hero-subtitle');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  animatedElements.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(25px)';
    el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(el);
  });
}
