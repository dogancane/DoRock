# Scour Protection and Rock Installation Planner

A single-file engineering tool for planning scour protection rock installation on
offshore wind foundations. It takes a project from layer geometry through rock
quantities, quarry logistics and vessel cycles to a campaign duration and an
issuable report.

Everything runs in the browser. There is no server, no build step and no network
call at runtime. The whole tool is one HTML file.

---

## Read this before you publish it

GitHub Pages is **public**. `robots.txt` and the `noindex` meta tags keep the
page out of search results. They do **not** make it private. Anyone who has or
guesses the URL can open it, and so can anyone it is forwarded to.

Two consequences worth thinking about:

- The quarry list carries commercial information (load-out positions, quay
  rates, rock densities). Check that publishing it is acceptable.
- Any project you save is held in your own browser, not on the site, so it is
  not exposed by publishing. Exported `.json` files are yours alone unless you
  commit them.

If the content needs to stay inside the company, use a private repository and
open `index.html` from disk, or host it behind whatever access control your IT
provides. Do not rely on an obscure URL.

### One thing about robots.txt

Crawlers only read `robots.txt` from the **domain root**. On a project site at
`https://<user>.github.io/<repo>/` the file sits at `/<repo>/robots.txt` and is
ignored. It is included here because it does work on a user or organisation site
served from the domain root, but on a project site the `noindex` meta tags in
`index.html` are what actually keeps the page out of search results. Both are in
place, so either deployment is covered.

---

## Deploying

1. Create a repository and copy these files into it.
2. Settings, Pages, then set the source to the `main` branch, root folder.
3. The tool appears at `https://<user>.github.io/<repo>/` within a minute or two.

Files:

| File | Purpose |
| --- | --- |
| `index.html` | The entire tool. Nothing else is required to run it. |
| `robots.txt` | Blocks crawlers. Only effective on a domain-root deployment. |
| `404.html` | Plain not-found page, also marked `noindex`. |
| `.nojekyll` | Stops GitHub running the files through Jekyll. |
| `README.md` | This file. |

To run it without publishing anything, download `index.html` and open it. It
works the same offline.

---

## Using it

The tool opens **empty**. Nothing is calculated and no engineering value is
assumed until it is entered, so no figure on screen is inherited from somewhere
else.

A worked reference example can be loaded from the sidebar at any time. It is
labelled as an example on every page and in the printed report, and it is a
sandbox: change anything and every dependent figure moves with it, with the
change against the loaded state shown in the top bar.

Five sections:

- **Setup** — project identity, monopile diameters, water depth range, locations.
- **Design** — rock layers and design bands.
- **Execution** — quarry, vessels, installation cycle.
- **Results** — quantities, programme, sensitivity, scenarios.
- **Report** — the issuable document.

### Getting a project in quickly

Copy the location schedule from wherever it lives and paste it anywhere on the
Locations tab. Columns are detected from the header row and can be corrected
before anything is imported. Latitude and longitude, seabed level, monopile
diameter, rock grade, thickness, extent and slope are all recognised, and design
bands are built from the distinct designs found in the data.

### Saving

Work is kept in the browser and comes back when the file is reopened. Autosave
runs about a second after you stop typing and the sidebar always shows whether
there are unsaved changes.

Browser storage is a convenience, not an archive. Some browsers block it for
files opened from disk, and it is wiped whenever site data is cleared. The
**Export project** `.json` is the real backup, and the tool says so rather than
implying the work is safe.

---

## What it calculates

### Layer geometry

Each layer is an axisymmetric height field: constant thickness across the crest,
tapering down the side slope to zero at the toe. Volume is integrated
analytically, not numerically.

```
R_top = pile radius + extent beyond the wall     (four other conventions available)
R_toe = R_top + thickness x slope                (or a fixed toe length)

pre-lay pancake   V = 1/3 pi t (R^2 + r^2 + R r)
donut             V = 1/3 pi t (R^2 + r^2 + R r) - 1/4 pi Oi^2 t
```

where `R` is the toe radius, `r` the crest radius and `Oi` the opening diameter,
being the pile plus twice the gap held off the pile wall.

A pancake places the full disc with nothing deducted, which is only possible
before the pile is driven. Post-lay is necessarily an annulus, so a post-lay
pancake resolves to a donut and says so. Shape and lay phase are set per layer,
so a pre-lay pancake filter under a post-lay donut armour is expressible, as is
a pre-lay donut.

