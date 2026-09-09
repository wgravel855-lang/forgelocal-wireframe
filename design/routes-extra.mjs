// The remaining site routes. Imported by build.mjs, which passes in its
// helpers so every page shares one shell, one stylesheet and one data source.

const CROPS = {
  "1": "<div class=\"crop app\">\n          <dl class=\"kv\" style=\"grid-template-columns:110px 1fr;margin-bottom:12px\">\n            <dt>Graphics</dt><dd class=\"num\">RTX 4070 &middot; <strong>12 GB</strong> usable</dd>\n            <dt>Memory</dt><dd class=\"num\">32 GB total, 19 GB free</dd>\n          </dl>\n          <div class=\"box\" style=\"border-color:var(--acc);padding:14px 16px;display:flex;flex-direction:column;gap:10px\">\n            <div style=\"display:flex;align-items:flex-start;gap:12px\">\n              <div class=\"stack\" style=\"flex:1;gap:4px\">\n                <span class=\"h2\">Qwen2.5 Coder 14B</span>\n                <span class=\"mut\" style=\"font-size:13px;line-height:19px\">Q4_K_M at an 8k context</span>\n              </div>\n              <span class=\"pill warn\" style=\"flex-shrink:0\">Runs with tradeoffs</span>\n            </div>\n            <span class=\"faint\" style=\"font-size:13px;line-height:19px\">Needs 11.1 GB of the 12 GB available.</span>\n          </div>\n        </div>",
  "4": "<div class=\"crop app\">\n          <div class=\"box\" style=\"border-color:var(--warn-line);background:var(--warn-soft);overflow:hidden\">\n            <div style=\"padding:13px 15px;display:flex;align-items:center;gap:10px\">\n              <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"var(--warn-line)\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" style=\"flex-shrink:0\"><path d=\"M12 9.5v4.2M12 17.4h.01M10.4 4.2 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.6 4.2a2 2 0 0 0-3.2 0z\"/></svg>\n              <span class=\"h2\" style=\"flex:1\">Install one package</span>\n              <span class=\"pill warn\">Network</span>\n            </div>\n            <pre class=\"m\" style=\"margin:0 15px;padding:9px 11px;border-radius:6px;background:var(--bg);border:1px solid var(--line);font-size:13px\">npm install --save-dev jsdom</pre>\n            <div style=\"padding:12px 15px 14px;display:flex;gap:8px;flex-wrap:wrap\">\n              <span class=\"btn btnp btns\">Allow once</span>\n              <span class=\"btn btns\">Always allow npm install here</span>\n              <span class=\"btn btns\">Deny</span>\n            </div>\n          </div>\n        </div>",
  "5": "<div class=\"crop app\">\n          <div style=\"display:flex;align-items:center;gap:9px;margin-bottom:10px\">\n            <span class=\"h3\" style=\"flex:1\">2 files changed</span>\n            <span class=\"m num\" style=\"color:var(--ok)\">+46</span>\n            <span class=\"m num\" style=\"color:var(--bad)\">&minus;12</span>\n          </div>\n          <div class=\"m box\" style=\"font-size:13px;line-height:20px;padding:8px 0;overflow:hidden;margin-bottom:10px\">\n            <div style=\"padding:0 12px;color:var(--mut)\">import { useState } from 'react'</div>\n            <div style=\"padding:0 12px;background:var(--bad-soft);border-left:2px solid var(--bad-line);color:var(--bad)\">- const [tasks, setTasks] = useState([])</div>\n            <div style=\"padding:0 12px;background:var(--ok-soft);border-left:2px solid var(--ok-line);color:var(--ok)\">+ import { useTasks } from './useTasks'</div>\n          </div>\n          <div style=\"display:flex;gap:8px\"><span class=\"btn btnp btns\">Keep changes</span><span class=\"btn btns\">Revert all</span></div>\n        </div>"
};

import { DOCS, DOC_GROUPS } from "./data/docs.mjs";

