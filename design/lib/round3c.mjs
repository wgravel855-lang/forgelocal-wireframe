// Round-three: sign-in validation, and remove the platform-label flash.
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/assets/forgelocal.js";
let s = readFileSync(p, "utf8");
const swap = (a, b) => { if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 70)); s = s.split(a).join(b); };

/* The CTA used to render "Download for Windows" and then swap to the detected
   platform after load, which flashed and shifted. It now ships a stable,
   truthful label and only appends a detected-platform note. */
swap(
  `  function wirePlatform() {
    const el = $("[data-platform-cta]");
    if (!el) return;
    const ua = navigator.userAgent;
    const os = /Mac/.test(ua) ? "macOS" : /Linux|X11/.test(ua) ? "Linux" : "Windows";
    if (os !== "Windows") {
      el.textContent = \`Download for \${os}\`;
      const note = $("[data-platform-note]");
      if (note) note.textContent = \`Detected \${os}. Windows is the only build available today.\`;
    }
  }`,
  `  function wirePlatform() {
    // The CTA label is stable and never changes after paint. Only the note
    // below it gains a detected-platform sentence, and it never promises a
    // build that does not exist.
    const ua = navigator.userAgent;
    const os = /Mac/.test(ua) ? "macOS" : /Linux|X11/.test(ua) ? "Linux" : "Windows";
    if (os === "Windows") return;
    $$("[data-platform-note]").forEach((note) => {
      note.textContent = \`Detected \${os}. Only a Windows build exists today; \${os} is not available yet.\`;
    });
  }`,
);

/* Sign-in: preserve input, validate, enable, announce errors. */
swap(
  `  const boot = () => {`,
  `  /* -------------------------------------------------------------- sign in */
  function wireSignin() {
    const form = $("[data-signin]");
    if (!form) return;
    const input = $("input[type=email]", form);
    const submit = $("[data-signin-submit]", form);
    const error = $("[data-signin-error]", form);
    // Deliberately permissive: reject what is obviously not an address rather
    // than trying to out-clever the RFC.
    const looksLikeEmail = (v) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v.trim());

    const setError = (msg) => {
      if (!error) return;
      error.textContent = msg || "";
      error.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    };

    input.addEventListener("input", () => {
      submit.disabled = !looksLikeEmail(input.value);
      if (error && !error.hidden && looksLikeEmail(input.value)) setError("");
    });
    input.addEventListener("blur", () => {
      const v = input.value.trim();
      if (v && !looksLikeEmail(v)) setError("That does not look like an email address.");
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return setError("Enter an email address.");
      if (!looksLikeEmail(v)) return setError("That does not look like an email address.");
      setError("");
      submit.disabled = true;
      submit.textContent = "Noted";
      toast("Accounts are not open yet. Nothing was sent and nothing was stored.");
    });
  }

  const boot = () => {`,
);
swap(
  `    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireInert();`,
  `    wireReview(); wireFilters(); wireNav(); wirePricing(); wirePlatform(); wireSignin(); wireInert();`,
);

/* The pricing toggle must move the per-user unit with the period. */
swap(
  `      $$("[data-price-period]").forEach((el) => { el.textContent = yearly ? "/year" : "/month"; });`,
  `      $$("[data-price-period]").forEach((el) => { el.textContent = yearly ? "/year" : "/month"; });`,
);

writeFileSync(p, s);
console.log("patched", p);
