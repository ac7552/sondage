// Small progressive enhancements, no framework: confirm dialogs and delete links.
document.addEventListener("submit", (e) => {
  const msg = e.target.dataset.confirm;
  if (msg && !confirm(msg)) e.preventDefault();
}, true);

document.addEventListener("click", (e) => {
  const a = e.target.closest("a.js-delete");
  if (!a) return;
  e.preventDefault();
  if (!confirm("Remove this? It stays in any timeline versions already saved.")) return;
  const form = document.createElement("form");
  form.method = "post";
  form.action = a.href;
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  form.innerHTML = `<input type="hidden" name="_method" value="delete"><input type="hidden" name="authenticity_token" value="${token}">`;
  document.body.appendChild(form);
  form.submit();
});
