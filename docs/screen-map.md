# Complete product screen map and UI direction for Claude

Use this document with the accompanying screenshots as the visual and interaction brief for a local-model coding agent. The screenshots are references for information architecture, density, hierarchy, and interaction quality—not assets to reproduce verbatim.

Build a clean-room product with its own name, logo, copy, iconography, colors, and components. Do not copy competitor source code, proprietary assets, exact page copy, or distinctive branded illustrations.

## Product in one sentence

The app detects what the user's computer can run, installs a suitable open model, gives that model safe coding tools, and lets the user build and review software from one desktop workspace.

## Reference strategy

Use two primary references because neither product solves the whole problem alone:

- **LM Studio Bionic** is the closest product-architecture reference. Study its project/session model, chat-plus-artifact workspace, local model library, model picker, load/eject actions, and hardware-conscious model information.
- **Cursor** is the quality reference for professional coding-agent behavior. Study its plan/build/review flow, diffs, terminal activity, permission modes, agent status, parallel work, pricing clarity, and restrained visual system.

The result should feel like a purpose-built local AI assistant—not a generic SaaS dashboard or an IDE clone. The default experience should be as immediately understandable as ChatGPT or LM Studio: open the app, choose a project, and start a conversation.

## Locked workspace direction

The primary workspace is **conversation-first and intentionally simple**.

- Use ChatGPT's calm reading experience and LM Studio's project/model controls as the main inspiration.
- The normal screen contains only a collapsible history sidebar, a centered conversation, a small top bar, and a bottom composer.
- Do not show a permanent file tree, terminal, diff, or preview beside every conversation.
- Files, Diff, Preview, Problems, and Terminal open in one contextual right drawer only when requested or when the agent produces something worth inspecting.
- Closing the drawer returns the interface to a clean chat layout without losing state.
- Advanced controls stay inside small menus and popovers. A beginner should be able to ignore them.
- Cursor references are for agent behavior, review quality, and permissions—not for copying an IDE-heavy default layout.

## Product architecture

There are two connected products:

1. **Public web app** for marketing, model browsing, downloads, pricing, authentication, account, billing, and documentation.
2. **Desktop app** for hardware detection, runtime and model management, projects, agent chat, files, diffs, terminal commands, preview, permissions, automations, and settings.

A normal website cannot safely read arbitrary local folders or execute PowerShell by itself. Keep privileged actions in a signed local desktop process. The web product may deep-link into the installed app.

## The primary user journey

`Landing page → Download → Hardware scan → Runtime setup → Recommended model → Choose project folder → Permission preset → First agent task → Review changes → Keep or revert`

The first-run experience should end inside a useful project session. Do not end onboarding on a dashboard.

## Information architecture

### Web navigation

- Product
- Models
- Download
- Pricing
- Docs
- Sign in / Account

### Desktop navigation

Use a ChatGPT-style collapsible left sidebar. It is open on wide screens and becomes a temporary overlay when space is limited. Do not create a separate top-level page for every tool.

- New session
- Projects
- Recent sessions
- Models
- Automations
- Tools
- Settings

Preview, Diff, Files, Problems, and Terminal share one contextual drawer inside the workspace. They are not five separate dashboard pages and they are not visible by default.

## Screen inventory

Priorities:

- **P0**: required for the first coherent product demo and MVP.
- **P1**: required before a serious public beta.
- **P2**: useful later; establish the route and empty state but do not overbuild it now.

### Public web screens