Cable corridors are removed by integrating the layer profile over each
corridor's own radial band and angular share. A corridor never pinches to
nothing at the pile, because it carries a minimum width as well as an angle, and
the rock falls away at the design slope on both faces.

### Quantities

```
bulk density = solid density x fill factor       (fill factor = 1 - porosity)
tonnage      = design volume x volume allowance x bulk density
```

Three quantities are kept distinct:

- **Nominal** — as drawn.
- **Upper tolerance bound** — every tolerance at its adverse bound.
- **Ordered and scheduled** — the upper bound, plus any contingency on top.

The upper bound is the default basis. Ordering against nominal is possible but
raises an error, because a tolerance can add a large share of the volume and
leaving it out is how a campaign runs short of rock offshore.

### Logistics and programme

```
cargo per trip = payload x utilisation           (or hold volume x bulk density, if set)
loading        = quantity / min(quay rate, vessel rate)
transit        = distance / speed, both legs, every trip
dumping        = sum over layers of tonnes / layer rate, plus contingency

elapsed = working / (1 - weather downtime)
total   = elapsed x (1 + maintenance) + mobilisation
```

Activities are charged where they occur: surveys once per location, positioning
and fallpipe handling on every visit, loading and transit once per trip. A
location is completed in a single visit wherever the cargo allows, with the
surplus either carried back and topped up or placed at the next location, your
choice.

Quarry-to-site distance is routed over navigable water rather than taken as a
straight line, so it goes round Scotland or through the Danish straits where it
has to.

---

## Limitations

State these alongside any output.

- **Not a passage plan.** Sea distances follow navigable water but ignore
  traffic separation schemes, depth, ice and weather routing, so they read a few
  per cent short of a navigated distance.
- **Quarry positions are approximate.** They are load-out points placed from
  public information, not surveyed quay coordinates. Correct them.
- **Vessel library figures are typical for the class**, not a specific ship's
  certified data. Check them against the vessel being priced, then save your
  corrected version to the library.
- **Weather is a single downtime percentage**, not a metocean time series, so
  seasonal variation is not captured.
- **Vessels are assumed to work in parallel and independently.** No shared
  berth, quarry queue or single loading point is modelled.
- **Cost, fuel, emissions and probabilistic (P50/P80) schedule risk** are out of
  scope.
- The default cycle durations are on the optimistic side. Calibrate them against
  a completed campaign before relying on the duration.

---

## Printing

Use **Save the report as a file** on the Report tab. It writes a standalone HTML
document with the report, its styling and the site plan baked in, which opens as
an ordinary page with a Print button. Print it and choose "Save as PDF".

The direct print buttons work when the tool is open in a browser tab of its own.
They cannot work inside a preview pane, where printing reaches the surrounding
page and new windows are blocked. The tool detects that and says so rather than
failing silently.

---

## Data sources

- Coastline for the sea routing: **Natural Earth** 10m land polygons, via
  `world-atlas`. Natural Earth is in the public domain.
- The routing network is a sea and land mask of northwest Europe at 0.05
  degrees, rasterised from that coastline and reduced to the single connected
  body of water reaching the North Sea. It is embedded as run-length encoded
  data, about 7 kB, so the tool needs no network access.

Coverage is 16W to 31E, 47N to 72.5N: the Celtic Sea and Irish Sea through the
Channel, the North Sea, the Norwegian Sea, and through the Danish straits into
the Baltic. Outside that the tool says so rather than guessing.

---

## Verification

The calculation engine is separate from the interface and is covered by an
automated suite of roughly 280 assertions across 28 files, run before each
release. It checks, among other things:

- analytic volumes against independent numerical integration
- the truncated-cone and crest-plus-skirt forms agreeing exactly
- every shape and lay phase combination
- cargo, trip and leftover arithmetic
- tolerance propagation into the ordered quantity
- sea routing against known geography
- the interface rendering in blank, example and user states

The programme model is calibrated against a completed campaign and reproduces
its trip count exactly and its total hours to 0.28%.

---

## Contributing and support

This is an internal engineering tool. If a number looks wrong, the fastest route
to a fix is the inputs that produced it: use **Export project** and send the
`.json` with a note on what you expected.
