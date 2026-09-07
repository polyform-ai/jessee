const header = document.querySelector("[data-header]");
const reveals = document.querySelectorAll(".reveal");
const lightbox = document.querySelector("[data-lightbox-dialog]");

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("visible");
    observer.unobserve(entry.target);
  }
}, { threshold: 0.12 });

for (const item of reveals) observer.observe(item);

window.addEventListener("scroll", () => {
  header?.classList.toggle("scrolled", window.scrollY > 24);
}, { passive: true });

for (const trigger of document.querySelectorAll("[data-lightbox]")) {
  trigger.addEventListener("click", () => {
    if (!(lightbox instanceof HTMLDialogElement)) return;
    const image = lightbox.querySelector("img");
    if (image) image.src = trigger.dataset.lightbox;
    lightbox.showModal();
  });
}

lightbox?.querySelector("button")?.addEventListener("click", () => lightbox.close());
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) lightbox.close();
});