| Priority | Screen | Purpose | Required content | Primary reference |
| --- | --- | --- | --- | --- |
| P0 | Marketing home | Explain the promise and prove the product immediately | Restrained hero, Download CTA, Explore models secondary action, real product demo, hardware/privacy proof, use cases, testimonials, FAQ | `01-cursor-home-hero.jpg`, `02-cursor-agent-workspace.jpg`, `16-lmstudio-bionic-home.jpg` |
| P0 | Product / How it works | Show the complete workflow | Detect hardware, choose model, plan, edit, run, review, recover; use real interface crops rather than abstract feature icons | `12-cursor-product-hero.jpg`, `13-cursor-codebase-context.jpg`, `14-cursor-plan-design-review.jpg`, `18-lmstudio-agent-features.jpg` |
| P0 | Model catalog | Let people browse before installing | Search, task filters, hardware-fit filter, size, quantization, context, license, source, installed state | `19-lmstudio-model-catalog.jpg` |
| P0 | Model detail | Help a user make a safe choice | Description, coding strengths, limitations, verified tasks, compatible hardware, variants, memory and disk needs, expected speed, license, Download / Open in app | `20-lmstudio-model-detail.jpg` |
| P0 | Download | Get the correct desktop build | Detect OS, primary installer, Windows/macOS/Linux alternatives, version, system requirements, checksum, release notes, CLI option | `10-cursor-download-surfaces.jpg`, `11-cursor-platform-download-grid.jpg` |
| P0 | Pricing | Explain what is local versus paid | Free/Pro/Team, monthly/yearly toggle, local compute statement, optional cloud usage, FAQ | `08-cursor-pricing-monthly.jpg`, `09-cursor-pricing-toggle.jpg`, `15-cursor-faq-accordion.jpg` |
| P1 | Sign in / Create account | Authenticate without blocking local use | Email/OAuth, device-link option, clear statement that an account is optional for local-only use if that is the policy | Original design using shared form primitives |
| P1 | Account / Billing | Manage subscription and devices | Plan, invoices, payment method, signed-in devices, cloud budget, usage, delete/export account | Use pricing visual language; do not imitate a Stripe portal |
| P1 | Documentation / Help | Explain setup and trust boundaries | Search, quick start, models, permissions, troubleshooting, privacy, keyboard shortcuts | Quiet editorial layout related to `15-cursor-faq-accordion.jpg` |
| P2 | Changelog / Releases | Build confidence in an installed desktop product | Version filters, concise release notes, download links | Download page language |

### Desktop onboarding screens

Use one focused question per screen, a quiet progress indicator, and a Back action. Always show download size and storage location before fetching a large model.

| Priority | Screen | Required behavior |
| --- | --- | --- |
| P0 | Welcome | Explain that files stay local by default; choose Quick setup or Advanced setup. |
| P0 | Hardware scan | Detect OS, CPU, RAM, GPU, VRAM, free disk, and driver/runtime status. Translate the result into plain language such as “Fast,” “Usable,” or “Not recommended.” |
| P0 | Runtime setup | Detect, install, connect, repair, or update the supported runtime. Show a compact log only under Details. |
| P0 | Recommended model | Recommend one coding profile with a reason. Offer “Faster,” “Balanced,” and “More capable” alternatives. Show download size, memory range, privacy, and estimated speed band. |
| P0 | Model download | Persistent progress with bytes, percentage, speed, remaining time, destination, Pause, Resume, Cancel, and Retry. Downloads must survive navigation. |
| P0 | Project setup | Name the project, choose an existing folder or starter template, select Git behavior, and explain exactly which folder the agent can access. |
| P0 | Permission preset | Choose Review each action, Balanced, or Trusted workspace. Show the concrete effects on file writes, commands, network, and paths outside the project. |
| P0 | First success | Open the real workspace with a short starter task already suggested. Never finish on a congratulatory dead end. |
| P1 | Optional cloud setup | BYOK or metered cloud fallback, budget cap, and clear local/cloud routing indicator. Keep this skippable. |

### Desktop core screens

| Priority | Screen | Purpose | Primary reference |
| --- | --- | --- | --- |
| P0 | Workspace: empty | Present a calm, centered ChatGPT-style first prompt | `25-bionic-coding-full-resolution.png`, `31-bionic-document-workspace-full-resolution.png` |
| P0 | Workspace: agent running | Keep the conversation primary while showing a concise, chronological execution trace | `03-cursor-plan-and-review.jpg`, `04-cursor-cloud-agent.jpg`, `25-bionic-coding-full-resolution.png` |
| P0 | Permission request | Scope and explain a risky action before it runs | `28-cursor-run-modes.jpg` plus the permission-card specification below |
| P0 | Change review | Review a multi-file result without leaving the session | `03-cursor-plan-and-review.jpg`, `14-cursor-plan-design-review.jpg` |
| P0 | Project/session history | Reopen work and understand its status | `04-cursor-cloud-agent.jpg`, `25-bionic-coding-full-resolution.png` |
| P0 | Models: Explore | Find and install compatible models | `19-lmstudio-model-catalog.jpg`, `20-lmstudio-model-detail.jpg` |
| P0 | Models: My Models | Load, eject, delete, inspect, and set defaults | `23-bionic-model-library-doc.jpg`, `26-bionic-local-models-full-resolution.png` |
| P0 | Model picker | Change model without leaving the composer | `07-cursor-model-selector.jpg`, `24-bionic-model-picker-doc.jpg`, `27-bionic-model-picker-full-resolution.png` |
| P1 | Runtime / performance | Inspect loaded models and resource use | Extend the My Models visual language with RAM/VRAM, context, queue, unload timer, and runtime status |
| P1 | Automations | Schedule bounded background work | `06-cursor-automation-builder.jpg` |
| P1 | Tools / integrations | Enable built-in tools, MCP servers, and credentials | `05-cursor-tool-integrations.jpg` |
| P1 | Permissions / security | Edit global defaults and workspace overrides | `28-cursor-run-modes.jpg` |
| P1 | Settings | General, appearance, models, runtime, storage, network, privacy, notifications, shortcuts, advanced | Use native desktop settings density; no card grid |
| P1 | Recovery center | Explain failures and restore a safe state | Dedicated states for out-of-memory, runtime offline, invalid tool call, repeated loop, context limit, interrupted download, failed test, and partial edit |
| P2 | Multi-agent view | Compare or monitor concurrent tasks | `29-cursor-agents-window.jpg` |

