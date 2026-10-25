# Workflow machines and pure selection

Use explicit state machines for meaningful lifecycle and coordination behavior, and pure functions for parsing, scoring, validation, and lineup assignment. Provider adapters interpret provider mechanics and rules; selection policy is separately informed by sport and league context.

This separates recovery and sequencing from mathematical selection, instead of encoding the assignment algorithm as imperative workflow transitions or forcing every computation into a state machine. Machine boundaries, durability mechanisms, and solver implementation remain undecided.
