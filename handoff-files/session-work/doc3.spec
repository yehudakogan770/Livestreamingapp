@@@
and the second — has not changed). Not yet: graphics inputs' tiles show only
while they are on air on the Live Screen (their planes are the renderer's).
===
and the second — has not changed). A graphics input's tile shows its `g:`
plane while it is on air on the Live Screen; otherwise the Live Screen's
renderer draws it for the multiview alone, at the tile's size
(`mv:g:<input>`, `overlayPlanes.ts: multiviewPlanes`, Phase 3).
@@@
| `n:g:<input>`     |
===
| `mv:g:<input>`    | a graphics input's multiview tile while it isn't on air on the Live Screen, at the tile's size | in its multiview tile |
| `n:g:<input>`     |