## The core workspace

The workspace is the product. Give it most of the design and implementation attention. Its default state must look closer to ChatGPT or LM Studio than to VS Code: quiet, centered, and conversation-led.

### Desktop composition

At 1280px and wider, use two stable regions and one optional drawer:

1. **Collapsible left sidebar: 240–268px**
   - New session button
   - Project switcher
   - Sessions grouped by Today, Yesterday, and Earlier
   - Status dot or compact result icon
   - Models, Automations, Tools, and Settings anchored near the bottom
   - Collapse completely, leaving one small menu button rather than a permanent icon rail

2. **Conversation: flexible and visually centered**
   - Use a readable content column around 760–860px wide with generous outer space
   - Project title and a minimal set of controls in the top bar
   - User requests and agent results
   - Chronological plan/tool/edit/test events
   - Composer centered and sticky near the bottom, with breathing room below it
   - Keep assistant responses mostly unboxed, like a document; use containers only for commands, permissions, downloads, diffs, and errors
   - Do not place the full conversation inside a floating rounded card

3. **Context drawer: hidden by default, 420–560px when open**
   - Tabs: Preview, Diff, Files, Problems, Terminal
   - Slide in from the right after the user clicks a file, Review changes, Open preview, or Terminal
   - May open automatically after an explicit preview request, but should not open for routine background tool calls
   - Remember width and active tab per project
   - Allow maximization and side-by-side comparison
   - Closing it must return to the exact chat scroll position
   - Never cover the composer or an active permission prompt

At 900–1279px, keep the conversation primary, make the sidebar an overlay, and let the context drawer temporarily take roughly half the window. Below 900px, show a single pane at a time and open artifacts full-screen with a clear Back to chat action. The desktop application is primary; mobile web only needs marketing/account support.

### Workspace top bar

- Sidebar toggle and project name
- Small project/folder disclosure with branch when useful
- Quiet local/cloud indicator and selected model on wider screens
- A single activity/Stop control when work is active
- Artifacts button with a count when files, diffs, preview, or terminal output exist
- Share/export and overflow menu
- Keep it 44–48px high with a quiet bottom border
- Avoid a row of IDE tabs. Sessions live in the sidebar; temporary artifacts live in the drawer.

### Conversation anatomy

Use a continuous, readable transcript with minimal chrome:

- User message
- Short agent response
- Plan with checkable steps
- Collapsible tool event
- File edit event with file count and additions/deletions
- Command event with command, working directory, duration, exit code, and expandable output
- Permission request
- Error/recovery notice
- Final result with summary, files changed, tests, unresolved issues, and Review changes CTA

Do not expose hidden reasoning or simulate chain of thought. Show user-relevant actions and concise rationales.

Completed low-risk events collapse into one quiet line such as “Read 4 files” or “Ran tests · 18 passed.” The current event remains expanded. Failed and permission-blocked events stay expanded until resolved. Tool events should support “Show details” without making the normal transcript resemble a terminal log.

### Empty state

Center the empty state vertically above the composer. It should include:

- A plain-language prompt: “What do you want to build or change?”
- The selected project/folder and whether Git is detected
- Up to three quiet text starters, such as “Explain this project,” “Fix a bug,” and “Build a small feature”; do not render them as oversized feature cards
- A visible selected model and device-fit label
- No oversized mascot, gradient orb, or generic feature-card grid

