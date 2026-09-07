(() => {
  const hostname = window.location.hostname;
  document.querySelector('#cf-host-status > span').textContent = hostname;
  document.title = `${hostname} | 500: Internal server error`;
  for (const link of document.querySelectorAll('a[href*="5xx-error-landing"]')) {
    const url = new URL(link.href);
    url.searchParams.set('utm_campaign', hostname);
    link.href = url.href;
  }

  const ip = document.getElementById('cf-footer-ip');
  const reveal = document.getElementById('cf-footer-ip-reveal');
  reveal.addEventListener('click', () => {
    reveal.classList.add('hidden');
    ip.classList.remove('hidden');
  });

  const label = document.getElementById('cf-location');
  const requestColo = document.getElementById('cf-wrapper').dataset.colo;

  async function trace(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(url, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) return null;
      const text = await response.text();
      const colo = /^colo=([A-Z]{3})$/m.exec(text)?.[1];
      const address = /^ip=([\da-fA-F:.]+)$/m.exec(text)?.[1];
      return colo ? { colo, address } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function locate() {
    // Same-origin trace identifies the visitor's ingress edge, including with Argo routing.
    let result = await trace('/cdn-cgi/trace');
    if (!result && requestColo) return;
    // For direct-to-origin deployments, run the lookup on the visitor's network.
    if (!result) result = await trace('https://www.cloudflare.com/cdn-cgi/trace');
    if (!result) {
      if (label.textContent === 'Detecting…') label.textContent = 'Cloudflare network';
      return;
    }
    if (result.address) ip.textContent = result.address;
    const response = await fetch('/_outage/locations.json');
    if (!response.ok) return;
    const locations = await response.json();
    label.textContent = locations[result.colo] || result.colo;
  }
  locate().catch(() => {
    if (label.textContent === 'Detecting…') label.textContent = 'Cloudflare network';
  });
})();
