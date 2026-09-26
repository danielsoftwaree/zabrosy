# Маркер · план реализации React r1

**База:** `SPEC.md` версии 1.0. **Назначение:** последовательность задач для разработчика или coding-агента. Это backlog, а не отчёт о выполнении работ.

Приоритет — сначала воспроизводимый промер и сохранение, затем интеграции. Миграцию проверять с первого этапа. Не подключать backend, не заменять задачу новым дизайном и не считать placeholder-карту выполненной функцией.

## 1. Этапы и задачи

| ID | Задача | Зависимость | Результат / приёмка |
|---|---|---|---|
| A01 | Инициализировать React/TS/Vite, strict, lint, format, Vitest, Playwright | — | Чистый build, test и typecheck; lockfile; мобильный shell |
| A02 | Сохранить baseline и fixtures v1/v2 | — | HTML неизменён; извлечение встроенного JSON; реальные старые поля сохранены |
| A03 | Реализовать v3 schemas и domain types | A01 | Валидатор отклоняет NaN, неверные ссылки и дубликаты; не выполняет clamp молча |
| A04 | Перенести чистую геометрию и расчёты | A02,A03 | M-01…M-05; property tests углов и расстояний |
| A05 | Написать миграции v1/v2 → v3 | A03,A04 | I-01,I-02; нет синтетических измеренных оборотов; LegacyBackup |
| B01 | Мобильная оболочка и маршруты | A01 | UX-01,UX-02; safe-area, keyboard, hash Back |
| B02 | Sector renderer, прицел, gestures, hit testing | A04,B01 | Сектор действительно интерактивен; UX-05; auto-fit до поддерживаемой дистанции |
| B03 | Типизированная машина промера | A03 | Все переходы SPEC §6, отмена и возврат из review |
| B04 | Большой TimerPad с обработкой жеста | B03 | T-01…T-04; performance clock; нет ghost click |
| B05 | Счётчик, ощущения, групповой undo | B03,B02 | UX-03,UX-04,M-06; удобен блочный ввод, hold по настройке |
| B06 | Калибровка и snapshot снасти | A03,B03 | M-03; старые записи не меняются |
| B07 | Finish sheet и пересчёт | B04,B05,B06 | Подтверждение полноты, M-01,M-02,M-04; один commit |
| C01 | Dexie repositories и последовательная запись | A03 | Atomic save cast + delete draft; статусы saving/saved/error |
| C02 | Recovery и multi-tab revision guard | C01,B03 | D-01…D-03; не полагаться на unload |
| C03 | Журнал, карточка, исправление отметок | B07,C01 | Редактирование с инвариантами, undo удаления, список всех данных |
| C04 | Цели на отметке/интервале и feeder checks | C03 | F-01,F-02; изменение геометрии инвалидирует актуальную проверку |
| C05 | Import wizard и LegacyBackup | A05,C01 | Превью, новые сессии, изоляция ошибочного файла, повторный импорт |
| C06 | JSON, CSV и PNG export | C03,C05 | E-01; source в метрах и координатах; CSV injection test |
| C07 | Portable HTML entry из общих компонентов | B07,C03,C06 | Автономный повторный промер, новый экспорт; inline-assets; E-02 |
| D01 | Station/frame и правила повтора | A04,C03 | G-01…G-03; без сравнения float-координат как ID |
| D02 | Imagery provider и MapLibre lazy route | D01 | Проверка capabilities/CORS; live-smoke; V-01 |
| D03 | GPS и постановка берега/ориентира | D01,D02 | G-04; точность показана, положение подтверждается |
| D04 | OrientationAdapter, ноль и деградация | D01,B03 | S-01…S-04; circle smoothing, stale readings, фиксирование старта |
| D05 | Wake Lock, haptics, cleanup | B03 | Feature detection, release/visibility, no leaks |
| E01 | Лента наблюдений и Canvas 3D | C03,D01 | V-02; отдельный режим; нет поверхности по null-глубинам |
| E02 | Справка и независимый demo-context | B01,C03 | V-03; demo export маркирован; реальные данные неизменны |
| E03 | PWA precache, update prompt, base path | C07,E01,E02 | P-01…P-03, включая первый lazy-route без сети |
| E04 | A11y, responsive и performance pass | B01…E03 | Все экраны матрицы; нет потери focus и случайных касаний |
| E05 | Физическая приёмка и deployment smoke | D02…E04 | iPhone/Android, HTTPS, реальные permissions; честный отчёт |

**Контрольная точка после B+C01:** один реальный ручной промер от направления до сохранённого и восстановленного заброса. До её прохождения не углубляться в картографический SDK и внешний вид 3D.

## 2. Карта переноса исходников

Старые исходники находятся в `reference/legacy-source/src/`.