### Composer

The composer should feel familiar to a ChatGPT user: one calm rounded input with a small control row. It must support:

- Multiline input with auto-grow
- Attach file/image and add code context
- `@` file/folder/symbol mentions
- `/` commands and reusable workflows
- Model picker
- Reasoning/effort selector when supported
- Mode: Ask, Plan, Build, shown in one compact selector rather than three permanent buttons
- Permission mode: Review, Balanced, Trusted, placed in a popover or overflow control
- Context use meter with a plain-language warning near the limit
- Local/cloud location indicator
- Send, Stop, and retry
- Keyboard shortcut hint

Keep only Attach, model, optional mode, and Send/Stop visible by default. Put context usage, reasoning, permissions, and less-used controls into a compact options popover unless their state requires attention. Anchor the model popover above the lower-left portion of the composer. Group Recommended, Local, Cloud, and Recently used. Every model row should show provider/location, fit, loaded state, and a concise capability label. See `27-bionic-model-picker-full-resolution.png` and `07-cursor-model-selector.jpg`.

### Context drawer behavior

- One drawer owns Preview, Diff, Files, Problems, and Terminal; never stack multiple auxiliary panes.
- A compact artifact strip may appear above the composer after the agent creates files or launches a preview.
- Clicking an artifact opens the relevant drawer tab.
- Diff and Preview can be maximized for focused work, then return to the same conversation.
- The drawer can be pinned by advanced users, but pinning is an explicit preference—not the default.
- When closed, a small Artifacts control in the top bar preserves discoverability and shows counts or important status.
- On first use, briefly label the drawer tabs; afterward, concise icon-plus-text labels are sufficient.

### Agent state model

The interface must have explicit states. Do not represent all work as streaming prose.

| State | UI treatment | Available actions |
| --- | --- | --- |
| Idle | Quiet composer, no animation | Send task, change model/mode |
| Planning | Active step and subtle pulse | Stop, edit plan when supported |
| Waiting for approval | High-contrast permission card; no hidden execution | Allow once, allow rule, deny, edit request |
| Running tool | Expanded current tool row, elapsed time | Stop; view output |
| Editing | File list and change counts update without layout jumps | Open diff; stop |
| Testing | Command/test row with live output and stable scroll | Open terminal; stop |
| Recovering | Specific cause and next attempt | Stop, choose safer model/settings, open diagnostics |
| Completed | Result summary and review CTA | Review, keep, revert, follow up |
| Failed | Persistent error with exact recovery choices | Retry, switch model, reduce context, restore checkpoint |

### Permission request card

Every permission prompt must answer five questions:

1. What will run or change?
2. Why does the task need it?
3. Where will it operate?
4. What is the risk?
5. What permission will be remembered?

For a command, show the exact command in monospace, working directory, network use, and affected scope. Actions:

- Allow once
- Always allow this exact action in this workspace
- Deny
- Edit command, when safe to support

Never combine “allow everything forever” with the primary action. Treat commands that delete files, alter Git history, install system software, access secrets, use the network, or leave the project root as higher risk.

### Diff and review

Review is part of the conversation outcome, not a separate developer-only tool.

- File tree grouped by Added, Modified, Deleted
- Side-by-side and unified diff modes
- Per-file and per-hunk Keep/Revert
- Keep all / Revert all only after the user can see the scope
- Inline diagnostics and test results
- Summary of uncommitted changes that existed before the agent began
- Checkpoint marker and restore action
- Optional Git commit only after review

Do not overwrite or silently revert pre-existing user changes.

### Terminal

- Each agent command appears in the timeline and Terminal panel
- Show command, working directory, start time, duration, exit code, and output
- Long-running dev servers become managed processes with Open preview and Stop actions
- Hide repetitive output behind a collapsed range while preserving access
- Never display secrets in logs

### Preview

- URL bar for the local preview address
- Refresh, open externally, responsive viewport sizes, screenshot, and console-error count
- Detect common framework dev servers
- Show a useful setup state before a server exists
- Keep preview navigation isolated from privileged desktop APIs

## Models experience

Model management is a primary product area, not a settings subpage.

### Explore

Prefer a dense list or restrained grid. Each result must answer:

