import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts.

const STARTER = String.raw`"""A route planner on a terrain map: BFS, Dijkstra and A*. Built in four stages; see STAGE-1.md."""

# What it costs to step onto each kind of cell; "#" is a wall and cannot be entered.
COSTS = {".": 1, "S": 1, "G": 1, "^": 3, "~": 5}


class Grid:
    def __init__(self, text):
        # Stage 1: read the map; set rows, cols, start and goal.
        raise NotImplementedError("stage 1: Grid")

    def cost(self, cell):
        raise NotImplementedError("stage 1: cost")

    def neighbours(self, cell):
        raise NotImplementedError("stage 1: neighbours")


def bfs(grid):
    # Stage 2: the path with the fewest moves, or None.
    raise NotImplementedError("stage 2: bfs")


def dijkstra(grid):
    # Stage 3: (cost, path, expanded) for the cheapest path, or None.
    raise NotImplementedError("stage 3: dijkstra")


def astar(grid):
    # Stage 4: the same as dijkstra, guided towards the goal.
    raise NotImplementedError("stage 4: astar")
`

const SOLUTION = String.raw`"""A route planner on a terrain map: BFS, Dijkstra and A*."""
import heapq
from collections import deque

COSTS = {".": 1, "S": 1, "G": 1, "^": 3, "~": 5}


class Grid:
    def __init__(self, text):
        lines = text.strip("\n").split("\n")
        if not lines or not lines[0]:
            raise ValueError("the map is empty")
        width = len(lines[0])
        for r, line in enumerate(lines):
            if len(line) != width:
                raise ValueError("row %d has %d cells but row 0 has %d" % (r, len(line), width))
            for c, ch in enumerate(line):
                if ch not in COSTS and ch != "#":
                    raise ValueError("unknown cell %r at %r" % (ch, (r, c)))
        starts = [(r, c) for r, line in enumerate(lines) for c, ch in enumerate(line) if ch == "S"]
        goals = [(r, c) for r, line in enumerate(lines) for c, ch in enumerate(line) if ch == "G"]
        if len(starts) != 1 or len(goals) != 1:
            raise ValueError("a map needs exactly one S and one G; found %d and %d" % (len(starts), len(goals)))
        self.lines = lines
        self.rows = len(lines)
        self.cols = width
        self.start = starts[0]
        self.goal = goals[0]

    def cost(self, cell):
        r, c = cell
        if not (0 <= r < self.rows and 0 <= c < self.cols):
            return None
        return COSTS.get(self.lines[r][c])

    def neighbours(self, cell):
        r, c = cell
        return [n for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)) if self.cost(n) is not None]


def _path(prev, cell):
    out = []
    while cell is not None:
        out.append(cell)
        cell = prev[cell]
    return out[::-1]


def bfs(grid):
    prev = {grid.start: None}
    queue = deque([grid.start])
    while queue:
        cell = queue.popleft()
        if cell == grid.goal:
            return _path(prev, cell)
        for n in grid.neighbours(cell):
            if n not in prev:
                prev[n] = cell
                queue.append(n)
    return None


def _search(grid, h):
    g = {grid.start: 0}
    prev = {grid.start: None}
    done = set()
    heap = [(h(grid.start), h(grid.start), grid.start)]
    expanded = 0
    while heap:
        _, _, cell = heapq.heappop(heap)
        if cell in done:
            continue
        done.add(cell)
        expanded += 1
        if cell == grid.goal:
            return g[cell], _path(prev, cell), expanded
        for n in grid.neighbours(cell):
            ng = g[cell] + grid.cost(n)
            if n not in g or ng < g[n]:
                g[n] = ng
                prev[n] = cell
                heapq.heappush(heap, (ng + h(n), h(n), n))
    return None


def dijkstra(grid):
    return _search(grid, lambda cell: 0)


def astar(grid):
    gr, gc = grid.goal
    return _search(grid, lambda cell: abs(cell[0] - gr) + abs(cell[1] - gc))
`

