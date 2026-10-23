# Web UI Patterns for GitHub Pages Apps

## Chart.js / Canvas Rendering on Tab Switch

When switching to a tab that contains a Chart.js canvas, the chart may not render if the canvas isn't visible yet. The `setTimeout(..., 50)` pattern is often too fast.

**Fix:** Use `requestAnimationFrame` to ensure the DOM has painted before rendering:

```javascript
// In your tab switch function:
if (sec === 'chart-tab') {
  setTimeout(function() {
    requestAnimationFrame(function() {
      drawChart();
    });
  }, 100);
}
```

The `requestAnimationFrame` ensures the browser has laid out the visible tab before Chart.js tries to measure the canvas dimensions.

## Portal-Based Tooltips (Escape Overflow Clipping)

CSS `position: absolute` tooltips get clipped by any parent with `overflow: hidden`. This affects cards, scrollable lists, and any container with `overflow` set.

**Fix:** Use JavaScript to position tooltips with `position: fixed` relative to the viewport:

```css
.tooltip .tip-text {
  display: none;
  position: fixed;  /* not absolute! */
  z-index: 99999;
  /* ... */
}
.tooltip .tip-text.show {
  display: block;
  opacity: 1;
}
```

```javascript
function showTip(el) {
  var tip = el.querySelector('.tip-text');
  tip.classList.add('show');
  var rect = el.getBoundingClientRect();
  tip.style.left = (rect.left + rect.width / 2 - 140) + 'px';
  tip.style.top = (rect.top - tip.offsetHeight - 10) + 'px';
}
```

**Mobile support:** Add click-to-show since hover doesn't work on touch:
```javascript
el.addEventListener('click', function(e) {
  e.preventDefault();
  if (activeTip === el) { hideTip(); } else { showTip(el); }
});
```

## Nav Links + Tab Buttons: Keep in Sync

When you have both top nav links and tab buttons that control the same sections, use a single `switchTab()` function that updates both:

```javascript
function switchTab(sec) {
  document.querySelectorAll('.section').forEach(function(s) { s.style.display = 'none'; });
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.nav-links a').forEach(function(a) { a.classList.remove('active'); });
  var el = document.getElementById(sec);
  if (el) el.style.display = 'block';
  document.querySelectorAll('[data-section="' + sec + '"]').forEach(function(t) { t.classList.add('active'); });
}
```

Both nav links and tabs use `data-section="section-name"` attributes.

## Input Validation: Blocking Decimals

For fields that should only accept whole numbers (like cents), `type="number"` with `step="1"` isn't enough:

```javascript
var buyRaw = input.value;
var buy = parseInt(buyRaw);
if (buyRaw !== String(buy)) {
  showError('Enter a whole number (1-99). No decimals!');
  return;
}
```

The key check is `buyRaw !== String(buy)` — if the string representation of the parsed integer doesn't match the original input, the user entered a decimal.

## Content Max-Width for Readability

```css
.content-wrapper {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 2rem;
}
@media (max-width: 768px) {
  .content-wrapper { padding: 0 1rem; }
}
```
