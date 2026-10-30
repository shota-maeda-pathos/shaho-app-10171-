// 比較ページの案の切り替え。<div class="variants"><button data-v="a"> と <section class="variant" data-v="a">
document.addEventListener('click', function (e) {
  var b = e.target.closest('.variants button');
  if (!b) return;
  var v = b.getAttribute('data-v');
  b.parentElement.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  document.querySelectorAll('.variant').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-v') === v); });
});
