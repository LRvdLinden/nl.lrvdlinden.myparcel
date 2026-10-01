'use strict';
const $ = id => document.getElementById(id);

$('start').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'start' }, result => {
    $('status').textContent = result?.ok
      ? 'MyDHL+ login opened. After login, open Manage Shipments → All Shipments.'
      : (result?.error || 'Could not open MyDHL+ login.');
  });
});

$('generate').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'bundle' }, result => {
    if (!result?.ok) {
      $('status').textContent = result?.error || 'No MyDHL+ session could be captured.';
      return;
    }
    $('code').value = result.bundle || '';
    $('status').textContent = `Captured ${result.cookies || 0} cookies and ${result.requests || 0} shipment requests.`;
  });
});

$('copy').addEventListener('click', async () => {
  const value = $('code').value.trim();
  if (!value) return;
  await navigator.clipboard.writeText(value);
  $('status').textContent = 'Homey session code copied.';
});

$('reset').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reset' }, () => {
    $('code').value = '';
    $('status').textContent = 'Capture reset.';
  });
});
