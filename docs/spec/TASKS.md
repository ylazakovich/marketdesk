# Task and backlog conventions

GitHub issues are the operational backlog. Use stable references like `GH-160` when linking implementation evidence.

## Task closeout

Close a task only with concrete evidence:

- code/docs changed for the requested behavior;
- targeted tests or checks ran;
- CodeRabbit/review comments were triaged and fixed when applicable;
- deployment verification was performed for live-facing changes.

If a task exposes a product decision or provider limitation, leave the task open or document the remaining scope in `OPEN_QUESTIONS.md` instead of marking it done by proximity.

## Required cycle

1. Idea / intake.
2. Documentation/spec update when scope or process changes.
3. Development / implementation.
4. Testing aligned with the test pyramid.
5. CodeRabbit / review comment fixes.
6. Delivery to server / deployment verification when live-facing.
