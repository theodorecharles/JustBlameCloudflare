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

})();
