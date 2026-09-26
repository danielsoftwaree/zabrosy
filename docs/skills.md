# Навыки проекта

Навыки находятся в `.agents/skills/` и доступны агенту при следующем запуске. Они установлены копиями публичных репозиториев с зафиксированными commit SHA; обновление — осознанная отдельная задача.

| Источник | Commit | Установлено |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` | `setup-matt-pocock-skills`, `to-spec`, `to-tickets`, `codebase-design`, `tdd`, `code-review` |
| [siberiacancode/agent-skills](https://github.com/siberiacancode/agent-skills) | `31448b686b24e4116d32e21d81041a21c925357c` | `react-hooks-best-practices`, `reactuse` |

Копии получены `skill-installer` с `--ref` и `--dest .agents/skills`. `reactuse` — справочник по выбору хуков, а не обязательство установить библиотеку Reactuse. Из Matt-навыков применяйте подходящие к конкретной работе; не запускайте процесс публикации задач или commit автоматически. При конфликте приоритет у запроса пользователя и `AGENTS.md`.
