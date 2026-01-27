OpenCode Prompt — High-level project brief 

Project name: Tampines Hackathon

Note: This project will use Deno as the runtime. The agent should prioritise Deno-compatible scaffolding and detect Deno-specific configuration files when scanning the repository.

Purpose
- Build a small, well-documented application to solve the stated problem for the Tampines Hackathon. The repository and GitHub Issues will be the single source of truth for decisions, requirements, and progress.

Scope (high-level)
- Deliver a minimal, demonstrable MVP that includes:
  - A user-facing surface to interact with the core feature set.
  - An API or backend layer to support the frontend and store necessary state.
  - Persistent storage for essential data (choose an appropriate option).
  - Automated verification (tests) and a repeatable CI workflow.
  - Scheduled jobs or automation for periodic tasks where applicable.
- Do not include implementation-level technical choices (frameworks, languages, libraries). Make pragmatic choices only when necessary, or leave options for a human steward to decide.

Goals and outcomes
- Create a public Git repository with the project name and a clear README that describes goals, scope, and how to run/review the project at a high level.
- Add a set of GitHub Issue templates and initial issues that reflect the project workflows: Planning, Execution, Verification, Scheduling.
- Ensure system-required issues are flagged and that issue bodies contain explicit comment prompts for stakeholders to reply with answers (so the system can read keywords and comments).
- Produce an initial project board or milestone list with the first iteration (48-hour/one-sprint) broken into Plan → Implement → Verify → Schedule.
- Provide a short developer handoff note listing open decisions, required human approvals, and suggested next steps.

Deliverables
- Repository scaffold with README, CONTRIBUTING, and a plain, human-readable architecture overview (high-level only).
- Issue templates for: Define the Tech Stack (system-required), Plan the Workflow (system-required), Execute the Tasks, Verify the Results, Schedule the Next Steps. Each template must include:
  - Title keywords and labels to drive downstream automation.
  - A "System Required: Yes/No" flag where applicable.
  - Inline comment markers or explicit question lines for users to reply to (so the system can parse answers).
- A set of initial issues created from those templates, populated with the project's high-level information and flagged decisions.
- Basic CI and testing placeholders (generic description and example test), and a scheduled automation placeholder (generic cron-like description). Do not specify tools; present these as configurable placeholders.
- An acceptance checklist in the root README describing how to confirm the project meets the minimum criteria.

Acceptance Criteria (high-level)
- Repo exists with documented goals and a readable architecture overview.
- Issue templates and the initial issues are present and correctly flagged for system-required items.
- Initial 48-hour milestone or project board is created with Plan/Implement/Verify/Schedule steps.
- Developer handoff note and list of open decisions included.
- No implementation-level technical specs embedded; leave technology choices open or note them as "team decision" items.

Process guidance for the agent
- Prefer clarity and minimalism: scaffolding should be lean and easy to review.
- When a decision is required, create a system-required issue and mark the question clearly so a human can answer it by replying to the issue.
- Use short, consistent keywords in titles and labels so the orchestration system can reliably classify issues (e.g., "Tech Stack", "Workflow", "Execution", "Verification", "Scheduling").
- Create comment placeholders in issues that read like direct prompts ("Reply here with: ...") to collect stakeholder answers.
- Before proposing or populating any tech choices, scan the current repository to detect existing technologies and configuration. Specifically:
  - Look for and parse common indicators of tech choices. Because this is a Deno project, prioritise Deno-specific files and patterns, then check other ecosystem indicators:
    - Deno-specific: `deno.json`, `deno.jsonc`, `deno.lock`, `deps.ts`, `mod.ts`, `import_map.json`, `fmt.json`, `tsconfig.json` (if present for tooling), and files importing via remote URLs.
    - Other ecosystems: `package.json`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `requirements.txt`, `Pipfile`, `Gemfile`, `go.mod`, `Cargo.toml`, `composer.json`, `Dockerfile`, `.github/workflows`, `Makefile`, and similar files.
  - Inspect top-level source directories and file extensions (e.g., `.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`) to corroborate detected technologies.
  - Collect detected versions, runtime constraints, and any CI or Docker configurations that hint at tooling choices.
  - If a detectable tech stack is found, include a succinct "Detected Tech Stack" section in the generated output and use those detections to seed any relevant issue templates (but do not hard-lock choices; mark them as "team decision" where appropriate).
  - If no clear tech indicators are found, create or populate a system-required issue titled "Define the Tech Stack" and include explicit reply prompts so a human can answer.
  - Prefer explicit configuration files over heuristic guesses; when uncertain, state the uncertainty and ask a human via a system-required issue.

Human approvals and open decisions
- List any decisions left open for the product manager or team (e.g., whether AI can auto-select the tech stack, deployment targets, or data residency constraints).
- Mark those decisions as "system-required" issues so they are visible and actionable.

Handoff and next steps for reviewers
- How to review: check README, confirm issue templates and system-required flags, and verify initial issues were created.
- If everything is acceptable, the human reviewer should reply to system-required issues to provide the missing decisions; otherwise, leave comments for clarification.

Notes
- Keep security and privacy in mind: include a note in README reminding contributors not to commit secrets and to use environment variables or secret stores.
- Do not choose specific frameworks, libraries, or cloud providers. Focus on structure, process, and human decision points.

End of prompt