const HELPERS = String.raw`import random
from collections import deque
import routes
from routes import Grid

def check_path(grid, path, what):
    """None when path is a walkable route from S to G, else what is wrong with it"""
    if not isinstance(path, list) or not path:
        return "%s should be a non-empty list of (row, col) cells, got %r" % (what, path)
    if tuple(path[0]) != grid.start or tuple(path[-1]) != grid.goal:
        return "%s should start at S %r and end at G %r; it runs from %r to %r" % (what, grid.start, grid.goal, path[0], path[-1])
    for a, b in zip(path, path[1:]):
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) != 1:
            return "%s jumps from %r to %r, which are not side by side" % (what, a, b)
        if grid.cost(tuple(b)) is None:
            return "%s walks into %r, which is a wall or off the map" % (what, b)
    return None

def path_cost(grid, path):
    return sum(grid.cost(tuple(c)) for c in path[1:])

def _ref_neighbours(lines, cell):
    r, c = cell
    for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
        if 0 <= n[0] < len(lines) and 0 <= n[1] < len(lines[0]) and lines[n[0]][n[1]] != "#":
            yield n

def ref_moves(text):
    lines = text.strip("\n").split("\n")
    s = [(r, c) for r, l in enumerate(lines) for c, ch in enumerate(l) if ch == "S"][0]
    dist = {s: 0}
    q = deque([s])
    while q:
        cell = q.popleft()
        if lines[cell[0]][cell[1]] == "G":
            return dist[cell]
        for n in _ref_neighbours(lines, cell):
            if n not in dist:
                dist[n] = dist[cell] + 1
                q.append(n)
    return None

def random_map(rng, rows, cols, walls=0.25):
    cells = [[rng.choices(".^~#", [0.5, 0.15, 0.1, walls])[0] for _ in range(cols)] for _ in range(rows)]
    sr, sc = rng.randrange(rows), rng.randrange(cols)
    while True:
        gr, gc = rng.randrange(rows), rng.randrange(cols)
        if (gr, gc) != (sr, sc):
            break
    cells[sr][sc] = "S"
    cells[gr][gc] = "G"
    return "\n".join("".join(r) for r in cells)

def try_call(f, *args):
    try:
        return f(*args), None
    except Exception as e:
        return None, "it raised %s: %s" % (type(e).__name__, e)
`

const MAZE = String.raw`
S.#.....
.##.###.
....#...
.####.#.
......#G
`