export function extraRoutes({ write, marketing, appPage, part, workspace, esc, models, F, gb }) {
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
      "No configuration file to learn and no inference vocabulary to pick up.") +
      `<section class="mwrap msec" style="padding-bottom:96px">
  <ol class="index" style="list-style:none;margin:0;padding:0">
    ${[
        ["Read the machine", "CPU, memory, video memory, free disk and any runtime already installed, after you agree to it."],
        ["Pick one profile", "One recommendation with the arithmetic shown, and alternatives behind a disclosure."],
        ["Install runtime and weights", "Runtime, weights and a capability self-test in one step, with pause and resume."],
        ["Choose a folder and a permission preset", "File access is limited to that folder, and the preset decides how often the agent asks."],
        ["Work, then review", "Changes arrive as a diff you keep or revert per file and per hunk."],
      ].map(([t, d], i) => `<li style="padding:26px 2px;display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
        <span class="lab num" style="width:24px;flex-shrink:0;padding-top:2px">0${i + 1}</span>
        <div class="stack" style="gap:6px;flex:1;min-width:280px"><span class="h2">${esc(t)}</span>
        <p class="mut" style="margin:0;font-size:14px;line-height:21px;max-width:62ch">${esc(d)}</p></div>
        ${CROPS[i + 1] ?? ""}</li>`).join("\n")}
  </ol>
  <p class="mut" style="margin:30px 0 0;font-size:14.5px;line-height:23px;max-width:70ch">
    These five steps are the designed flow, and the screens above are the real ones. No build is
    published yet, so nothing here downloads or runs a model today.</p>
  <div style="margin-top:22px;display:flex;gap:14px;flex-wrap:wrap">
    <a class="btn btnp btnl" href="/download/">View downloads</a>
    <a class="btn btnl" href="/models/">Browse models first</a>
  </div>
</section>`,
  }));

  /* ----------------------------------------------------------- /download/ */
  write("download/index.html", marketing({
    path: "/download/", title: "Download ForgeLocal",
    desc: "Windows build, system requirements, checksum and release notes.",
    main: head("Download", "ForgeLocal is not available to download yet", "Join the waitlist to hear when the first signed Windows build is ready.") +
      `<section class="mwrap msec" style="padding-bottom:44px">
  <div class="index">
    <div class="strow" style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:22px 2px">
      <div>
        <span class="t" style="font-size:17px;line-height:25px">Windows 10 and 11, 64-bit</span>
        <p class="d" style="margin-top:5px;max-width:62ch">x64 and ARM64.</p>
        <p class="d" style="margin-top:6px;color:var(--faint)" data-platform-note>
          Detected platform appears here. macOS and Linux builds are not available yet.</p>
      </div>
      <a class="btn btnp btnl" style="justify-self:end" href="/waitlist/?plan=beta">Join the Windows beta</a>
    </div>
  </div>
</section>

<section class="mwrap msec" style="padding-bottom:44px">
  <h2 class="h2" style="font-size:20px;margin-bottom:12px">System requirements</h2>
  <div style="overflow-x:auto"><table class="tbl flat" style="min-width:560px">
    <thead><tr><th>Component</th><th>Minimum</th><th>Comfortable</th></tr></thead>
    <tbody>
      <tr><td>System memory</td><td class="num">16 GB</td><td class="num">32 GB</td></tr>
      <tr><td>Video memory</td><td class="num">None, CPU only</td><td class="num">8 GB or more</td></tr>
      <tr><td>Free disk</td><td class="num">12 GB</td><td class="num">60 GB</td></tr>
      <tr><td>OS</td><td>Windows 10 22H2</td><td>Windows 11</td></tr>
    </tbody>
  </table></div>
  <p class="mut" style="margin:16px 0 0;font-size:14.5px;line-height:23px;max-width:70ch">
    A machine with no discrete GPU still works. It runs smaller profiles on the CPU, and the app
    says so plainly rather than recommending something that will crawl.
    <a href="/models/">See what fits which machine</a>.
  </p>
</section>

<section class="mwrap msec" style="padding-bottom:72px">
  <div style="border-top:1px solid var(--line);padding-top:24px;display:grid;grid-template-columns:220px minmax(0,1fr);gap:8px 32px">
    <h2 class="h2" style="font-size:17px;line-height:25px">Verifying what you downloaded</h2>
    <div>
      <p class="mut" style="margin:0;font-size:14.5px;line-height:23px;max-width:68ch">
        Releases will be signed and published with a SHA-256 checksum next to the installer, and the
        current signing certificate will be named on this page. None of that exists yet, so no
        signature, hash or version is shown. When there is one, it will be here rather than in a
        marketing claim.
      </p>
      <p style="margin:14px 0 0;display:flex;gap:22px;flex-wrap:wrap">
        <a class="link" href="/changelog/">Release notes</a>
        <a class="link" href="/status/">Service status</a></p>
    </div>
  </div>
</section>`,
  }));

  /* ------------------------------------------------------------ /pricing/ */
  /* One surface, three columns, shared baselines. The recommended plan is
     marked by a tonal column and an eyebrow, not by an outline. */
  const plan = (name, monthly, blurb, feats, cta, primary, unit = "") => `
  <div class="plan${primary ? " is-rec" : ""}">
    <span class="plan-eyebrow">${primary ? "Recommended" : "&nbsp;"}</span>
    <span class="h2">${esc(name)}</span>
    <div class="plan-price">
      <span class="num"${monthly ? ` data-price-monthly="${monthly}"` : ""}>${monthly ? `$${monthly}` : "$0"}</span>
      ${monthly ? `<span class="mut"><span data-price-unit>${unit}</span><span data-price-period>/month</span></span>` : `<span class="mut">forever</span>`}
    </div>
    <span class="faint plan-note"${monthly ? ` data-price-note style="visibility:hidden"` : ``}>${monthly ? "Billed yearly, two months free" : "No account needed"}</span>
    <p class="plan-blurb">${esc(blurb)}</p>
    <ul class="plan-feats">
      ${feats.map((f) => `<li>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <span>${esc(f)}</span></li>`).join("")}
    </ul>
    <div class="plan-cta">${cta}</div>
  </div>`;

  write("pricing/index.html", marketing({
    path: "/pricing/", title: "Pricing — ForgeLocal",
    desc: "Local use is free and unmetered. Paid plans cover the compatibility work, not your GPU.",
    main: head("Pricing", "Your compute is never metered",
      "Nothing is on sale yet: these are the prices we intend to charge. Running a model on your own hardware is free and always will be, and what you can pay for is the compatibility work.") +
      `<section class="mwrap msec" style="padding-bottom:64px">
  <div class="billing">
    <span id="billing-label">Billing</span>
    <div class="seg" role="group" aria-labelledby="billing-label">
      <button type="button" data-billing="monthly" aria-pressed="true">Monthly</button>
      <button type="button" data-billing="yearly" aria-pressed="false">Yearly &middot; two months free</button>
    </div>
  </div>

  <div class="plans">
    ${plan("Free", null, "Everything you need to work locally.", [
        "Unlimited local model use, never metered",
        "Hardware scan and one tested recommendation",
        "Files, Git, terminal, diff, preview and rollback",
        "Up to three active projects",
      ], `<a class="btn btnl" href="/download/" style="width:100%">View downloads</a>`, false)}
    ${plan("Pro", 15, "For people who live in it.", [
        "Unlimited projects",
        "Full verified profile matrix and updates",
        "Automations and background tasks",
        "Advanced recovery and diagnostics",
      ], `<a class="btn btnp btnl" href="/waitlist/?plan=pro" style="width:100%">Join the Pro waitlist</a>`, true)}
    ${plan("Team", 30, "Per user. Shared standards across a team.", [
        "Shared profiles and project policies",
        "Permission presets and an audit trail",
        "Centralized billing",
        "Private blueprint library",
      ], `<a class="btn btnl" href="/waitlist/?plan=team" style="width:100%">Join the Team waitlist</a>`, false, " / user")}
  </div>
</section>
<section class="mwrap msec" style="padding-bottom:24px">
  <div style="max-width:820px">
    <h2 class="h2" style="font-size:20px;margin-bottom:6px">Frequently asked questions</h2>
    <div class="faq">
      ${[
        ["Do I pay for tokens?", "Not for local use: a model on your own GPU costs electricity, not credits. A cloud provider, if you connect one, is billed against a cap you set and is off by default."],
        ["What happens if I stop paying?", "The app keeps working locally with the profiles you already have. You stop receiving new verified profiles and Pro features."],
        ["Is there a refund?", "Cancel any time and the plan runs to the end of the period you paid for."],
        ["Do I need an account?", "Not for local use. An account exists for billing and for syncing settings between machines."],
      ].map(([q, a]) => `<details><summary>${esc(q)}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg></summary>
      <p>${esc(a)}</p></details>`).join("\n")}
    </div>
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
  /* These pages are mostly one honest sentence each. They share the ruled
     editorial index rather than each getting a white card stranded in a wide
     empty page: rules top and bottom, rows divided by 1px, and a measure that
     matches the amount of text actually on the page. */
  const page = (path, title, kicker, h1, lede, body, measure = "measure", compact = false) =>
    write(`${path}index.html`, marketing({
      path, title: `${title} — ForgeLocal`, desc: lede, compact,
      main: head(kicker, h1, esc(lede)) +
        `<section class="mwrap msec" style="padding-bottom:72px">
        <div class="${measure}">${body}</div></section>`,
    }));

  /* /docs/ and /docs/<slug>/ ------------------------------------------------
     Written, not stubbed. Every article documents behaviour this build
     actually defines; where a feature does not exist, the article says so
     rather than inventing instructions for it. */
  const docNav = (current) => `<nav class="docnav" aria-label="Documentation">
    ${DOC_GROUPS.map(([g]) => `<div class="docnav-g">
      <span class="lab">${esc(g)}</span>
      ${DOCS.filter((d) => d.group === g).map((d) => `<a href="/docs/${d.slug}/"${
        d.slug === current ? ' aria-current="page" class="on"' : ""}>${esc(d.title)}</a>`).join("\n")}
    </div>`).join("\n")}
  </nav>`;

  const docBlock = (b) => {
    const [k, v] = b;
    if (k === "p") return `<p>${esc(v)}</p>`;
    if (k === "note") return `<p class="docnote">${esc(v)}</p>`;
    if (k === "code") return `<pre class="m doccode"><code>${esc(v)}</code></pre>`;
    if (k === "list") return `<ul class="doclist">${v.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (k === "steps") return `<ol class="doclist">${v.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
    if (k === "kv") return `<dl class="dockv">${v.map(([a, c]) =>
      `<div><dt>${esc(a)}</dt><dd>${esc(c)}</dd></div>`).join("")}</dl>`;
    return "";
  };

  DOCS.forEach((d, i) => {
    const prev = DOCS[i - 1], next = DOCS[i + 1];
    write(`docs/${d.slug}/index.html`, marketing({
      path: `/docs/${d.slug}/`, title: `${d.title} — ForgeLocal docs`, desc: d.lede, compact: true,
      main: `<section class="mwrap docwrap">
  ${docNav(d.slug)}
  <article class="docbody">
    <p class="docbreadcrumb"><a href="/docs/">Docs</a> <span aria-hidden="true">/</span> ${esc(d.group)}</p>
    <h1 class="mh2" style="font-size:34px;line-height:42px">${esc(d.title)}</h1>
    <p class="mlede" style="margin-top:12px">${esc(d.lede)}</p>
    <p class="docmeta"><span class="num">${d.read} min read</span> &middot; Describes the behaviour this build defines</p>
    ${d.sections.map((s) => `<section class="docsec">
      <h2>${esc(s.h)}</h2>
      ${s.blocks.map(docBlock).join("\n")}
    </section>`).join("\n")}
    <nav class="docpn" aria-label="More documentation">
      ${prev ? `<a href="/docs/${prev.slug}/"><span class="lab">Previous</span><span class="t">${esc(prev.title)}</span></a>` : "<span></span>"}
      ${next ? `<a href="/docs/${next.slug}/" class="nx"><span class="lab">Next</span><span class="t">${esc(next.title)}</span></a>` : "<span></span>"}
    </nav>
  </article>
</section>`,
    }));
  });

  write("docs/index.html", marketing({
    path: "/docs/", title: "Docs — ForgeLocal", compact: true,
    desc: "Models, memory, permissions, review and troubleshooting for a local coding agent.",
    main: head("Documentation", "Docs",
      esc("How models are chosen, what permissions guarantee, how changes are reviewed, and what to do when something stops.")) +
      `<section class="mwrap msec" style="padding-bottom:80px">
  <div class="measure-w">
    ${DOC_GROUPS.map(([g]) => `<section class="docgroup">
      <h2 class="docgroup-h">${esc(g)}</h2>
      <div class="doclist-nav">
        ${DOCS.filter((d) => d.group === g).map((d) => `<a class="docitem" href="/docs/${d.slug}/">
          <span class="t">${esc(d.title)}</span>
          <span class="s num">${d.read} min</span>
        </a>`).join("\n")}
      </div>
    </section>`).join("\n")}
    <p class="mut" style="margin:30px 0 0;font-size:14px;line-height:22px;max-width:70ch">
      These describe the behaviour this build defines. Parts that are not built yet are named as such.</p>
  </div>
</section>`,
  }));

  /* /changelog/ — an empty release timeline, deliberately empty rather than a
     placeholder component. */
  page("changelog/", "Changelog", "Releases", "Changelog",
    "Versions, changes, fixes and known issues.",
    `<p class="mut" style="margin:0;font-size:15px;line-height:24px;max-width:66ch">
      No releases yet. Each one will list its version, date, changes, fixes, known issues and a
      download link with its checksum.</p>
`, "measure", true);

  /* /status/ — a real status table. State is a dot plus its own words, so the
     meaning does not depend on colour, and four identical capsules are gone. */
  page("status/", "Status", "Status", "Service status",
    "Account, downloads and optional cloud providers.",
    `<p class="mut" style="margin:0 0 22px;font-size:15px;line-height:24px;max-width:70ch">
      No hosted services are deployed yet.</p>
    <div class="index">
      <div class="strow strow-head" style="padding-top:12px;padding-bottom:12px;min-height:0">
        <span class="lab-fn" style="color:var(--faint)">Service</span>
        <span class="lab-fn" style="color:var(--faint)">What it affects</span>
        <span class="lab-fn" style="justify-self:end;color:var(--faint)">State</span>
      </div>
      ${[["Local app", "Runs on your machine.", "", "Independent of hosted status"],
         ["Profile registry", "Serves signed profile manifests. Cached locally, so an outage does not block work.", "", "Not deployed"],
         ["Downloads", "Weights come from the publisher, not from us.", "", "Not deployed"],
         ["Accounts and billing", "Only needed for paid plans.", "", "Not deployed"]]
        .map(([n, d, tone, state]) => `<div class="strow">
          <span class="t">${esc(n)}</span>
          <p class="d">${esc(d)}</p>
          <span class="s">${esc(state)}</span>
        </div>`).join("\n")}
    </div>
    <p class="mut" style="margin:20px 0 0;font-size:14.5px;line-height:23px;max-width:70ch">
      Component status and incident history appear here once something is running.</p>`,
    "measure", true);

  /* /privacy/ — a plain-language document, not content inside a card. */
  page("privacy/", "Privacy", "Legal", "Privacy",
    "What stays on your machine, and what does not.",
    `<div class="doc">
      ${[["What stays local", "Your project files, your prompts and the model's replies are processed on your machine while you are using a local model. They are not transmitted to us."],
         ["What is optional", "Crash reports, anonymous usage counts and contributed profile test results are three separate switches, all off on a fresh install. The diagnostics report is built on demand, shown to you in full, and redacted before it can be sent anywhere."],
         ["What changes if you connect a cloud provider", "Then the task summary and the file contents it names go to that provider under their terms. It is asked per task, never once at setup."]]
        .map(([t, d]) => `<section>
          <h2>${esc(t)}</h2>
          <p>${esc(d)}</p>
        </section>`).join("\n")}
    </div>
    <section id="collected" style="padding-top:26px;border-top:1px solid var(--line-soft);margin-top:26px">
      <h2>Field by field</h2>
      <p>Every switch is off on a fresh install, so by default the rows below never leave the
        machine. This is what each one would contain if you turned it on.</p>
      ${[["Crash reports", "When the app stops unexpectedly",
          ["Exception type and stack trace, with file paths inside the app only",
            "App version, build id and runtime version",
            "Windows version and graphics driver version",
            "Which model was loaded, by name and quantization"],
          ["Your project path, file names or file contents",
            "Prompts, replies or anything typed into the composer",
            "Any identifier that links two reports to the same person"]],
        ["Anonymous usage counts", "Batched, at most once a day",
          ["Counts of features used: chats started, tasks run, models loaded",
            "Which permission preset is set, as one of three values",
            "Whether a task ended in keep, revert or stop"],
          ["Prompt text, code, file names or project names",
            "Timestamps precise enough to reconstruct a session",
            "Any identifier that links two days of counts together"]],
        ["Contributed profile results", "Once, after a model is first loaded",
          ["Graphics card model and video memory size",
            "The model, quantization and context that was loaded",
            "Whether it loaded, and measured throughput if it ran"],
          ["Anything about your project or your code",
            "Your machine name, user name or network address",
            "Anything that identifies the machine beyond its hardware class"]],
        ["Diagnostics report", "Only when you build one and choose to send it",
          ["The task log, with absolute paths reduced to their project-relative form",
            "The context around the failure: model, runtime, mode, checkpoint",
            "Anything you leave in after reading it"],
          ["Anything matching a secret pattern, removed before it is shown to you",
            "Anything you delete from the report before sending",
            "Anything at all unless you press send, because it is built on demand"]]]
        .map(([name, when, sends, never]) => `<div class="cfrow">
          <div class="cfrow-h"><span class="t">${esc(name)}</span><span class="lab">${esc(when)}</span></div>
          <div class="cfrow-b">
            <div><span class="lab-fn ok-t">Includes</span>
              <ul>${sends.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
            <div><span class="lab-fn">Never includes</span>
              <ul>${never.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          </div>
        </div>`).join("\n")}
      <p style="margin-top:18px">Turning a switch off stops the next send. There is no queue that
        drains afterwards, because nothing is collected while the switch is off.</p>
    </section>
    <p class="mut" style="margin:0;padding-top:22px;border-top:1px solid var(--line);font-size:14px;line-height:23px">
      This is a plain-language summary of intended behavior, not a legal policy. A reviewed policy
      will be published before any build ships, and it will describe what the code actually does
      rather than what the design hoped for.</p>`,
    "measure-doc", true);

  /* /terms/ — a deliberate unpublished state, not a card and not fake legal
     text. Same ruled document language as Privacy, one row instead of three. */
  page("terms/", "Terms", "Legal", "Terms",
    "The agreement covering use of ForgeLocal.",
    `<dl class="index" style="margin:0">
      <div class="strow" style="grid-template-columns:180px minmax(0,1fr)">
        <dt class="t" style="font-weight:400;color:var(--faint);font-size:14px">Status</dt>
        <dd style="margin:0"><span class="t" style="display:block">Not published yet</span>
          <p class="d" style="margin-top:6px">Terms will be published before the first build ships.
            Writing placeholder legal text would be worse than saying it is not ready.</p></dd>
      </div>
      <div class="strow" style="grid-template-columns:180px minmax(0,1fr)">
        <dt class="t" style="font-weight:400;color:var(--faint);font-size:14px">In the meantime</dt>
        <dd style="margin:0"><p class="d" style="margin:0">What ForgeLocal does with your data is
          described in plain language on the <a href="/privacy/">privacy page</a>, and the boundary
          the agent runs inside is described on the <a href="/security/">security page</a>.</p></dd>
      </div>
    </dl>`,
    "measure-doc", true);

  /* ------------------------------------------------------------ /waitlist/ */
  /* There is no authentication, so the product does not draw an authentication
     form. The page reads its intent from the URL and says exactly what it
     records. A focused shell, not the full marketing page, because the task is
     one field long. */
  write("waitlist/index.html", marketing({
    path: "/waitlist/", title: "Waitlist — ForgeLocal", compact: true,
    desc: "ForgeLocal is not open yet. Leave an address and we will write once it is.",
    main: `
<section class="mwrap msec authwrap">
  <div class="authcard">
    <span class="lab" data-wl-kicker>Pro</span>
    <h1 class="mh2" style="font-size:28px;margin-top:8px" data-wl-h1>Join the Pro waitlist</h1>
    <p class="mut" style="margin:12px 0 0;font-size:15px;line-height:24px" data-wl-lede>
      Pro is not open yet. Leave an address and we will write once when it is, and not otherwise.</p>

    <form data-waitlist novalidate style="margin-top:22px;display:flex;flex-direction:column;gap:14px">
      <div class="stack" style="gap:8px">
        <label class="h3" for="wl-email">Email</label>
        <span class="field"><input id="wl-email" name="email" type="email" autocomplete="email"
          placeholder="you@example.com" aria-describedby="wl-help wl-error" required></span>
        <p class="faint" id="wl-help" style="margin:0;font-size:13px;line-height:20px">
          Used for this one announcement. No account is created and nothing is shared.</p>
        <p id="wl-error" role="alert" data-wl-error hidden
          style="margin:0;font-size:13px;line-height:20px;color:var(--bad)"></p>
      </div>
      <button class="btn btnp btnl" type="submit" data-wl-submit disabled>
        <span data-wl-cta>Join the Pro waitlist</span></button>
    </form>

    <div data-wl-done hidden style="margin-top:22px">
      <p style="margin:0;display:flex;align-items:flex-start;gap:10px;font-size:15px;line-height:24px">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:4px"><path d="M20 6 9 17l-5-5"/></svg>
        <span><strong data-wl-done-t>You are on the list.</strong><br>
        <span class="mut">Nothing was sent and nothing was stored: this is a wireframe, and the form
        is here so the flow can be reviewed end to end.</span></span></p>
      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="/models/">Browse models</a>
        <a class="btn" href="/docs/">Read the docs</a>
      </div>
    </div>

    <p class="faint" style="margin:22px 0 0;font-size:13px;line-height:20px">
      ForgeLocal runs models on your own machine. An account is only ever needed for a paid plan,
      never for local use. <a class="link" href="/privacy/">What we collect</a>.</p>
  </div>
</section>`,
  }));

  /* ---------------------------------------------------------------- /404 */
  write("404.html", marketing({
    path: "/", title: "Page not found — ForgeLocal", desc: "That page does not exist.", compact: true,
    main: `<section class="mwrap msec" style="padding:96px 32px 120px">
      <div class="stack" style="gap:16px;max-width:520px">
        <span class="lab num">404</span>
        <h1 class="mh2">That page does not exist</h1>
        <p class="mlede">The link may be old, or the page may not be built yet.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding-top:6px">
          <a class="btn btnp" href="/">Home</a>
        </div>
      </div></section>`,
  }));

  /* ------------------------------------------------------- app + setup ---- */
  // Four conversation routes, one shell. Each supplies a thread id and the
  // sidebar/topbar context; the conversation itself is rendered from data.
  const convo = [
    ["app/", "Workspace", "new", "New session", ""],
    ["app/running/", "Working", "s1", "Persist tasks to localStorage", "route:running"],
    ["app/permission/", "Permission request", "s1", "Persist tasks to localStorage", "route:permission"],
    ["app/stopped/", "Stopped", "s3", "Switch the date helper to Temporal", "route:stopped"],
  ];
  for (const [path, title, active, header, thread] of convo) {
    write(`${path}index.html`, appPage({ title: `${title} — ForgeLocal`,
      body: workspace({ active, title: header, thread }) }));
  }
  const appRoutes = [
    ["app/", "Workspace", "Workspace"],
    ["app/running/", "Workspace", "Working"],
    ["app/permission/", "Workspace", "Permission request"],
    ["app/review/", "WsReview", "Review changes"],
    ["app/stopped/", "Workspace", "Stopped"],
    ["app/settings/", "Settings", "Settings"],
    ["app/models/", "ModelsExplore", "Models"],
    ["app/models/installed/", "ModelsMine", "My models"],
    ["app/models/downloads/", "ModelsDownloads", "Downloads"],
  ];
  for (const [path, p, title] of appRoutes) {
    if (!["WsReview", "ModelsExplore", "ModelsMine", "ModelsDownloads", "Settings"].includes(p)) continue;
    write(`${path}index.html`, appPage({ title: `${title} — ForgeLocal`, body: part(p) }));
  }

  const setup = [["Ob1Welcome", "Welcome"], ["Ob2Recommendation", "Recommendation"],
    ["Ob3Install", "Install"], ["Ob4Project", "Project and permissions"], ["Ob5FirstChat", "First chat"]];
  setup.forEach(([p, title], i) => {
    write(`setup/${i + 1}/index.html`, appPage({ title: `Setup ${i + 1} of 5: ${title} — ForgeLocal`, body: part(p) }));
  });

  return { appRoutes, setup };
}
