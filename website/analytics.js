(() => {
  const measurementId = "G-CVSL3MJE66";
  const pageLocation = `${window.location.origin}${window.location.pathname}`;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    page_location: pageLocation,
    page_title: document.title,
  });

  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(tag);

  const track = (eventName, parameters = {}) => {
    window.gtag("event", eventName, {
      ...parameters,
      transport_type: "beacon",
    });
  };

  for (const link of document.querySelectorAll("a.download-button")) {
    link.addEventListener("click", () => {
      const browser = link.href.includes("Safari") ? "safari" : "chrome";
      track("download_click", {
        browser,
        file_type: "zip",
        product: "jessee",
      });
    });
  }

  document.querySelector("a.artifact-link")?.addEventListener("click", () => {
    track("example_playbook_download", {
      file_type: "pdf",
      product: "jessee",
    });
  });

  for (const link of document.querySelectorAll('a[href^="https://github.com/polyform-ai/jessee"]')) {
    link.addEventListener("click", () => {
      const path = new URL(link.href).pathname;
      let destination = "repository";
      if (path.includes("/issues")) destination = "issues";
      if (path.includes("INSTALL_PREVIEW")) destination = "installation_guide";
      if (path.includes("/releases/")) destination = "release";

      track("github_click", { destination, product: "jessee" });
    });
  }

  document.querySelector('a[href^="mailto:"]')?.addEventListener("click", () => {
    track("contact_click", { method: "email", product: "jessee" });
  });

  for (const trigger of document.querySelectorAll("[data-lightbox]")) {
    trigger.addEventListener("click", () => {
      const asset = trigger.dataset.lightbox?.split("/").pop() || "unknown";
      track("screenshot_preview_open", { asset, product: "jessee" });
    });
  }
})();
