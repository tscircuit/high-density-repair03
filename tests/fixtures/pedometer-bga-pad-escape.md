This is a reduced capture of pedometer v1.0.6 immediately before Pipeline9's
joint DRC repair stage.

Source: https://tscircuit.com/seveibar/pedometer?version=1.0.6#pcb

The route geometry is unchanged from the capture. The fixture retains
`source_trace_44`, its connection, the BGA component's pads, and its terminal
pads. Unrelated routes and obstacles are omitted; obstacle connectivity aliases
are reduced to pad identity, net identity, and the relevant route/port aliases.

The trace crosses `pcb_smtpad_34` with about -0.019 mm clearance against a
required 0.05 mm. The shared repair moves the interior bends into the channel
between pads, leaving the terminal positions and vias unchanged.
