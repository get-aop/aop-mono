# Review Dimensions

Detailed checklists for each review dimension. Use these to systematically probe the proposal.

---

## Problem Clarity

Is the problem well-defined?

**Questions to ask:**
- Who has this problem? How many users? How painful?
- What's the current workaround? Why isn't that good enough?
- Is this a symptom of a deeper problem?
- What happens if we don't solve this?

**Red flags:**
- [ ] Problem described in solution terms ("we need X feature")
- [ ] No clear user/persona identified
- [ ] Problem scope keeps expanding during discussion
- [ ] Multiple unrelated problems bundled together

---

## Solution Fit

Does the solution actually solve the problem?

**Questions to ask:**
- How does this solution address the root cause?
- What percentage of the problem does this solve?
- Are there simpler solutions we haven't considered?
- Will users actually use this?

**Red flags:**
- [ ] Solution solves adjacent problem, not stated problem
- [ ] Over-engineered for the actual need
- [ ] Requires user behavior change that's unlikely
- [ ] "Build it and they will come" assumption

---

## Scope

Is the scope right-sized?

**Questions to ask:**
- Can this be split into smaller increments?
- What's the MVP? What can be deferred?
- Are there bundled features that should be separate?
- What's the blast radius of this change?

**Red flags:**
- [ ] "While we're at it..." additions
- [ ] V1 includes nice-to-haves
- [ ] No clear boundary between must-have and could-have
- [ ] Dependencies on multiple unbuilt systems

**Scope sizing heuristics:**
```
┌─────────────────────────────────────────────────────────┐
│                    SCOPE SMELL                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Tasks > 10          → Probably too big                │
│   Design > 3 pages    → Probably over-specified         │
│   "Phase 2" mentioned → V1 scope creep likely           │
│   Multiple "new"      → Consider splitting              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture

Does it fit the existing system?

**Questions to ask:**
- How does this interact with existing components?
- Are we introducing new patterns? Why?
- What existing patterns does this violate?
- Where does this live in the dependency graph?

**Red flags:**
- [ ] New patterns without justification
- [ ] Circular dependencies introduced
- [ ] Responsibility overlap with existing modules
- [ ] Ignores existing utilities/helpers
- [ ] Breaks encapsulation of existing abstractions

**Integration checklist:**
- [ ] Entry points identified
- [ ] Data flow mapped
- [ ] Error propagation clear
- [ ] Existing APIs sufficient or changes specified

---

## Scalability

What happens at scale?

**Questions to ask:**
- What's the expected load? Now vs. 6 months vs. 1 year?
- What happens at 10x current scale? 100x?
- Where are the bottlenecks?
- What's the cost curve?

**Red flags:**
- [ ] O(n²) or worse algorithms without justification
- [ ] Unbounded data structures
- [ ] No rate limiting or back-pressure
- [ ] Single points of failure
- [ ] "We'll optimize later" for known hot paths

**Scale thinking:**
```
┌─────────────────────────────────────────────────────────┐
│               SCALE PRESSURE POINTS                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Data volume    │ What if dataset is 100x bigger?     │
│   Request rate   │ What if QPS is 100x higher?         │
│   Concurrency    │ What if 100 users hit this at once? │
│   Payload size   │ What if inputs are 100x larger?     │
│   Time duration  │ What if this runs for hours?        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Feasibility

Is this actually buildable?

**Questions to ask:**
- Do we have the skills/knowledge to build this?
- Are there hard technical constraints we're ignoring?
- What third-party dependencies are required? Reliable?
- What's the testing strategy for this?

**Red flags:**
- [ ] "Should be straightforward" for novel problems
- [ ] Dependencies on APIs/services with unknown reliability
- [ ] Requires capabilities we haven't built before
- [ ] No clear path to production (deploy, monitor, rollback)
- [ ] Testing strategy TBD

**Feasibility probes:**
- Can you write pseudocode for the hardest part?
- What's the first thing that would break if we started building?
- Have we built something similar before?

---

## Risks & Unknowns

What could go wrong?

**Questions to ask:**
- What are the top 3 things that could derail this?
- What don't we know that we need to know?
- What assumptions are we making?
- What's the rollback strategy if this fails?

**Red flags:**
- [ ] No risks section or "none identified"
- [ ] Assumptions stated as facts
- [ ] "We'll cross that bridge when we come to it"
- [ ] Single path to success with no contingency
- [ ] External dependencies without fallbacks

**Risk categories:**
```
┌─────────────────────────────────────────────────────────┐
│                    RISK TAXONOMY                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Technical   │ Will the approach actually work?       │
│   Integration │ Will it play nice with existing?       │
│   Dependency  │ Will third parties deliver?            │
│   Security    │ Are we creating vulnerabilities?       │
│   Performance │ Will it be fast enough?                │
│   Operational │ Can we run this in production?         │
│   Adoption    │ Will users actually use it?            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Trade-offs

What are we giving up?

**Questions to ask:**
- What alternatives were considered? Why rejected?
- What are we explicitly NOT doing?
- What technical debt are we accepting?
- What's the cost of this trade-off long-term?

**Red flags:**
- [ ] No alternatives considered
- [ ] Trade-offs not explicitly stated
- [ ] "No downsides" claims
- [ ] Short-term convenience over long-term health
- [ ] Irreversible decisions made casually

**Trade-off documentation:**
```markdown
Good:
"We're choosing X over Y because Z. This means we lose A,
but we gain B, which is more valuable because C."

Bad:
"We're using X."
```

---

## Coherence

Do the artifacts tell a consistent story?

**Questions to ask:**
- Does the design actually solve what the proposal claims?
- Do the tasks actually build what the design describes?
- Are capabilities/specs consistent with the design?
- Are there contradictions between artifacts?

**Red flags:**
- [ ] Proposal says X, design builds Y
- [ ] Tasks don't cover all design components
- [ ] Specs describe different behavior than design
- [ ] Scope expanded in design without proposal update
- [ ] "TBD" or "TODO" in critical sections

**Coherence matrix:**
```
┌─────────────────────────────────────────────────────────┐
│              ARTIFACT CONSISTENCY CHECK                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   proposal.md → design.md                               │
│     Does design solve the stated problem?               │
│     Is scope consistent?                                │
│                                                         │
│   design.md → specs/*.md                                │
│     Do specs match design decisions?                    │
│     Are all components specified?                       │
│                                                         │
│   design.md → tasks.md                                  │
│     Do tasks build all design components?               │
│     Is task ordering sensible?                          │
│                                                         │
│   specs/*.md → tasks.md                                 │
│     Do tasks implement all spec requirements?           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
