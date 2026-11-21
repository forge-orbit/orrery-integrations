# Issue tracker

Track plugin work in [forge-orbit/orrery-integrations](https://github.com/forge-orbit/orrery-integrations/issues). Link relevant Orrery server tickets by their full references, such as `forge-orbit/orrery#117`.

- Read a ticket with `gh issue view <number> --json number,title,body,labels,comments`.
- Find tickets with `gh issue list --state open --json number,title,body,labels,comments`.
- Publish to the tracker with `gh issue create --title "<title>" --body-file <file>`.
- Apply or remove a label with `gh issue edit <number> --add-label <label>` or `--remove-label <label>`.
- Close a ticket with `gh issue close <number> --comment "<resolution>"`.

Use GitHub sub-issues for parent relationships and the native blocked-by relation for dependencies. Before writing from a different checkout, pass `--repo forge-orbit/orrery-integrations`.

**PRs as a request surface: no.**
