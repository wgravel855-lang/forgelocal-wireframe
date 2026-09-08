/* Documentation for the behaviour this build actually defines.
   Every rule described here is implemented somewhere in the prototype: the
   permission presets come from setup step 4, the fit arithmetic from the model
   pages, the checkpoint model from the review route. Where something does not
   exist yet, the article says so instead of inventing it. */

export const DOC_GROUPS = [
  ["Getting started", "What this is, what setup does, and what a first task looks like."],
  ["Models", "Picking one that fits, what the numbers mean, and managing them once installed."],
  ["Working", "The three modes, the permission model, and how changes get reviewed."],
  ["Reference", "Where data lives, and what to do when something stops."],
];

export const DOCS = [
  {
    slug: "what-forgelocal-is",
    group: "Getting started",
    title: "What ForgeLocal is",
    lede: "A coding agent that runs on your machine, and an honest account of what it is not.",
    read: 3,
    sections: [
      {
        h: "The shape of it",
        blocks: [
          ["p", "ForgeLocal is a desktop coding agent for Windows. It reads a folder you choose, plans work, edits files and runs the project's own commands, and then shows you a diff to keep or revert. The model doing that work is downloaded to your disk and runs on your own graphics card."],
          ["p", "The design choice underneath everything else is that a local model is not a cloud model with the network turned off. It has a fixed amount of video memory, a context window you can actually exhaust, and no ability to quietly fall back to something larger. So the interface shows you memory, context and permissions as first-class facts rather than hiding them."],
        ],
      },
      {
        h: "What it does not do",
        blocks: [
          ["list", [
            "It does not have a published installer. This build is a wireframe of the product, so nothing here downloads or runs a model.",
            "It does not benchmark models. No tokens-per-second figure appears anywhere, because none has been measured on real hardware.",
            "It does not sandbox. A permission prompt is a prompt, not process isolation. See Permissions for exactly where the boundary sits.",
            "It does not sync. There is no account requirement for local use and no server copy of your chats.",
          ]],
          ["note", "Pages that describe unbuilt features say so in place, rather than showing a disabled control with no explanation. If you find one that does not, that is a bug."],
        ],
      },
      {
        h: "Where things live in the app",
        blocks: [
          ["kv", [
            ["Chats", "The sidebar, grouped by pinned, today, the last seven days and older. Chats belong to a project."],
            ["Projects", "The picker above the chat list. A project is a folder, a permission preset and a detected stack."],
            ["Models", "Sidebar footer. Explore to find one, My models for what is installed, Downloads for what is in flight."],
            ["Settings", "Sidebar footer. General, appearance, models and runtime, permissions, privacy, about."],
            ["Runtime", "The Local pill in the top bar. Loaded model, video memory, context in use."],
          ]],
        ],
      },
    ],
  },

  {
    slug: "installing",
    group: "Getting started",
    title: "Installing",
    lede: "There is no build to install yet. This is what the installer will and will not do.",
    read: 2,
    sections: [
      {
        h: "Current state",
        blocks: [
          ["p", "No installer is published. There is no version number, no checksum and no signing certificate to verify, so this page cannot give you install instructions without inventing them. The download page carries the same statement and a waitlist instead of a button that does nothing."],
          ["note", "When a signed build exists, its version, SHA-256 checksum and certificate subject appear on the download page and in the changelog entry for that release."],
        ],
      },
      {
        h: "What setup will ask for",
        blocks: [
          ["p", "Setup is five steps, and it is worth knowing in advance which of them touch your machine."],
          ["steps", [
            "A welcome screen. Nothing is read yet.",
            "A hardware scan, after you agree to it. It reads CPU, total and free memory, video memory, free disk and whether a runtime is already installed. The reading stays on the device.",
            "One model recommendation with the arithmetic shown, and alternatives behind a disclosure. Installing it downloads the runtime and the weights, then runs a capability self-test.",
            "A project folder and a permission preset. File access is limited to that folder by default.",
            "The workspace, with an empty chat.",
          ]],
        ],
      },
      {
        h: "System requirements",
        blocks: [
          ["kv", [
            ["Operating system", "Windows 10 and 11, 64-bit. x64 and ARM64."],
            ["Video memory", "Determines which models fit. 8 GB runs a 7B model comfortably, 12 GB runs a 14B model at a moderate context."],
            ["Disk", "The weights, not the download, are what you need room for. A 14B model at Q4_K_M is about 9 GB on disk."],
            ["Network", "Needed once to download the runtime and a model. After that the agent works offline."],
          ]],
          ["p", "There is no minimum graphics card, because a model that does not fit in video memory can still run partly on the CPU. It is slower, and the model pages say so rather than hiding the option."],
        ],
      },
    ],
  },

  {
    slug: "first-task",
    group: "Getting started",
    title: "Your first task",
    lede: "What actually happens between typing a request and getting a diff.",
    read: 4,
    sections: [
      {
        h: "Ask for something small",
        blocks: [
          ["p", "A first task that touches one or two files tells you more than a large one, because you can read the whole diff and judge whether the model understood the codebase. Renaming a helper, adding a test for an existing function, or tightening one error message are all good first tasks."],
          ["p", "Type it in plain language. There is no prompt syntax, no slash commands and no file-mention syntax to learn. The agent reads the project itself."],
        ],
      },
      {
        h: "What you see while it works",
        blocks: [
          ["p", "The reply is one group, not a stream of separate messages. Inside it, an activity block collects everything the agent did: files read, edits made, commands run, tests and their exit codes. It is collapsed to a one-line summary by default and expands when you want the detail."],
          ["list", [
            "A plan appears first in Plan mode, and you approve it before anything runs.",
            "Anything the permission preset does not cover stops the run and asks, showing the exact command.",
            "Stop is always available. A stopped run keeps the work already done and says where it stopped.",
          ]],
        ],
      },
      {
        h: "Then review",
        blocks: [
          ["p", "Changes arrive as a diff, not as applied edits you have to discover later. You keep or revert per file and per hunk. Reverting is not undo, it is a checkpoint restore, so it works even after you have kept some other part of the change."],
          ["note", "If the result is wrong, the fastest repair is usually to revert and rephrase rather than to argue with the model across several turns. Each turn spends context, and context is finite."],
        ],
      },
    ],
  },

  {
    slug: "choosing-a-model",
    group: "Models",
    title: "Choosing a model that fits",
    lede: "The arithmetic behind every fit label, so you can check it yourself.",
    read: 5,
    sections: [
      {
        h: "The three numbers",
        blocks: [
          ["p", "Whether a model runs on your machine is a subtraction, not an opinion. Three things occupy video memory at once:"],
          ["kv", [
            ["Weights", "The model file itself, at its quantization. Fixed. A 14B model at Q4_K_M is about 8.9 GB."],
            ["Key-value cache", "Grows with context length. Roughly linear: doubling the context roughly doubles this."],
            ["Runtime overhead", "Compute buffers and the graphics driver's own reservation. A few hundred megabytes to about a gigabyte."],
          ]],
          ["p", "Add those three and compare to the video memory actually available, which is less than the number on the box because the display and other applications hold some. That comparison is the fit label, and every model page shows the inputs rather than only the verdict."],
        ],
      },
      {
        h: "What the labels mean",
        blocks: [
          ["kv", [
            ["Runs well", "The total fits with headroom. Nothing spills to system memory."],
            ["Runs with tradeoffs", "It fits, but close to the limit. Expect to lower the context or close other applications."],
            ["Partly on the CPU", "The weights do not fit, so some layers run on the processor. It works and it is slower."],
            ["Will not fit", "Not enough video memory even with offload worth doing. A smaller model or a smaller quantization is the answer."],
          ]],
          ["note", "No label claims a speed. Throughput depends on your specific card, driver, context and the shape of the work, and none of that has been measured here, so quoting a number would be inventing one."],
        ],
      },
      {
        h: "Picking between sizes",
        blocks: [
          ["p", "Larger is not automatically better for coding work. A 14B model that fits at a 16k context will usually beat a 32B model forced to a 4k context, because most real tasks need more of the file than they need of the model. Start with the largest model that fits comfortably at the context you actually work in, not the largest that fits at all."],
          ["p", "The recommendation shown during setup applies exactly that rule, which is why it is sometimes not the biggest model in the list."],
        ],
      },
    ],
  },

  {
    slug: "quantization",
    group: "Models",
    title: "Quantization and formats",
    lede: "What Q4_K_M means, and why the same model comes in six sizes.",
    read: 4,
    sections: [
      {
        h: "Why models come in several sizes",
        blocks: [
          ["p", "A model is trained at 16 bits per weight. Storing it that way makes it too large for most consumer graphics cards, so it is quantized: the weights are stored at fewer bits, with a scheme that keeps the parts that matter most at higher precision. The result is a much smaller file that is nearly as good."],
          ["p", "That is why one model appears as several downloads. They are the same trained model at different precision, not different models."],
        ],
      },
      {
        h: "Reading a quantization name",
        blocks: [
          ["code", "Q4_K_M\n|  |  |\n|  |  +-- size within the family: S small, M medium, L large\n|  +----- K-quant, a mixed-precision scheme\n+-------- 4 bits per weight on average"],
          ["kv", [
            ["Q8_0", "8 bits. Almost indistinguishable from the original, and about twice the size of Q4."],
            ["Q6_K", "6 bits. A very small quality cost for a meaningful size saving."],
            ["Q5_K_M", "5 bits. A reasonable middle if Q4 feels lossy on your work."],
            ["Q4_K_M", "4 bits. The usual default. Best size-to-quality ratio for coding work."],
            ["Q3_K_M", "3 bits. Noticeably weaker. Worth it only to make a larger model fit at all."],
            ["Q2_K", "2 bits. Degraded enough that a smaller model at Q4 is normally the better trade."],
          ]],
          ["p", "The practical rule: prefer a larger model at Q4_K_M over a smaller model at Q8. Below Q4 the losses start to show up as broken syntax and forgotten instructions, which is exactly where coding work is sensitive."],
        ],
      },
      {
        h: "Formats",
        blocks: [
          ["p", "This build uses GGUF files run by llama.cpp. GGUF is a single-file format that carries the weights and the metadata the runtime needs, which is what makes a model one download rather than a directory of parts."],
          ["note", "Weights come from the publisher, not from ForgeLocal. Every model page links its source repository and pins a revision, so an upstream change cannot silently alter what is installed on your disk."],
        ],
      },
    ],
  },

  {
    slug: "context-and-memory",
    group: "Models",
    title: "Context and memory",
    lede: "Why a longer context costs video memory, and what to do when it runs out.",
    read: 4,
    sections: [
      {
        h: "What context is",
        blocks: [
          ["p", "Context is everything the model can see at once: your messages, its replies, the files it has read and the output of commands it has run. It is measured in tokens, which are roughly three-quarters of a word each for prose and denser for code."],
          ["p", "When the context fills, the oldest content has to go. That is the point at which a model starts forgetting a constraint you gave it twenty turns ago, and it is the single most common cause of a task going sideways."],
        ],
      },
      {
        h: "Why it costs memory",
        blocks: [
          ["p", "The runtime keeps a key-value cache so it does not have to reprocess the whole conversation on every token. That cache is proportional to the context length, and it lives in video memory next to the weights."],
          ["p", "So context is not free and it is not a preference. Raising a 14B model from 8k to 32k tokens can cost several gigabytes, which is why the model pages show a fit row per context rather than a single verdict."],
          ["note", "The top bar shows context used against the total for the loaded model. When it approaches the limit, starting a fresh chat costs less than fighting the forgetting."],
        ],
      },
      {
        h: "Practical limits",
        blocks: [
          ["kv", [
            ["4k", "One or two files. Fine for a focused edit, too small for anything that reads around."],
            ["8k", "A comfortable default for single-file work with room for test output."],
            ["16k", "Several files plus a plan and its results. This is where most real tasks sit."],
            ["32k and above", "Whole-module work. Expensive, and slower per token even when it fits."],
          ]],
          ["p", "If a task needs more context than fits, the better move is usually to narrow the task rather than to raise the context, because a smaller task also produces a diff you can actually read."],
        ],
      },
    ],
  },

  {
    slug: "managing-models",
    group: "Models",
    title: "Downloading and loading",
    lede: "The difference between installed and loaded, and what each one costs.",
    read: 3,
    sections: [
      {
        h: "Installed is not loaded",
        blocks: [
          ["kv", [
            ["Installed", "The file is on your disk. It costs disk space and nothing else."],
            ["Loaded", "The file is in video memory and ready to answer. It costs video memory, and only one model is loaded at a time."],
          ]],
          ["p", "Loading takes a few seconds and ejecting is immediate. Ejecting does not delete anything, it just frees the video memory, which is what you want before starting a game or another workload that needs the card."],
          ["p", "Settings has an unload-after-idle timer so a model you forgot about is not holding video memory an hour later."],
        ],
      },
      {
        h: "Downloads",
        blocks: [
          ["p", "One download runs at a time, deliberately. Two concurrent downloads of multi-gigabyte files on a normal connection finish later than the same two in sequence, and a partial file left behind by a failed second download is a worse outcome than waiting."],
          ["list", [
            "Pausing keeps the bytes already on disk and resumes from that point.",
            "Every completed download is checksum-verified before it is marked installed.",
            "A failed download states the actual reason, such as insufficient disk, and the action that fixes it.",
          ]],
        ],
      },
      {
        h: "Removing a model",
        blocks: [
          ["p", "Deleting a model from My models removes the weights from disk and frees that space. The confirmation names the exact amount freed and whether anything is kept, because a multi-gigabyte re-download is a real cost to undo a misclick."],
        ],
      },
    ],
  },

  {
    slug: "modes",
    group: "Working",
    title: "Ask, Plan and Build",
    lede: "Three modes, chosen in the composer, that decide how much the agent is allowed to do.",
    read: 3,
    sections: [
      {
        h: "The three modes",
        blocks: [
          ["kv", [
            ["Ask", "Answers questions and reads files. Changes nothing. Use it to understand code before touching it."],
            ["Plan", "Writes a plan for you to approve before anything runs. Use it when the task spans several files or you are not sure the model has understood."],
            ["Build", "Edits files and runs the project's own commands, asking according to your permission preset. The default."],
          ]],
          ["p", "Mode is per message, not per chat, so you can ask a question in the middle of a build without changing anything about the session."],
        ],
      },
      {
        h: "When Plan earns its extra step",
        blocks: [
          ["p", "Plan mode costs you one approval and saves you a review of work that was aimed at the wrong thing. It is worth it when the task touches more than about three files, when it involves a migration or rename that is tedious to revert, or when the first attempt in Build mode came back with the wrong shape."],
          ["p", "It is not worth it for a single obvious edit, where reading the diff is faster than reading the plan and then the diff."],
        ],
      },
      {
        h: "Mode and permissions are separate",
        blocks: [
          ["note", "Ask mode changes nothing regardless of your permission preset, and Autopilot does not make Ask mode start editing. The mode decides what class of work is on the table; the preset decides how often the agent stops to confirm within that class."],
        ],
      },
    ],
  },

  {
    slug: "permissions",
    group: "Working",
    title: "Permissions",
    lede: "The three presets, what is never allowed, and how to take an approval back.",
    read: 5,
    sections: [
      {
        h: "The presets",
        blocks: [
          ["p", "A preset is chosen per project and decides how often the agent stops to ask. It can be changed later in Settings, under Permissions."],
          ["kv", [
            ["Ask every time", "Approve every file write and every command, including reading files. Slow on purpose. Appropriate for a codebase you did not write."],
            ["Balanced", "Edits and the project's own test and build commands run on their own. Installing packages, network access, Git writes and deletes ask first. This is the recommended default."],
            ["Autopilot", "Edits, the project's own build and test commands, package installs and Git writes run without asking."],
          ]],
        ],
      },
      {
        h: "What always stops and asks",
        blocks: [
          ["p", "Four classes stop and ask in every preset, including Autopilot, and this cannot be turned off:"],
          ["list", [
            "Network access beyond the package registry.",
            "Reads of files matching a secret pattern, such as .env or a private key.",
            "Deletes outside the project root.",
            "System-wide changes.",
          ]],
        ],
      },
      {
        h: "A prompt is not a sandbox",
        blocks: [
          ["p", "This is the honest limit and it is worth being blunt about. A permission prompt asks before running a command. It does not isolate the process afterwards. A command you approve runs with your user account's privileges and can, in principle, reach anything that account can reach."],
          ["p", "That is why the prompt shows the exact command rather than a summary of its category, and why the always-blocked classes exist even in the most permissive preset. If you need real isolation, run the project in a container or a virtual machine and point ForgeLocal at that."],
        ],
      },
      {
        h: "Remembered approvals",
        blocks: [
          ["p", "Choosing Always allow at a prompt creates a durable rule scoped to that project and that command, not to your whole machine. Every rule made that way is listed in Settings under Permissions, with the scope it was granted at and a Revoke button."],
          ["p", "Revoking does not break the command. The next time the agent needs it, it stops and asks again, and you can grant it again from that prompt."],
          ["note", "If the list of remembered approvals ever contains something you do not recognise, revoking it costs nothing except one extra prompt later."],
        ],
      },
    ],
  },

  {
    slug: "review-and-checkpoints",
    group: "Working",
    title: "Review and checkpoints",
    lede: "Changes arrive as a diff, and every step is restorable.",
    read: 4,
    sections: [
      {
        h: "Reviewing a change",
        blocks: [
          ["p", "The agent's edits are shown as a diff before they become the version you keep. The review lists every file it touched, with additions and deletions per file, and you decide per file and per hunk."],
          ["list", [
            "Keep changes accepts what is selected and leaves the rest reverted.",
            "Revert all puts every touched file back to the state the task found it in.",
            "A single hunk can be reverted while the rest of the same file is kept.",
          ]],
        ],
      },
      {
        h: "Checkpoints",
        blocks: [
          ["p", "A checkpoint is taken before each step that writes, so the numbered checkpoints in a conversation line up with the moments the project changed. Restoring one returns the files to that moment. It is not an undo stack, so it works even after you have kept part of a change or closed and reopened the app."],
          ["p", "The top bar's project details panel names the current checkpoint and what it is positioned before, so you always know what a restore would give you back."],
          ["note", "Checkpoints are ForgeLocal's own, stored alongside the chat. They are independent of Git, which means restoring one does not touch your branch, your staged changes or your stash."],
        ],
      },
      {
        h: "Stopped runs",
        blocks: [
          ["p", "A run that stops keeps everything it had already done and says where it stopped. The stopped screen offers the three things that are actually useful at that point: restore the checkpoint before the failure, take the action that unblocks it, or open diagnostics to read the log and the context around the failure."],
          ["p", "Diagnostics is local. The log lives in your app data folder and there is no send action, because a redacted upload flow does not exist yet and a button that pretended to have one would be worse than its absence."],
        ],
      },
    ],
  },

  {
    slug: "privacy-and-data",
    group: "Reference",
    title: "Where your data lives",
    lede: "What is on your disk, what is optional, and what changes with a cloud model.",
    read: 3,
    sections: [
      {
        h: "On your machine",
        blocks: [
          ["p", "Chats, checkpoints, project settings and permission rules are stored in a SQLite file in your Windows app data folder. While you are using a local model, your prompts, the model's replies and the file contents it reads are processed on your machine and are not transmitted."],
          ["kv", [
            ["Chats and checkpoints", "SQLite, in your app data folder."],
            ["Models", "A folder you choose. Large, and safe to move between machines."],
            ["Logs", "Your app data folder. Written locally, never uploaded."],
          ]],
        ],
      },
      {
        h: "The three optional switches",
        blocks: [
          ["p", "Crash reports, anonymous usage counts and contributed profile results are three separate settings, all off on a fresh install. None of them is bundled into another. They are in Settings under Privacy and diagnostics."],
          ["p", "A diagnostics report is built on demand, shown to you in full first, and redacted before it can go anywhere. Nothing is collected in the background to prepare one."],
        ],
      },
      {
        h: "If you connect a cloud model",
        blocks: [
          ["p", "Cloud boost is off by default. If you turn it on, the task summary and the contents of the files it names go to that provider under that provider's terms. It is asked per task rather than once at setup, so a decision you made a month ago cannot quietly send today's code somewhere."],
          ["note", "The workspace shows Local in the top bar when the loaded model is on your machine. If that ever says anything else, something is leaving the device."],
        ],
      },
    ],
  },

  {
    slug: "troubleshooting",
    group: "Reference",
    title: "Troubleshooting",
    lede: "Out of memory, a runtime that will not start, and downloads that stop.",
    read: 5,
    sections: [
      {
        h: "Out of video memory",
        blocks: [
          ["p", "The symptom is a load that fails, or a run that becomes dramatically slower partway through a long conversation. Both are the same cause: weights plus the key-value cache no longer fit."],
          ["steps", [
            "Lower the context for that model. This is the largest single saving and the least destructive.",
            "Close whatever else is using the card. A browser with hardware acceleration and a game launcher can hold a surprising amount.",
            "Drop one quantization step, for example from Q5_K_M to Q4_K_M, which saves roughly a fifth of the weights.",
            "Move to the next smaller model. A 7B at a comfortable context beats a 14B that is thrashing.",
          ]],
        ],
      },
      {
        h: "The runtime will not start",
        blocks: [
          ["p", "The Local pill in the top bar reports runtime health. If it says the runtime is offline, the usual causes are a graphics driver that updated underneath a running app, or a runtime binary that a security tool quarantined."],
          ["list", [
            "Restart the app first. A driver update invalidates the existing context and a restart is the fix.",
            "Reinstalling the runtime from Settings replaces the binary only. It does not touch your models, so it costs seconds rather than gigabytes.",
            "If a security tool is quarantining it, the runtime path is shown in Settings so it can be excluded.",
          ]],
        ],
      },
      {
        h: "A download stopped",
        blocks: [
          ["p", "Downloads resume from the bytes already on disk, so a paused or interrupted download is not lost work. The Downloads page states the actual reason a download failed rather than the word Failed."],
          ["kv", [
            ["Not enough disk", "It names the space needed and the space free. Free space or choose a smaller quantization, then retry."],
            ["Checksum mismatch", "The file did not verify, so it is not marked installed. Retrying re-downloads rather than keeping a corrupt file."],
            ["Connection lost", "Resumes from where it stopped when you retry."],
          ]],
        ],
      },
      {
        h: "The model is not following instructions",
        blocks: [
          ["p", "Before blaming the model, check the context indicator. A conversation that has filled its window has already dropped its earliest turns, which is usually where the constraint you are annoyed about was stated."],
          ["p", "A fresh chat with the constraint restated at the top costs less than five more turns of correction, and it is why starting over is a normal move rather than an admission of defeat."],
        ],
      },
    ],
  },
];