| Старый участок | Новый модуль | Как переносить |
|---|---|---|
| `core.js`: norm, delta, point, project/unproject, bearing/meters/destination | `domain/geometry` | Чистые функции, TypeScript, unit/property tests |
| `distanceAt`, `finalize` | `domain/measurement` | Сохранить эталонную формулу; заменить отрицательное значение на unknown вместо clamp в ноль |
| `create`, `cast`, `event`, `validate`, `parse` | `domain/model` + schemas | Структуры v3; runtime errors вместо тихого исправления |
| `migrate` | `migrations` | Не копировать искусственные обороты v1 через фиксированное 0,8 |
| `sectorCasts` | `domain/geometry/selectVisibleCasts` | Группировка station/frame; отдельная геопривязка |
| `maps.js`: `FieldMap.drawSector`, `renderCast`, `geom` | `rendering/sector` | Перенести рисунок и hit testing; не использовать React на каждую точку |
| `FieldMap.bind`, `aim`, `zoom` | gesture controller | Разделить сектор и карту; pointercancel и pinch не дают tap |
| `drawSatellite`, tile queue | `rendering/imagery` | Заменить адаптером MapLibre/provider; не тащить старый global state |
| `drawRelief` | `rendering/observations3d` | Сохранить условность плоскости и измеренные глубины |
| `app.js`: `beginCast`, `timerTap`, `interruptTimer`, `skipTimer` | reducer + TimerPad | Отделить событие жеста, runtime clock и сохранённый fall |
| `addTurns`, `markFeeling`, `undo`, `openFinish` | survey commands + dock | Чистые команды; snapshots; invariant-safe undo |
| `save`, `archiveCurrent`, `archives` | repositories | Асинхронные транзакции вместо записи всей сессии в LocalStorage |
| `openRecord`, `openEvent`, `renderJournal` | journal feature | React-компоненты, декларативные формы |
| `openReel`, `openDirection`, `openSettings` | calibration/settings | Небольшие sheets с проверкой источника данных |
| `confirmPlacement`, `repeatCast` | stations feature | Версионная привязка, безопасный повтор |
| `enableSensors`, `orientation`, `acquireWake` | platform adapters | Lifecycle и тестируемый интерфейс без DOM-зависимостей |
| `importFile`, `exportCSV`, `exportPNG` | import/export services | Сохранить защиту от исполнения HTML и CSV-формул |
| `exportHTML` через `SOURCE/outerHTML` | portable build template | Не копировать production DOM с внешними chunks |
| `showSheet`, `openPage`, hashchange | shared UI + router | Focus/back/keyboard, без строкового innerHTML |
| `style.css`, `shell.html` | tokens, layouts, icons | Сохранить визуальный язык, уменьшить постоянный HUD |
| `sw.js` | PWA plugin configuration | Не переносить автоматический skipWaiting/reload как UX-политику |

## 3. Полевая карта миграции v2 → v3

| v2 | v3 / правило |
|---|---|
| `title`, `id`, `createdAt`, `example` | Session; dataKind=demo при example=true |
| `settings.bank`, `reference`, `bearing`, `geoAligned` | Frame; валидность геопривязки проверяется, false не исправлять предположением |
| `casts[].origin`, `referenceBearing` | Snapshot отдельного frame; не применять текущие settings ко всей истории |
| `angle`, `bearing` | DirectionSnapshot; сохранить provenance legacy |
| `pickup`, `pickupCalibrated` | Calibration snapshot, method legacy, историческое подтверждение отдельно |
| `distance`, `estimatedDistance`, `method`, `complete`, `turns` | Initial estimate + Retrieval; line_retrieval только при согласованных данных |
| `fall`, `fallInterrupted` | FallMeasurement; interrupted имеет приоритет |
| `events[].type`, `turns` | BottomMark с counter position; при наличии v1-source проверить синтетическую миграцию |
| `events[].depth`, `depth` | DepthMeasurement с legacy_unverified либо null |
| `lead`, `line` | Rig snapshot без задней подстановки новых настроек |
| `status`, `feederHeld`, `cleanRetrieve` | Target legacy_unspecified; не назначать точную позицию проверки |
| `notes` | Сохранить текст без HTML-исполнения |
| `legacySource` | LegacyBackup целиком |
| `draft.phase` | retrieve→retrieving; falling→interrupted при восстановлении |

Сопоставление ID: сохранять исходный ID в metadata; при конфликте при импорте создать новый UUID и обновить все внутренние ссылки транзакционно. Не менять исходный backup.

## 4. Набор fixtures

Создать и хранить в репозитории: v1 с featureDistance; v1 с неизвестной позицией; v1 с catches/дополнительными полями; v2 обычный; v2 с частичной подмоткой; v2 с двумя берегами; v2 с running timer; v2 с legacySource; demo; битый JSON; будущая версия; дубли ID; HTML с `</script>` в заметке; CSV-подобная формула; 1 000 забросов / 20 000 отметок.

Привязать каждому fixture ожидания не только количества записей, но и q, расстояния, происхождения, null-глубин, frame, draft и исходного backup.

## 5. Минимальные команды репозитория

```text
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build:portable
```

CI: typecheck → unit/schema/migration tests → build web + portable → browser tests. E2E запускаются через HTTP/HTTPS server, а не только `page.setContent`, когда проверяются origin storage и Service Worker.

Релизный отчёт должен содержать версии зависимостей, хэш сборки, результаты e2e, модель/версию двух физических телефонов, найденные ограничения карты и датчиков, результат offline cold start, адрес опубликованной версии либо прямую отметку «не опубликовано».