- What is this model good at?
- Will it run well on this computer?
- What download size and disk space are required?
- What RAM and VRAM ranges are realistic?
- Which quantization/profile is recommended?
- Is it verified for tool use, file edits, shell commands, and structured output?
- What is its context size and license?
- Is the source trusted?

Filters: Coding, General, Vision, Tool use, Fits this device, Installed, parameter range, quantization, context, license, provider, and format.

### Model detail

Use one strong primary action: Download recommended variant or Use for coding. Put advanced variants below the recommendation, not before it. Include:

- Verified profile version
- Tested runtime version
- Quality/speed tradeoff
- Hardware fit visualization
- Download and installed size
- Expected tokens/second as a broad measured range, never a false guarantee
- Known limitations
- License and original source
- Release/update notes

### My Models

Match the clarity of `26-bionic-local-models-full-resolution.png`:

- Search and capability filters
- Loaded/idle/downloading/error states
- Load, Eject, Use, Update, Reveal files, and Delete actions
- Current RAM/VRAM use
- Default coding profile marker
- Persistent download manager

Deleting a model must state how much disk space will be recovered and must never delete project data.

## Projects and sessions

A **project** owns a root folder, permission overrides, instructions, Git context, environment setup, model preference, and multiple sessions.

A **session** owns a conversation, plan, tool events, checkpoints, changed files, terminal processes, artifacts, selected model, and final status.

Session list status:

- Draft
- Running
- Needs approval
- Ready to review
- Completed
- Failed

Allow rename, archive, duplicate, export transcript, and delete. Deletion should be recoverable when practical and must explain whether files or only conversation history are affected.

## Automations

Use the form hierarchy in `06-cursor-automation-builder.jpg`, but keep automation permissions more explicit:

- Name and task
- Project
- Trigger: schedule, Git event, file change, or manual
- Model/profile
- Permission policy
- Network policy
- Maximum runtime and cloud budget
- Output destination
- Failure notification
- Test run

Automations may not inherit an unrestricted interactive session accidentally. Show the exact policy at save time.

## Tools and integrations

Group by:

- Built-in: files, search, Git, terminal, tests, preview, browser
- MCP servers
- Developer services
- Cloud model providers

Each integration needs status, permissions, last used, credentials location, test action, logs, and disconnect. Avoid a marketplace-style wall of colorful logo cards; use a searchable, compact list.

## Settings structure

Use a left settings list and a single content column. Avoid nested cards.

- General
- Appearance
- Agent behavior
- Models
- Runtime and hardware
- Storage and downloads
- Permissions
- Network and proxy
- Privacy and telemetry
- Notifications
- Keyboard shortcuts
- Account and billing
- Advanced / diagnostics

Show inherited values and workspace overrides distinctly. Settings that can make the product unsafe require explanatory text and confirmation.

## Recovery and error states

Every critical error should explain what happened, what remains safe, and the best next action.

| Error | Required recovery choices |
| --- | --- |
| Model exceeds memory | Lower context, choose smaller profile, offload differently, or use optional cloud model |
| Runtime offline | Restart, repair, inspect log, or reconnect |
| Interrupted model download | Resume, retry, cancel, or change storage location |
| Invalid/malformed tool call | Repair once, switch verified profile, or continue without that tool |
| Repeated/no-progress loop | Stop automatically, show repeated action, restore checkpoint, re-plan, or switch model |
| Context nearly full | Summarize, start a linked session, remove attachments, or use larger-context model |
| Command failed | Show exit code and relevant output; retry, edit, or open Terminal |
| Partial edit | Show affected files, validate syntax, keep valid changes, or restore checkpoint |
| Preview failed | Detect port/process issue, reopen logs, restart server, or choose command manually |

Never use a generic “Something went wrong” toast as the only explanation for a recoverable model or agent failure.

## Visual system

Derive a restrained system from the references, then apply the product's own brand accent.

- Warm or neutral off-white marketing background; neutral near-black desktop shell
- One accent color, used for primary actions, focus, links, and active progress
- Geist Sans, Inter, or another neutral grotesk for UI
- Geist Mono for commands, paths, diffs, model metadata, timings, and logs
- 13–14px default desktop UI text; 15–16px prose; 11–12px metadata
- Marketing headings should be editorial and controlled, not enormous
- 4–8px structural radii; pills only for filters, statuses, and compact controls
- 1px low-contrast borders and tonal surfaces instead of stacks of shadows
- One soft shadow for menus/dialogs only
- Consistent 4px spacing base; most controls 28, 32, 36, or 40px high
- Sentence case everywhere
- Icons should be simple line icons at 16–18px, not emoji

