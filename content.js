(() => {
  "use strict";

  // The button projects the standings onto an equal number of games: every team
  // is levelled up to the team that has played most in that table, and each
  // missing game is counted as a virtual win. The points for a win differ by sport:
  //   football:   3 (3-1-0)
  //   hockey:     2 (modern KHL/VHL 2-1-0; note IIHF tournaments use 3 — change
  //               this to 3 if you follow World Championship / Olympic tables)
  //   basketball: 2 (2-1)
  //   volleyball: 3 (3 for winning 3-0 or 3-1, 2 for 3-2; counted at the maximum)
  // Sports not listed here get no button, and neither do tables with no points
  // column, which is how leagues ranked only by wins will show up.
  const POINTS_PER_WIN = { football: 3, hockey: 2, basketball: 2, volleyball: 3 };

  const sportOf = () => location.pathname.split("/")[1];

  const PLAYED_HEADERS = new Set(["и", "игры", "матчи"]);
  const POINTS_HEADERS = new Set(["о", "очки"]);

  const SWITCH_LABEL = "При равном числе игр";
  const PROJECTED_HEADER = "О*";
  const PROJECTED_HEADER_TITLE =
    "Очки при равном числе игр: недостающие матчи засчитаны как победы.";

  const SCAN_DELAY_MS = 200;

  // The site can repeat a label in two spans (desktop and mobile), so read one word.
  const normalizeHeader = (cell) =>
    cell.textContent.trim().split(/\s+/)[0].toLowerCase().replace(/\.$/, "");

  const parseNumber = (cell) => {
    const text = cell?.textContent.trim().replace("−", "-") ?? "";
    return /^-?\d+$/.test(text) ? Number(text) : NaN;
  };

  // Header and body cells can have different colSpans, so match by visual column.
  const columnOf = (cell) => {
    let column = 0;
    for (const sibling of cell.parentElement.cells) {
      if (sibling === cell) return column;
      column += sibling.colSpan;
    }
    return -1;
  };

  const cellAtColumn = (row, column) => {
    let end = 0;
    for (const cell of row.cells) {
      end += cell.colSpan;
      if (column < end) return cell;
    }
    return null;
  };

  const headerRowOf = (table) => table.tHead?.rows[0] ?? table.rows[0];

  const bodyRowsOf = (table) =>
    [...table.tBodies[0].rows].filter((row) => row !== headerRowOf(table));

  // Returns null for anything that doesn't look like a complete standings table.
  const readStandings = (table, pointsPerWin) => {
    if (table.tBodies.length !== 1) return null;

    const headerRow = headerRowOf(table);
    if (!headerRow) return null;

    const headers = [...headerRow.cells];
    const playedHeader = headers.find((c) => PLAYED_HEADERS.has(normalizeHeader(c)));
    const pointsHeader = headers.find((c) => POINTS_HEADERS.has(normalizeHeader(c)));
    if (!playedHeader || !pointsHeader) return null;

    const playedColumn = columnOf(playedHeader);
    const pointsColumn = columnOf(pointsHeader);

    const rows = bodyRowsOf(table)
      .map((row) => {
        const playedCell = cellAtColumn(row, playedColumn);
        const pointsCell = cellAtColumn(row, pointsColumn);
        return {
          row,
          firstCell: row.cells[0],
          playedCell,
          pointsCell,
          played: parseNumber(playedCell),
          points: parseNumber(pointsCell),
        };
      });

    const valid = (n) => Number.isFinite(n);
    if (rows.length < 2 || rows.some((r) => !valid(r.played) || !valid(r.points))) {
      return null;
    }

    const maxGames = Math.max(...rows.map((r) => r.played));
    for (const r of rows) {
      r.added = maxGames - r.played; // virtual wins (games in hand)
      r.projected = r.points + r.added * pointsPerWin;
    }
    return { table, pointsHeader, rows, maxGames };
  };

  // Replaces a cell's contents, remembering the original so showOriginal can put
  // it back. Keeps the column count fixed.
  const overwrite = (cell, text, marker) => {
    cell.dataset.cxHtml = cell.innerHTML;
    if (cell.title) cell.dataset.cxTitle = cell.title;
    cell.textContent = text;
    cell.classList.add(marker);
  };

  const showProjected = ({ table, pointsHeader, rows, maxGames }) => {
    // Best projection first. Array.prototype.sort is stable, so teams level on
    // projected points keep the site's official order.
    const sorted = [...rows].sort((a, b) => b.projected - a.projected);

    // The № cell describes a place, not a team: its number, zone colour and
    // "Плей-офф" bubble all stay at that position when the teams reorder.
    const hasRankColumn = rows.every((r) => /^\s*\d+/.test(r.firstCell.textContent));
    if (hasRankColumn) sorted.forEach((item, i) => item.row.prepend(rows[i].firstCell));

    // Relabel the existing points header instead of adding a new column.
    overwrite(pointsHeader, PROJECTED_HEADER, "cx-added");
    pointsHeader.title = PROJECTED_HEADER_TITLE;

    for (const { playedCell, pointsCell, projected, points } of rows) {
      overwrite(playedCell, String(maxGames), "cx-levelled");

      // Replace the points value in place with the projection. Hovering it shows
      // how many points the assumed wins add.
      overwrite(pointsCell, String(projected), "cx-added");
      const addedPoints = projected - points;
      if (addedPoints > 0) {
        pointsCell.title = `+${addedPoints} очков за победы в недостающих матчах`;
      }
    }

    sorted.forEach((item, i) => {
      item.projectedRank = i + 1;
    });

    // Show how many places each team moved vs its official position, in the №
    // cell. It's positioned out of flow (see styles.css) so it can't change the
    // column width. A table with no № column shows no places, so it gets no marks.
    rows.forEach((item, officialIndex) => {
      const delta = officialIndex + 1 - item.projectedRank;
      if (delta === 0 || !hasRankColumn) return;
      const mark = document.createElement("span");
      mark.className = `cx-move ${delta > 0 ? "cx-up" : "cx-down"}`;
      // The arrow itself is drawn in styles.css, so it lines up with the digits.
      mark.textContent = String(Math.abs(delta));
      mark.title = delta > 0 ? `Поднялась на ${delta}` : `Опустилась на ${Math.abs(delta)}`;
      item.row.cells[0].append(mark);
    });

    table.tBodies[0].append(...sorted.map(({ row }) => row));
  };

  const showOriginal = ({ table, rows }) => {
    table.querySelectorAll(".cx-move").forEach((el) => el.remove());
    // Restore everything overwrite() changed.
    table.querySelectorAll("[data-cx-html]").forEach((cell) => {
      cell.innerHTML = cell.dataset.cxHtml;
      delete cell.dataset.cxHtml;
      cell.classList.remove("cx-added", "cx-levelled");
      if (cell.dataset.cxTitle === undefined) {
        cell.removeAttribute("title");
      } else {
        cell.title = cell.dataset.cxTitle;
        delete cell.dataset.cxTitle;
      }
    });
    for (const { row, firstCell } of rows) row.prepend(firstCell);
    table.tBodies[0].append(...rows.map(({ row }) => row));
  };

  // Clicking a column header cycles it: first direction, the opposite, then back
  // to the table's own order. A goals column such as "76-49" has two more steps
  // before that: the same two directions by goal difference. Sorting moves whole
  // rows, so № stays with its team and keeps showing that team's place in the table.
  const SORTABLE_TABLES = "table.results-table";
  const DIFFERENCE_TITLE = "Сортировка по разнице";

  // table -> { header, ascending, byDifference, baseRows }. header is null while
  // unsorted. baseRows is the unsorted order: the order to return to, and the one
  // that ties keep, so teams level on a column stay in table order in both directions.
  const sorts = new WeakMap();

  const GOALS_PATTERN = /^(\d+)\s*[-:]\s*(\d+)$/;

  const cellText = (cell) => cell.textContent.trim().replace(/[−–]/g, "-");

  // Reads a goals cell such as "76-49"; null for any other cell.
  const parseGoals = (cell) => {
    const match = cellText(cell).match(GOALS_PATTERN);
    if (!match) return null;
    const scored = Number(match[1]);
    return { scored, difference: scored - Number(match[2]) };
  };

  const formatDifference = (difference) =>
    difference > 0 ? `+${difference}` : String(difference).replace("-", "−");

  const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

  // What a cell sorts by: an array of numbers compared in turn, a string for text,
  // or null when there is nothing to compare.
  const sortKey = (cell, byDifference) => {
    if (!cell) return null;

    // Form has no text, only marks, listed oldest first. Rank by points-style
    // score, then favour the team whose results came most recently.
    const form = [...cell.querySelectorAll("._win, ._draw, ._lose")].map((mark) =>
      mark.classList.contains("_win") ? 3 : mark.classList.contains("_draw") ? 1 : 0,
    );
    if (form.length) return [sum(form), sum(form.map((score, i) => score * (i + 1)))];

    const text = cellText(cell);

    // The № cell can hold more than the number: a bubble, or a .cx-move mark.
    if (cell.classList.contains("results-table__zone")) {
      const rank = parseInt(text, 10);
      return Number.isNaN(rank) ? null : [rank];
    }

    // Goals such as "76-49": by goals scored or by difference, with the other as
    // the tie-break.
    const goals = parseGoals(cell);
    if (goals) {
      return byDifference
        ? [goals.difference, goals.scored]
        : [goals.scored, goals.difference];
    }

    if (/^[+-]?\d+(?:[.,]\d+)?%?$/.test(text)) return [parseFloat(text.replace(",", "."))];

    return text || null;
  };

  const isGoalsColumn = (rows, header) => {
    const column = columnOf(header);
    return rows.some((row) => {
      const cell = cellAtColumn(row, column);
      return cell && parseGoals(cell);
    });
  };

  const columnKeys = (rows, header, byDifference = false) => {
    const column = columnOf(header);
    const keys = rows.map((row) => sortKey(cellAtColumn(row, column), byDifference));
    // A placeholder such as "—" in a numeric column counts as empty, not as text.
    return keys.some(Array.isArray) ? keys.map((k) => (Array.isArray(k) ? k : null)) : keys;
  };

  const compareKeys = (a, b) =>
    typeof a === "string"
      ? a.localeCompare(b, "ru")
      : a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0);

  // Places and names read from the top down; for everything else, most comes first.
  const opensAscending = (rows, header) =>
    header.classList.contains("results-table__zone") ||
    !columnKeys(rows, header).some(Array.isArray);

  const sortedRows = ({ baseRows, header, ascending, byDifference }) => {
    const keys = columnKeys(baseRows, header, byDifference);
    return baseRows
      .map((row, i) => ({ row, key: keys[i] }))
      .sort((a, b) => {
        // Empty cells go last whichever way the column is sorted.
        if (a.key === null || b.key === null) return (a.key === null) - (b.key === null);
        return ascending ? compareKeys(a.key, b.key) : compareKeys(b.key, a.key);
      })
      .map(({ row }) => row);
  };

  const renderSort = (table, sort) => {
    table.tBodies[0].append(...(sort.header ? sortedRows(sort) : sort.baseRows));

    for (const cell of headerRowOf(table).cells) {
      const active = cell === sort.header;
      cell.classList.toggle("cx-sort-asc", active && sort.ascending);
      cell.classList.toggle("cx-sort-desc", active && !sort.ascending);
      if (active) cell.setAttribute("aria-sort", sort.ascending ? "ascending" : "descending");
      else cell.removeAttribute("aria-sort");

      // The ± mark alone is cryptic, so hovering the header spells it out.
      const byDifference = active && sort.byDifference;
      cell.classList.toggle("cx-sort-difference", byDifference);
      if (byDifference && cell.dataset.cxSortTitle === undefined) {
        cell.dataset.cxSortTitle = cell.title;
        cell.title = DIFFERENCE_TITLE;
      } else if (!byDifference && cell.dataset.cxSortTitle !== undefined) {
        cell.title = cell.dataset.cxSortTitle;
        delete cell.dataset.cxSortTitle;
      }
    }
  };

  const cycleSort = (table, header) => {
    const sort = sorts.get(table);
    if (!sort.header) sort.baseRows = bodyRowsOf(table);

    const first = opensAscending(sort.baseRows, header);
    if (sort.header !== header) {
      sort.header = header;
      sort.ascending = first;
      sort.byDifference = false;
    } else if (sort.ascending === first) {
      sort.ascending = !first;
    } else if (!sort.byDifference && isGoalsColumn(sort.baseRows, header)) {
      sort.ascending = first;
      sort.byDifference = true;
    } else {
      sort.header = null;
      sort.byDifference = false;
    }
    renderSort(table, sort);
  };

  // The projection reads ties and places from the row order, so it has to run on
  // the unsorted table. Its result becomes the new base and the sort goes back on.
  const withBaseOrder = (table, change) => {
    const sort = sorts.get(table);
    if (!sort?.header) {
      change();
      return;
    }
    table.tBodies[0].append(...sort.baseRows);
    change();
    sort.baseRows = bodyRowsOf(table);
    renderSort(table, sort);
  };

  const columnCount = (row) => sum([...row.cells].map((cell) => cell.colSpan));

  const attachSort = (table) => {
    if (table.tBodies.length !== 1) return;

    const headerRow = headerRowOf(table);
    const rows = bodyRowsOf(table);
    if (!headerRow || rows.length < 2) return;
    // A row shaped differently is a divider or a note, which has no place in a sort.
    // A full-width divider matches the header's width, so compare cell counts too.
    const irregular = (row) =>
      columnCount(row) !== columnCount(headerRow) || row.cells.length !== rows[0].cells.length;
    if (rows.some(irregular)) return;

    sorts.set(table, { header: null, ascending: false, byDifference: false, baseRows: rows });

    // The difference is what one of the sorts orders by, so make it readable.
    for (const row of rows) {
      for (const cell of row.cells) {
        const goals = parseGoals(cell);
        if (goals) cell.title = `Разница: ${formatDifference(goals.difference)}`;
      }
    }

    for (const header of headerRow.cells) {
      header.classList.add("cx-sortable");
      header.tabIndex = 0;
      header.addEventListener("click", () => cycleSort(table, header));
      header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        cycleSort(table, header);
      });
    }
  };

  const buttons = new Map();

  const attachToggle = (table, pointsPerWin) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cx-toggle";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", "false");

    const label = document.createElement("span");
    label.className = "cx-toggle__text";
    label.textContent = SWITCH_LABEL;

    const track = document.createElement("span");
    track.className = "cx-toggle__track";
    const knob = document.createElement("span");
    knob.className = "cx-toggle__knob";
    track.append(knob);

    button.append(label, track);

    let shown = null;

    button.addEventListener("click", () => {
      withBaseOrder(table, () => {
        if (shown) {
          showOriginal(shown);
          shown = null;
        } else {
          // Read on click so the numbers reflect the table as it is right now.
          const standings = readStandings(table, pointsPerWin);
          if (!standings) return;
          showProjected(standings);
          shown = standings;
        }
      });
      const on = Boolean(shown);
      button.classList.toggle("cx-on", on);
      button.setAttribute("aria-checked", String(on));
    });

    table.before(button);
    buttons.set(table, button);
  };

  const scan = () => {
    for (const [table, button] of buttons) {
      if (!table.isConnected) {
        button.remove();
        buttons.delete(table);
      }
    }

    for (const table of document.querySelectorAll(SORTABLE_TABLES)) {
      if (!sorts.has(table)) attachSort(table);
    }

    const pointsPerWin = POINTS_PER_WIN[sportOf()];
    if (!pointsPerWin) return;

    for (const table of document.querySelectorAll("table")) {
      if (!buttons.has(table) && readStandings(table, pointsPerWin)) {
        attachToggle(table, pointsPerWin);
      }
    }
  };

  // Tables can render after page load or on in-page navigation.
  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DELAY_MS);
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