export const routePlanner: WorkshopProject = {
  id: 'route-planner',
  title: 'A route planner: BFS, Dijkstra and A*',
  outcome: 'A route planner over a terrain map in Python: the map read into a graph, the route with the fewest moves by breadth-first search, the cheapest route over hills and water by Dijkstra’s algorithm, and A* with an admissible heuristic that finds the same cost while looking at a fraction of the map.',
  area: 'algorithms',
  prerequisites: ['Graphs', 'Queues and priority queues'],
  languages: ['python'],
  stages: [
    {
      id: 'map',
      title: 'The map as a graph',
      goal: 'Read a terrain map into a grid that knows each cell’s cost and its walkable neighbours.',
      brief: `In \`routes.py\`, finish \`Grid\`. A map is text, one row per line:

| cell | meaning | cost to step onto it |
|---|---|---|
| \`.\` | open ground | 1 |
| \`^\` | hill | 3 |
| \`~\` | water | 5 |
| \`#\` | wall | cannot be entered |
| \`S\`, \`G\` | the start and the goal | 1 |

- \`Grid(text)\`: blank lines at the very start and end of \`text\` are ignored. Sets \`rows\`, \`cols\`, and \`start\` and \`goal\` as \`(row, col)\` tuples (row 0 is the top line). Raises \`ValueError\` if rows differ in length, a character is not one of the six above, or there is not exactly one \`S\` and one \`G\`.
- \`cost(cell)\`: the cost of stepping onto \`cell\` (the table), or \`None\` for a wall or a cell off the map.
- \`neighbours(cell)\`: the cells one step up, down, left and right, **in that order**, leaving out walls and cells off the map.`,
      read: { concept: 'Graphs as grids', source: 'Amit Patel, “Introduction to the A* Algorithm” and “Implementation of A*” (Red Blob Games): the graph a grid stands for' },
      files: [{ path: 'routes.py', content: STARTER }],
      setup: HELPERS + '\nMAZE = ' + JSON.stringify(MAZE) + '\n',
      tests: [
        {
          name: 'the size, the start and the goal',
          code: String.raw`g, why = try_call(Grid, "\nS.~\n#^G\n")
assert why is None, "Grid of a 2 by 3 map failed: " + why
assert (g.rows, g.cols) == (2, 3), "the map has 2 rows of 3 cells, got rows %r and cols %r" % (g.rows, g.cols)
assert g.start == (0, 0) and g.goal == (1, 2), "S is at (0, 0) and G at (1, 2); got start %r and goal %r" % (g.start, g.goal)`
        },
        {
          name: 'each kind of cell has its cost, and walls have none',
          code: String.raw`g, why = try_call(Grid, "S.~\n#^G")
assert why is None, "Grid failed: " + why
want = {(0, 0): 1, (0, 1): 1, (0, 2): 5, (1, 0): None, (1, 1): 3, (1, 2): 1, (-1, 0): None, (0, 3): None, (2, 2): None}
for cell, cost in want.items():
    assert g.cost(cell) == cost, "cost(%r) should be %r, got %r" % (cell, cost, g.cost(cell))`
        },
        {
          name: 'neighbours are up, down, left, right, without walls or the edge',
          code: String.raw`g, why = try_call(Grid, "S..\n.#.\n..G")
assert why is None, "Grid failed: " + why
for cell, want in [((0, 0), [(1, 0), (0, 1)]), ((1, 0), [(0, 0), (2, 0)]), ((0, 1), [(0, 0), (0, 2)]), ((2, 1), [(2, 0), (2, 2)]), ((1, 2), [(0, 2), (2, 2)])]:
    got = g.neighbours(cell)
    assert list(got) == want, "neighbours(%r) should be %r (up, down, left, right; no wall at (1, 1), nothing off the map), got %r" % (cell, want, got)`
        },
        {
          name: 'a map that is not well formed is refused',
          code: String.raw`for text, why in [("S..\n..", "rows of different lengths"), ("S.x\n..G", "an unknown character"), ("S.S\n..G", "two starts"), ("S..\n...", "no goal"), ("", "an empty map")]:
    g, err = try_call(Grid, text)
    assert err is not None and err.startswith("it raised ValueError"), "a map with %s should raise ValueError; %s" % (why, err or "it was accepted")`
        }
      ],
      hints: [
        'Keep the lines of the map as they are; cost and neighbours are both lookups into them with a bounds check.',
        'Split on newlines after stripping newlines from the ends, check every line is as long as the first and holds only known characters, then find S and G with a scan. neighbours builds the four candidates in order and keeps the ones whose cost is not None.',
        'In __init__: lines = text.strip("\\n").split("\\n"); refuse empty, ragged or unknown; collect (r, c) of every S and every G and refuse unless there is one of each. cost: None when r or c is outside the map, else COSTS.get(the character) (a wall is not in COSTS, so it gives None). neighbours: [n for n in (up, down, left, right) if self.cost(n) is not None].'
      ],
      teaches: ['Graphs as grids', 'Input validation'],
      recall: 'A grid map is a graph without any edges written down. Where are its edges, and what decides their weights?'
    },
    {
      id: 'bfs',
      title: 'Fewest moves',
      goal: 'Find a route with the fewest moves by breadth-first search, or report that there is none.',
      brief: `Write \`bfs(grid)\` in \`routes.py\`: a route from \`S\` to \`G\` with the **fewest moves**, ignoring terrain cost. Return it as a list of \`(row, col)\` cells from the start to the goal, both included, each a neighbour of the one before; or \`None\` if walls cut the goal off.

Visit cells in first-in, first-out order and remember, for each cell, the cell you reached it from; walk those links back from the goal to rebuild the route. When several routes are equally short, any of them is right.`,
      read: { concept: 'Breadth-first search', source: 'Cormen, Leiserson, Rivest and Stein, Introduction to Algorithms, section 20.2 (22.2 in earlier editions) “Breadth-first search”; Red Blob Games, “Breadth First Search”' },
      files: [],
      tests: [
        {
          name: 'a straight corridor',
          code: String.raw`g = Grid("S...G")
path, why = try_call(routes.bfs, g)
assert why is None, "bfs failed: " + why
assert [tuple(c) for c in path] == [(0, 0), (0, 1), (0, 2), (0, 3), (0, 4)], "bfs on S...G should walk the corridor, got %r" % (path,)`
        },
        {
          name: 'the fewest moves through a maze',
          code: String.raw`g = Grid(MAZE)
path, why = try_call(routes.bfs, g)
assert why is None, "bfs failed: " + why
problem = check_path(g, path, "the route")
assert problem is None, problem
want = ref_moves(MAZE)
assert len(path) - 1 == want, "the shortest route through the maze takes %d moves; yours takes %d" % (want, len(path) - 1)`
        },
        {
          name: 'terrain does not matter to the number of moves',
          code: String.raw`g = Grid("S~~~G\n.....")
path, why = try_call(routes.bfs, g)
assert why is None, "bfs failed: " + why
assert len(path) - 1 == 4, "straight across the water is 4 moves, the fewest; bfs took %d" % (len(path) - 1)`
        },
        {
          name: 'the fewest moves on random maps',
          code: String.raw`rng = random.Random(11)
for k in range(40):
    text = random_map(rng, 9, 12)
    g = Grid(text)
    path, why = try_call(routes.bfs, g)
    assert why is None, "bfs failed on map %d: %s" % (k, why)
    want = ref_moves(text)
    if want is None:
        assert path is None, "on map %d the goal is walled off, so bfs should return None; it returned %r\n%s" % (k, path, text)
        continue
    problem = check_path(g, path, "the route on map %d" % k)
    assert problem is None, problem + "\n" + text
    assert len(path) - 1 == want, "on map %d the fewest moves is %d; bfs took %d\n%s" % (k, want, len(path) - 1, text)`
        },
        {
          name: 'no route when the goal is walled off',
          code: String.raw`g = Grid("S.#.\n..#G")
path, why = try_call(routes.bfs, g)
assert why is None, "bfs failed: " + why
assert path is None, "a wall cuts G off, so bfs should return None, got %r" % (path,)`
        }
      ],
      hints: [
        'Breadth-first means the queue hands cells back in the order they were found, so all cells one move away come out before any two moves away.',
        'Use collections.deque. Mark a cell as seen when you add it to the queue, not when you take it out, or it can be queued many times. A dictionary from cell to the cell it was reached from does both jobs: it records what is seen and it lets you rebuild the route.',
        'prev = {start: None}; queue = deque([start]). While the queue is not empty: pop from the left; if it is the goal, follow prev from the goal back to None, reverse, and return the list; otherwise, for each neighbour not in prev, set prev[n] = cell and append it. After the loop, return None.'
      ],
      teaches: ['Breadth-first search', 'Path reconstruction'],
      recall: 'Why does breadth-first search find the route with the fewest moves, and why does it stop being right once moves have different costs?'
    },
    {
      id: 'dijkstra',
      title: 'Cheapest, not shortest',
      goal: 'Find the cheapest route over terrain with Dijkstra’s algorithm and a priority queue.',
      brief: `Write \`dijkstra(grid)\` in \`routes.py\`. The cost of a route is the sum of the costs of the cells it steps onto (not the start). Return a tuple \`(cost, path, expanded)\`:

- \`cost\`: the cost of the **cheapest** route from \`S\` to \`G\`;
- \`path\`: that route, as a list of cells as in \`bfs\`;
- \`expanded\`: how many cells were **settled**: taken off the priority queue for the first time (a cell taken off again with an out-of-date distance doesn't count). Stop as soon as the goal is settled; it counts.

Return \`None\` when there is no route. Use \`heapq\`. When two cells have the same distance, take the smaller \`(row, col)\` first.`,
      read: { concept: 'Dijkstra’s algorithm', source: 'Cormen, Leiserson, Rivest and Stein, Introduction to Algorithms, section 22.3 (24.3 in earlier editions) “Dijkstra’s algorithm”; Python documentation, heapq' },
      files: [],
      tests: [
        {
          name: 'it goes round the water when that is cheaper',
          code: String.raw`g = Grid("S~~~G\n.....")
r, why = try_call(routes.dijkstra, g)
assert why is None, "dijkstra failed: " + why
assert isinstance(r, tuple) and len(r) == 3, "dijkstra should return (cost, path, expanded), got %r" % (r,)
cost, path, _ = r
assert cost == 6, "across the water costs 16; down, along and up costs 6. The cheapest cost is 6, got %r" % (cost,)
problem = check_path(g, path, "the route")
assert problem is None, problem
assert path_cost(g, path) == cost, "the route returned costs %d to walk, but dijkstra reported %r" % (path_cost(g, path), cost)`
        },
        {
          name: 'a hill is worth climbing when the way round is long',
          code: String.raw`g = Grid("S^G\n.#.\n.#.\n...")
r, why = try_call(routes.dijkstra, g)
assert why is None, "dijkstra failed: " + why
assert r is not None and r[0] == 4, "over the hill costs 3 + 1 = 4; round the wall costs 8; got %r" % (r[0] if r else r,)`
        },
        {
          name: 'the cheapest cost on random maps',
          code: String.raw`def ref_cost(g):
    import heapq
    dist = {g.start: 0}
    heap = [(0, g.start)]
    while heap:
        d, cell = heapq.heappop(heap)
        if cell == g.goal:
            return d
        if d > dist[cell]:
            continue
        r, c = cell
        for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            k = g.cost(n)
            if k is not None and d + k < dist.get(n, 1e18):
                dist[n] = d + k
                heapq.heappush(heap, (d + k, n))
    return None
rng = random.Random(23)
for k in range(40):
    text = random_map(rng, 10, 14, walls=0.2)
    g = Grid(text)
    r, why = try_call(routes.dijkstra, g)
    assert why is None, "dijkstra failed on map %d: %s" % (k, why)
    want = ref_cost(g)
    if want is None:
        assert r is None, "on map %d there is no route, so dijkstra should return None; it returned %r" % (k, r)
        continue
    assert r is not None and r[0] == want, "on map %d the cheapest route costs %d; dijkstra said %r\n%s" % (k, want, r[0] if r else r, text)
    problem = check_path(g, r[1], "the route on map %d" % k)
    assert problem is None, problem
    assert path_cost(g, r[1]) == want, "on map %d the route returned costs %d to walk, not %d" % (k, path_cost(g, r[1]), want)`
        },
        {
          name: 'each cell is settled at most once',
          code: String.raw`g = Grid("S...G")
r, why = try_call(routes.dijkstra, g)
assert why is None, "dijkstra failed: " + why
assert r[2] == 5, "in the corridor S...G each of the 5 cells is settled once, goal included: expanded should be 5, got %r" % (r[2],)
g = Grid("S....\n.....\n.....\n....G")
r = routes.dijkstra(g)
assert r[2] <= 20, "a 4 by 5 map has 20 cells; expanded %r means some were counted twice" % (r[2],)`
        },
        {
          name: 'no route when the goal is walled off',
          code: String.raw`g = Grid("S.#.\n..#G")
r, why = try_call(routes.dijkstra, g)
assert why is None, "dijkstra failed: " + why
assert r is None, "a wall cuts G off, so dijkstra should return None, got %r" % (r,)`
        }
      ],
      hints: [
        'BFS with its queue replaced by a priority queue keyed on the cost so far. The new problem is that a cell can be reached first by an expensive route and later by a cheaper one.',
        'Push (distance, cell) pairs with heapq; tuples compare by distance, then by cell. Keep the best known distance per cell; when a neighbour’s new distance beats it, record it with its predecessor and push it again. When a pair comes off whose cell is already settled, skip it: that is how out-of-date entries are ignored.',
        'dist = {start: 0}, prev = {start: None}, done = set(), heap = [(0, start)], expanded = 0. Loop: pop (d, cell); skip if cell in done; add it, expanded += 1; if it is the goal return (d, path rebuilt from prev, expanded). For each neighbour n: nd = d + grid.cost(n); if n not in dist or nd < dist[n], set dist[n] = nd, prev[n] = cell, and push (nd, n). After the loop return None.'
      ],
      teaches: ['Dijkstra’s algorithm', 'Priority queues (binary heaps)'],
      recall: 'Why is a cell’s distance final the moment Dijkstra’s algorithm takes it off the priority queue, and which assumption about costs does that rely on?'
    },
    {
      id: 'astar',
      title: 'A*: look towards the goal',
      goal: 'Find the same cheapest cost while settling far fewer cells, with an admissible heuristic.',
      brief: `Write \`astar(grid)\` in \`routes.py\`, returning \`(cost, path, expanded)\` exactly as \`dijkstra\` does, or \`None\`.

A* orders the queue by **f = g + h**: \`g\` the cost so far, \`h\` an estimate of the cost still to come. Use the **Manhattan distance** to the goal, \`|row − goal row| + |col − goal col|\`. Every move costs at least 1, so it never overestimates (it is *admissible*), which is what keeps A*'s answer the cheapest.

- When two cells have the same \`f\`, take the one with the smaller \`h\` (the one nearer the goal), then the smaller \`(row, col)\`.
- \`expanded\` counts settled cells as before.

The tests check that \`astar\` finds the same cost as \`dijkstra\` on random maps, and that on an open 30 by 30 map from one corner to the other it settles fewer than 120 cells where \`dijkstra\` settles almost all 900.`,
      read: { concept: 'A* search and admissible heuristics', source: 'Hart, Nilsson and Raphael, “A Formal Basis for the Heuristic Determination of Minimum Cost Paths” (1968); Red Blob Games, “Introduction to the A* Algorithm” and “Heuristics”' },
      files: [],
      tests: [
        {
          name: 'the same cheapest cost as Dijkstra on random maps',
          code: String.raw`rng = random.Random(31)
for k in range(50):
    text = random_map(rng, 12, 16, walls=0.2)
    g = Grid(text)
    a, why = try_call(routes.astar, g)
    assert why is None, "astar failed on map %d: %s" % (k, why)
    d = routes.dijkstra(g)
    if d is None:
        assert a is None, "on map %d there is no route, so astar should return None; it returned %r" % (k, a)
        continue
    assert a is not None and a[0] == d[0], "on map %d the cheapest route costs %d; astar said %r\n%s" % (k, d[0], a[0] if a else a, text)
    problem = check_path(g, a[1], "the astar route on map %d" % k)
    assert problem is None, problem
    assert path_cost(g, a[1]) == a[0], "on map %d astar's route costs %d to walk, but it reported %d" % (k, path_cost(g, a[1]), a[0])`
        },
        {
          name: 'on an open map it looks at a fraction of the cells',
          code: String.raw`rows = ["." * 30 for _ in range(30)]
rows[0] = "S" + rows[0][1:]
rows[29] = rows[29][:29] + "G"
g = Grid("\n".join(rows))
a, why = try_call(routes.astar, g)
assert why is None, "astar failed: " + why
d = routes.dijkstra(g)
assert a is not None and a[0] == 58, "corner to corner of an open 30 by 30 map costs 58, got %r" % (a[0] if a else a,)
assert d[2] > 800, "dijkstra should settle almost every cell here (it has no sense of direction); it settled %d" % d[2]
assert a[2] < 120, "astar, with Manhattan distance and ties going to the cell nearer the goal, should settle under 120 cells; it settled %d (dijkstra: %d)" % (a[2], d[2])`
        },
        {
          name: 'ties go to the cell nearer the goal',
          code: String.raw`g = Grid("S...G")
a, why = try_call(routes.astar, g)
assert why is None, "astar failed: " + why
assert a[2] == 5, "in the corridor S...G astar should settle exactly the 5 cells, got %r" % (a[2],)
g = Grid(".....\nS...G\n.....")
a = routes.astar(g)
assert a[2] == 5, "on a 3 by 5 map with S and G on the middle row, every cell off the straight line has a larger f or a larger h: astar should settle 5 cells, got %r" % (a[2],)`
        },
        {
          name: 'no route when the goal is walled off',
          code: String.raw`g = Grid("S.#.\n..#G")
a, why = try_call(routes.astar, g)
assert why is None, "astar failed: " + why
assert a is None, "a wall cuts G off, so astar should return None, got %r" % (a,)`
        }
      ],
      hints: [
        'A* is your Dijkstra with a different key in the priority queue. Nothing else about the loop changes.',
        'Push (g + h, h, cell): the tuple order gives f first, then h, then the cell, which is exactly the tie-breaking asked for. Store g separately (in the dictionary of best costs), since the key no longer is the cost so far. With a consistent heuristic like this one, a settled cell never needs reopening.',
        'Factor the loop out of dijkstra into a function that takes h; dijkstra passes a function returning 0 (then the key is (g, 0, cell) and nothing changes), astar passes the Manhattan distance to the goal. In the loop, pop (f, h, cell), skip settled cells, return (g[cell], path, expanded) at the goal, and push (ng + h(n), h(n), n) for improved neighbours.'
      ],
      teaches: ['A* search and admissible heuristics', 'Priority queues (binary heaps)'],
      recall: 'What goes wrong with A* if the heuristic overestimates the remaining cost, and why is the Manhattan distance safe on this map?'
    }
  ],
  solution: [{ path: 'routes.py', content: SOLUTION }]
}
