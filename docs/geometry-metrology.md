# Geometry metrology

Use SVG import whenever vector source exists. Raster tracing is for raster-only
references; reconstructing an SVG from its screenshot discards exact paths and
group identity before work begins.

`heron match` reports coverage overlap, coverage ratio, binary overlap, boundary
cost, and stroke-width probes. Read coverage ratio first for systematic thickness
error. Read boundary cost before interpreting overlap: it converts a percentage
shortfall into the approximate cost of uniform one-pixel edge displacement.

Choose geometry by what is measurable:

- constant-width run: `through(points, { stroke, width })`;
- varying-width run: `ribbon(points, widths)`;
- fitted circle or arc: `arc()`;
- deliberate corners or compact tight curls: `path({ d })`;
- imported source geometry: `svgShape(tag, attrs)` as emitted by `heron import`.

Trace outputs named measured runs. Keep them as data. `cutRun` and `joinRuns`
update point and width arrays together, preventing the index drift caused by
editing parallel numeric lists independently.

Tracing recovers ink, not anatomy. Skeleton forks are candidate joints, not a
semantic rig. Use `heron shapes` to identify runs, group them into nested parts,
add measured pivots, then run match again to prove the rest pose did not drift.
