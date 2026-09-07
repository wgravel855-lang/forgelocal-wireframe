// The remaining site routes. Imported by build.mjs, which passes in its
// helpers so every page shares one shell, one stylesheet and one data source.

export function extraRoutes({ write, marketing, appPage, part, esc, models, F, gb }) {
  const wrap = (inner) => `<section class="mwrap msec" style="padding-top:64px;padding-bottom:24px">${inner}</section>`;
  const head = (kicker, h1, lede) => wrap(`<div class="stack" style="gap:16px;max-width:720px">
    <span class="lab">${esc(kicker)}</span>
    <h1 class="mh2">${esc(h1)}</h1>
    ${lede ? `<p class="mlede">${lede}</p>` : ""}
  </div>`);

  /* ------------------------------------------------------------ /product/ */
  write("product/index.html", marketing({
    path: "/product/", title: "How ForgeLocal works",
    desc: "Detect hardware, choose a model that fits, open a project, run tools with reviewable permissions.",
    main: head("How it works", "Five steps, then you are working",
      "There is no configuration file to learn and no inference vocabulary to pick up. The parts that matter are shown when they matter.") +
      `<section class="mwrap msec" style="padding-bottom:96px">
  <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden">
    ${[
        ["Read the machine", "CPU, memory, video memory, free disk and any runtime already installed. It happens inside the app, after you agree to it, and the reading stays on the device."],
        ["Pick one profile", "Not a catalog to guess through. One recommendation with the arithmetic shown, and alternatives behind a disclosure."],
        ["Install runtime and weights", "Runtime, model download and a capability self-test in one step, with pause, resume and a clear interrupted state."],
        ["Choose a folder and a permission preset", "Project file access is limited to that folder by default. The preset decides how often the agent stops to ask."],
        ["Work, then review", "Plan, edits, commands and tests appear as one quiet activity group. Changes arrive as a diff you keep or revert per file and per hunk."],
      ].map(([t, d], i) => `<li style="background:var(--bg);padding:22px;display:flex;gap:18px">
        <span class="lab num" style="width:24px;flex-shrink:0;padding-top:2px">0${i + 1}</span>
        <div class="stack" style="gap:6px"><span class="h2">${esc(t)}</span>
        <p class="mut" style="margin:0;font-size:14px;line-height:21px;max-width:68ch">${esc(d)}</p></div></li>`).join("\n")}
  </ol>
  <div style="margin-top:32px;display:flex;gap:14px;flex-wrap:wrap">
    <a class="btn btnp btnl" href="/download/">Download for Windows</a>
    <a class="btn btnl" href="/models/">Browse models first</a>
  </div>
</section>`,
  }));

  /* ----------------------------------------------------------- /download/ */
  write("download/index.html", marketing({
    path: "/download/", title: "Download ForgeLocal",
    desc: "Windows build, system requirements, checksum and release notes.",
    main: head("Download", "Get ForgeLocal", "One installer. Free for local use, and it does not need an account.") +
      `<section class="mwrap msec" style="padding-bottom:40px">
  <div class="box" style="padding:24px;display:flex;gap:24px;flex-wrap:wrap;align-items:center">
    <div class="stack" style="flex:1;min-width:260px;gap:8px">
      <span class="h2" style="font-size:18px">Windows 10 and 11, 64-bit</span>
      <span class="mut" style="font-size:13.5px">x64 and ARM64. Version and checksum appear here once the first signed build is published.</span>
    </div>
    <button class="btn btnp btnl" data-inert="No installer has been published yet. This prototype has no build to serve.">Download for Windows</button>
  </div>
  <p class="faint" style="margin:14px 2px 0;font-size:12.5px" data-platform-note>
    Detected platform appears here. macOS and Linux builds are not available yet.
  </p>
</section>

<section class="mwrap msec" style="padding-bottom:40px">
  <h2 class="h2" style="font-size:20px;margin-bottom:12px">System requirements</h2>
  <div style="overflow-x:auto"><table class="tbl" style="min-width:560px">
    <thead><tr><th>Component</th><th>Minimum</th><th>Comfortable</th></tr></thead>
    <tbody>
      <tr><td>System memory</td><td class="num">16 GB</td><td class="num">32 GB</td></tr>
      <tr><td>Video memory</td><td class="num">None, CPU only</td><td class="num">8 GB or more</td></tr>
      <tr><td>Free disk</td><td class="num">12 GB</td><td class="num">60 GB</td></tr>
      <tr><td>OS</td><td>Windows 10 22H2</td><td>Windows 11</td></tr>
    </tbody>
  </table></div>
  <p class="mut" style="margin:14px 0 0;font-size:13.5px;max-width:70ch">
    A machine with no discrete GPU still works. It runs smaller profiles on the CPU, and the app
    says so plainly rather than recommending something that will crawl.
    <a href="/models/">See what fits which machine</a>.
  </p>
</section>

<section class="mwrap msec" style="padding-bottom:96px">
  <h2 class="h2" style="font-size:20px;margin-bottom:12px">Verifying what you downloaded</h2>
  <div class="box" style="padding:20px;display:flex;flex-direction:column;gap:10px">
    <p class="mut" style="margin:0;font-size:13.5px;line-height:20px;max-width:70ch">
      Releases will be signed and published with a SHA-256 checksum next to the installer, and the
      current signing certificate will be named on this page. None of that exists yet, so no
      signature, hash or version is shown. When there is one, it will be here rather than in a
      marketing claim.
    </p>
    <p style="margin:0"><a href="/changelog/">Release notes</a> &middot; <a href="/status/">Service status</a></p>
  </div>
</section>`,
  }));

  /* ------------------------------------------------------------ /pricing/ */
  const plan = (name, monthly, blurb, feats, cta, primary) => `
  <div class="box" style="padding:24px;display:flex;flex-direction:column;gap:16px${primary ? ";border-color:var(--acc)" : ""}">
    <div class="stack" style="gap:6px">
      <div style="display:flex;align-items:center;gap:9px"><span class="h2">${esc(name)}</span>
        ${primary ? '<span class="pill acc">Most people</span>' : ""}</div>
      <div style="display:flex;align-items:baseline;gap:4px">
        <span class="num" style="font-size:32px;font-weight:600"${monthly ? ` data-price-monthly="${monthly}"` : ""}>${monthly ? `$${monthly}` : "$0"}</span>
        ${monthly ? '<span class="mut" data-price-period>/month</span>' : '<span class="mut">forever</span>'}
      </div>
      ${monthly ? '<span class="faint" style="font-size:12.5px" data-price-note hidden>Billed yearly, two months free</span>' : ""}
      <p class="mut" style="margin:4px 0 0;font-size:13.5px;line-height:20px">${esc(blurb)}</p>
    </div>
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px">
      ${feats.map((f) => `<li style="display:flex;gap:9px;align-items:flex-start;font-size:13.5px;line-height:20px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:3px"><path d="M20 6 9 17l-5-5"/></svg>
        <span>${esc(f)}</span></li>`).join("")}
    </ul>
    <span class="grow"></span>
    ${cta}
  </div>`;

  write("pricing/index.html", marketing({
    path: "/pricing/", title: "Pricing — ForgeLocal",
    desc: "Local use is free and unmetered. Paid plans cover the compatibility work, not your GPU.",
    main: head("Pricing", "Your compute is never metered",
      "Running a model on your own hardware is free and always will be. What you can pay for is the compatibility work: profiles that stay tested as runtimes and model releases move.") +
      `<section class="mwrap msec" style="padding-bottom:32px">
  <div style="display:flex;align-items:center;gap:12px">
    <span class="mut" style="font-size:13.5px">Monthly</span>
    <button type="button" role="switch" aria-checked="false" data-billing-toggle aria-label="Bill yearly"
      style="width:44px;height:24px;border-radius:12px;border:1px solid var(--line-strong);background:var(--sunk);position:relative;padding:0">
      <span style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--fg);transition:transform 160ms ease"></span>
    </button>
    <span class="mut" style="font-size:13.5px">Yearly <span class="faint">(two months free)</span></span>
  </div>
</section>
<section class="mwrap msec" style="padding-bottom:56px">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:stretch">
    ${plan("Free", null, "Everything you need to work locally.", [
        "Unlimited local model use, never metered",
        "Hardware scan and one tested recommendation",
        "Files, Git, terminal, diff, preview and rollback",
        "Up to three active projects",
      ], `<a class="btn btnl" href="/download/">Download</a>`, false)}
    ${plan("Pro", 15, "For people who live in it.", [
        "Unlimited projects",
        "Full verified profile matrix and updates",
        "Automations and background tasks",
        "Advanced recovery and diagnostics",
      ], `<button class="btn btnp btnl" data-inert="Billing is not connected in this prototype.">Start Pro</button>`, true)}
    ${plan("Team", 30, "Per user. Shared standards across a team.", [
        "Shared profiles and project policies",
        "Permission presets and an audit trail",
        "Centralized billing",
        "Private blueprint library",
      ], `<a class="btn btnl" href="/signin/">Talk to us</a>`, false)}
  </div>
</section>
<section class="mwrap msec" style="padding-bottom:96px">
  <h2 class="h2" style="font-size:20px;margin-bottom:14px">Questions people actually ask</h2>
  <div class="stack" style="gap:8px;max-width:76ch">
    ${[
        ["Do I pay for tokens?", "Not for local use. A model running on your own GPU costs you electricity, not credits. If you later connect a cloud provider, that is billed in real currency against a cap you set, and it is off by default."],
        ["What happens if I stop paying?", "The app keeps working locally with the profiles you already have. You stop receiving new verified profiles and Pro features."],
        ["Is there a refund?", "Cancel any time and the plan runs to the end of the period you paid for. Refund terms will be published with billing when it is connected."],
        ["Do I need an account?", "No, not for local use. An account exists for billing and for syncing settings between machines."],
      ].map(([q, a]) => `<details class="box"><summary style="padding:14px 16px;cursor:pointer;font-size:14px;font-weight:500">${esc(q)}</summary>
      <p class="mut" style="margin:0;padding:0 16px 16px;font-size:13.5px;line-height:21px">${esc(a)}</p></details>`).join("\n")}
  </div>
</section>`,
  }));

  /* ----------------------------------------------------------- /security/ */
  write("security/index.html", marketing({
    path: "/security/", title: "Security — ForgeLocal",
    desc: "What ForgeLocal can reach, what it cannot, and where the boundary actually is today.",
    main: part("SecurityPage"),
  }));

  /* -------------------------------------------------- small honest routes */
  const simple = (path, title, kicker, h1, lede, blocks) =>
    write(`${path}index.html`, marketing({
      path, title: `${title} — ForgeLocal`, desc: lede,
      main: head(kicker, h1, esc(lede)) + `<section class="mwrap msec" style="padding-bottom:96px">
        <div class="stack" style="gap:12px;max-width:76ch">${blocks}</div></section>`,
    }));

  const notice = (t, d) => `<div class="box" style="padding:20px"><p class="h3" style="margin:0 0 6px">${esc(t)}</p>
    <p class="mut" style="margin:0;font-size:13.5px;line-height:21px">${esc(d)}</p></div>`;

  simple("docs/", "Docs", "Documentation", "Docs",
    "Install, first project, model profiles, permissions and troubleshooting.",
    [["Getting started", "Installing, the hardware scan, and finishing your first task."],
     ["Model profiles", "What a profile pins, how fit is calculated, and how to pin a revision."],
     ["Permissions", "The three presets, what each command class does, and how to revoke a durable rule."],
     ["Troubleshooting", "Out of memory, runtime offline, interrupted downloads, and how to export a redacted diagnostic."]]
      .map(([t, d]) => notice(t, d)).join("\n") +
      `<p class="mut" style="margin:8px 0 0;font-size:13.5px">Docs are written alongside the features they describe. Nothing is published here yet, because there is no shipped build for it to describe.</p>`);

  simple("changelog/", "Changelog", "Releases", "Changelog",
    "Versions, changes, fixes and known issues.",
    notice("No releases yet", "There is no published build, so there are no release notes. Each release will list version, date, changes, fixes, known issues and a download link with its checksum."));

  simple("status/", "Status", "Status", "Service status",
    "Account, downloads and optional cloud providers.",
    `<div class="box" style="padding:20px;display:flex;flex-direction:column;gap:12px">
      ${[["Local app", "Works offline. Nothing on this page can stop it."],
         ["Profile registry", "Serves signed profile manifests. Cached locally, so an outage does not block work."],
         ["Downloads", "Weights come from the publisher, not from us."],
         ["Accounts and billing", "Only needed for paid plans."]]
        .map(([n, d]) => `<div style="display:flex;gap:12px;align-items:flex-start">
          <span class="pill" style="flex-shrink:0">Not deployed</span>
          <div class="stack" style="gap:2px"><span class="h3">${esc(n)}</span>
          <span class="mut" style="font-size:13px;line-height:19px">${esc(d)}</span></div></div>`).join("")}
    </div>
    <p class="mut" style="margin:0;font-size:13.5px">No services are deployed yet, so there is no uptime history to show. This page will carry live component status and incident history once there is something running.</p>`);

  simple("privacy/", "Privacy", "Legal", "Privacy",
    "What stays on your machine, and what does not.",
    `<div class="box" style="padding:20px;display:flex;flex-direction:column;gap:14px">
      <div><p class="h3" style="margin:0 0 6px">What stays local</p>
      <p class="mut" style="margin:0;font-size:13.5px;line-height:21px">Your project files, your prompts and the model's replies are processed on your machine while you are using a local model. They are not transmitted to us.</p></div>
      <div><p class="h3" style="margin:0 0 6px">What is optional</p>
      <p class="mut" style="margin:0;font-size:13.5px;line-height:21px">Crash reports, anonymous usage counts and contributed profile test results are three separate switches, all off on a fresh install. The diagnostics report is built on demand, shown to you in full, and redacted before it can be sent anywhere.</p></div>
      <div><p class="h3" style="margin:0 0 6px">What changes if you connect a cloud provider</p>
      <p class="mut" style="margin:0;font-size:13.5px;line-height:21px">Then the task summary and the file contents it names go to that provider under their terms. It is asked per task, never once at setup.</p></div>
    </div>
    <p class="mut" style="margin:0;font-size:13.5px">This is a plain-language summary of intended behavior, not a legal policy. A reviewed policy will be published before any build ships, and it will describe what the code actually does rather than what the design hoped for.</p>`);

  simple("terms/", "Terms", "Legal", "Terms",
    "The agreement covering use of ForgeLocal.",
    notice("Not published yet", "Terms will be published before the first build ships. Writing placeholder legal text would be worse than saying it is not ready."));

  simple("signin/", "Sign in", "Account", "Sign in",
    "An account is only needed for paid plans and syncing settings.",
    `<div class="box" style="padding:24px;max-width:420px;display:flex;flex-direction:column;gap:14px">
      <label class="stack" style="gap:6px"><span class="h3">Email</span>
        <input type="email" class="field" placeholder="you@example.com" style="width:100%;color:var(--fg)"></label>
      <button class="btn btnp btnl" data-inert="Authentication is not connected in this prototype.">Email me a sign-in link</button>
      <p class="faint" style="margin:0;font-size:12.5px;line-height:18px">No password. ForgeLocal works locally without any of this; signing in only affects billing and settings sync.</p>
    </div>`);

  /* ---------------------------------------------------------------- /404 */
  write("404.html", marketing({
    path: "/", title: "Page not found — ForgeLocal", desc: "That page does not exist.",
    main: `<section class="mwrap msec" style="padding:96px 32px 120px">
      <div class="stack" style="gap:16px;max-width:520px">
        <span class="lab num">404</span>
        <h1 class="mh2">That page does not exist</h1>
        <p class="mlede">The link may be old, or the page may not be built yet.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding-top:6px">
          <a class="btn btnp" href="/">Home</a>
          <a class="btn" href="/models/">Models</a>
          <a class="btn" href="/docs/">Docs</a>
        </div>
      </div></section>`,
  }));

  /* ------------------------------------------------------- app + setup ---- */
  const appRoutes = [
    ["app/", "WsEmpty", "Workspace"],
    ["app/running/", "WsRunning", "Working"],
    ["app/permission/", "WsPermission", "Permission request"],
    ["app/review/", "WsReview", "Review changes"],
    ["app/stopped/", "WsFailed", "Stopped"],
    ["app/models/", "ModelsExplore", "Models"],
    ["app/models/installed/", "ModelsMine", "My models"],
  ];
  for (const [path, p, title] of appRoutes) {
    write(`${path}index.html`, appPage({ title: `${title} — ForgeLocal`, body: part(p) }));
  }

  const setup = [["Ob1Welcome", "Welcome"], ["Ob2Recommendation", "Recommendation"],
    ["Ob3Install", "Install"], ["Ob4Project", "Project and permissions"], ["Ob5FirstChat", "First chat"]];
  setup.forEach(([p, title], i) => {
    write(`setup/${i + 1}/index.html`, appPage({ title: `Setup ${i + 1} of 5: ${title} — ForgeLocal`, body: part(p) }));
  });

  return { appRoutes, setup };
}
