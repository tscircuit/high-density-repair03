# SRJ18 repair inputs

These fixtures are the serialized inputs to `GlobalDrcForceImproveSolver`, not
the original SRJ18 boards or their KiCad traces.

They were captured from canonical
`tscircuit/tscircuit-autorouter@c5446f9b86efb32c3e033dada58635d7cbd95cd6`
using `AutoroutingPipelineSolver7_MultiGraph`. Each capture stops immediately
after the `globalDrcForceImproveSolver` is constructed and before that solver
takes its first step.

Each gzip-compressed JSON file contains:

- the transformed `srjWithPointPairs` scene used by repair03;
- terminal-locked, width-adjusted `hdRoutes`;
- the serializable repair options; and
- autorouter commit, pipeline, and stage provenance.

The fixtures are checked in so normal repair03 benchmarks do not run or depend
on the autorouter or `dataset-srj18`.