Avoid the common “vibe-coded” signatures:

- No purple-to-blue gradients by default
- No glowing borders or glassmorphism
- No enormous 64–90px marketing headline unless the composition truly supports it
- No dashboard made from identical rounded cards
- No arbitrary mixtures of 12px, 14px, 16px, and 18px text without roles
- No excessive badges
- No fake charts or vanity metrics
- No bounce animations, floating blobs, or decorative particles
- No Lucide icon beside every line of copy
- No placeholder avatars, company logos, or testimonials

## Interaction and motion

Motion should communicate state, not advertise that the UI is animated.

- Hover/focus/color: `120–160ms`
- Popovers and menus: `140–180ms`, opacity plus 4px translation
- Pane open/close: `180–220ms ease-out`
- Tab content: cross-fade without changing the container dimensions
- Active agent: one subtle 2-second opacity pulse on the current status only
- Streaming text: append naturally without moving the composer or stealing scroll position
- Download progress: smooth width interpolation, accurate numeric progress
- Diff insertion/deletion reveal: no typewriter effect
- Keep focus visible and respect `prefers-reduced-motion`
- Never animate layout continuously while the user is reading output

## Critical interaction details

- All popovers close on Escape and restore focus to their trigger.
- Command palette, model picker, session list, and file search support keyboard navigation.
- The optional context-drawer width and last active artifact tab persist locally.
- The current agent can be stopped immediately; stopping must not discard already completed edits.
- Navigating away does not hide an active download or running task.
- Browser refresh or desktop restart can restore session state.
- Use optimistic updates only when rollback is reliable.
- Destructive actions explain the exact scope.
- Local versus cloud execution remains visible at the moment of action, not buried in settings.

## Accessibility

- Meet WCAG AA contrast for text and controls.
- Every control has an accessible name.
- Do not encode agent status, diff type, or hardware fit by color alone.
- Focus order follows the visual pane order.
- Resizable panes are keyboard operable.
- Live regions announce task completion and approval requests, not every streamed token.
- Terminal and diff views have usable high-contrast themes.

## Build order for Claude

Build vertical slices in this order:

1. Design tokens, typography, icon rules, buttons, fields, tabs, popovers, menus, dialogs, status chips, and drawer primitives.
2. Chat-first desktop shell with collapsible project/session history and a hidden-by-default context drawer.
3. Centered workspace empty state, ChatGPT-like composer, model picker, and mocked agent-state timeline.
4. Permission card, command event, edit event, contextual Diff drawer, final review, and revert interaction.
5. Hardware scan, runtime setup, recommendation, download progress, project setup, and first-success onboarding.
6. Explore models, model detail, My Models, load/eject/delete, and runtime health.
7. Marketing home, product, models, download, and pricing pages using the same visual language.
8. Automations, tools, settings, account/billing, and recovery states.
9. Responsive behavior, keyboard navigation, reduced motion, empty/loading/error states, and visual regression checks.

Do not build all routes as static mockups first. Complete the workspace vertical slice so its controls and state transitions establish the real component system.

## Reusable component list

- `AppShell`
- `Sidebar`
- `ProjectSwitcher`
- `SessionList`
- `WorkspaceTopBar`
- `ContextDrawer`
- `ArtifactLauncher`
- `ArtifactTabs`
- `Composer`
- `ModelPicker`
- `ModeSelector`
- `PermissionModeSelector`
- `ContextMeter`
- `AgentTimeline`
- `PlanBlock`
- `ToolEvent`
- `CommandEvent`
- `FileChangeEvent`
- `PermissionCard`
- `ResultSummary`
- `DiffViewer`
- `FileTree`
- `TerminalView`
- `PreviewBrowser`
- `DownloadProgress`
- `HardwareFit`
- `ModelRow`
- `ModelVariantTable`
- `RuntimeStatus`
- `EmptyState`
- `InlineError`
- `RecoveryPanel`
- `Toast`
- `CommandPalette`

## Screenshot map

### Cursor references

