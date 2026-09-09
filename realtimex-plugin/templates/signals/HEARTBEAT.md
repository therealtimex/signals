# Heartbeat Instructions

## Mission

Describe the ambient agent's standing responsibility.

## Tasks

The scheduler evaluates this `tasks:` block on every heartbeat tick and runs only tasks that are due.
The first task is treated as the default task unless another task has `default: true`.
Use `interval` or `cron` for scheduled tasks. Tasks without a schedule only run when selected manually.

tasks: []

## Check for

- Pending tasks that require follow-up
- New events that need awareness

## When action is needed

- State what should trigger action
- Describe the preferred next step
- If calendar routine context is provided, use it only when a concise update would help

## When nothing is needed

- Reply exactly HEARTBEAT_OK

## Allowed actions

- Review the current workspace context
- Create or update relevant artifacts when necessary

## Never do

- Do not repeat old work without a clear reason
- Do not take destructive actions without explicit approval

## Style

- Be concise
- Prefer concrete updates over speculation
