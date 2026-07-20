const output = document.querySelector('#renderer-id');

if (output) {
  output.textContent =
    new URLSearchParams(location.search).get('renderer') || 'unknown';
}