| File | Study this |
| --- | --- |
| `01-cursor-home-hero.jpg` | Restrained marketing hero and CTA hierarchy |
| `02-cursor-agent-workspace.jpg` | Product interface as homepage proof |
| `03-cursor-plan-and-review.jpg` | Plan, agent activity, and review composition |
| `04-cursor-cloud-agent.jpg` | Session history, status, result summary, and follow-up |
| `05-cursor-tool-integrations.jpg` | Compact terminal/tool output |
| `06-cursor-automation-builder.jpg` | Automation form hierarchy |
| `07-cursor-model-selector.jpg` | Anchored model selector |
| `08-cursor-pricing-monthly.jpg` | Pricing grid |
| `09-cursor-pricing-toggle.jpg` | Billing period control |
| `10-cursor-download-surfaces.jpg` | Desktop/terminal/web product surfaces |
| `11-cursor-platform-download-grid.jpg` | Platform downloads and version disclosure |
| `12-cursor-product-hero.jpg` | Product-specific hero |
| `13-cursor-codebase-context.jpg` | Feature proof with real UI |
| `14-cursor-plan-design-review.jpg` | Plan/build/review lifecycle |
| `15-cursor-faq-accordion.jpg` | Editorial FAQ treatment |
| `28-cursor-run-modes.jpg` | Auto-review, allowlist, and unrestricted mode hierarchy |
| `29-cursor-agents-window.jpg` | Parallel agents and multi-workspace view |

### LM Studio Bionic references

| File | Study this |
| --- | --- |
| `16-lmstudio-bionic-home.jpg` | Local-first product positioning and real app proof |
| `18-lmstudio-agent-features.jpg` | Work/code split and agent output presentation |
| `19-lmstudio-model-catalog.jpg` | Public model catalog density and filtering |
| `20-lmstudio-model-detail.jpg` | Model metadata, capability, and memory requirements |
| `22-bionic-coding-workspace.jpg` | Coding workspace in documentation context |
| `23-bionic-model-library-doc.jpg` | Model library controls |
| `24-bionic-model-picker-doc.jpg` | Model selection in the composer |
| `25-bionic-coding-full-resolution.png` | Primary coding-chat workspace reference |
| `26-bionic-local-models-full-resolution.png` | Primary installed-model library reference |
| `27-bionic-model-picker-full-resolution.png` | Primary local/cloud model picker reference |
| `30-bionic-document-chat.jpg` | Chat-and-artifact workspace context |
| `31-bionic-document-workspace-full-resolution.png` | Primary general workspace and right-side artifact reference |

## Acceptance criteria

The implementation is not complete until:

- A new user can move from install to a first coding task without choosing raw runtime parameters.
- The current local/cloud location and selected model are visible in the composer.
- A running task has an explicit state, can be stopped, and survives navigation.
- A permission request shows exact scope and offers a one-time safe choice.
- A completed task can be reviewed per file and reverted without losing pre-existing edits.
- Model downloads persist across navigation and recover after interruption.
- The model library distinguishes installed, loaded, downloading, incompatible, and failed states.
- The workspace works at 1024px and 1440px widths without overlapping panes.
- The default workspace shows only the sidebar, conversation, top bar, and composer; technical panels remain closed until needed.
- Closing an artifact returns to a clean centered conversation at the same scroll position.
- Keyboard operation, focus, reduced motion, loading, empty, and error states are implemented.
- Realistic data replaces lorem ipsum, fake analytics, and generic dashboard content.
- The final product is visually comparable in restraint and detail to the references while unmistakably using its own brand.

## Direct instruction to Claude

Read this complete document before editing code. Inspect the screenshots at full resolution and map each reference to the relevant screen above. First audit the existing repository, framework, routes, state management, desktop bridge, and design tokens. Preserve working behavior and existing user changes.

Then build the smallest functional vertical slice of the desktop workspace: a ChatGPT-like project/session shell, centered empty chat, familiar composer, model picker, mocked agent states, permission request, compact command/file events, hidden-by-default artifact drawer, diff review, and keep/revert. Use reusable primitives and explicit state models. After that, implement onboarding and models, then public pages and secondary settings.

Do not begin from an IDE layout. Begin from a clean chat layout and reveal technical depth progressively. Cursor is a behavioral reference; LM Studio and ChatGPT are the default workspace references.

For every screen, implement default, hover, focus, active, loading, empty, running, permission-blocked, completed, failed, and reduced-motion states where applicable. Do not declare completion while primary controls are decorative or routes are placeholder shells.

Treat the screenshots as visual acceptance references. Compare typography, pane proportions, content density, borders, spacing, control heights, and motion—not brand assets or exact copy. The goal is a clean-room product that feels deliberately designed by a mature product team.
