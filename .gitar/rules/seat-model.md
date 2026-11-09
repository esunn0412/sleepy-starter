---
title: "kubeseat: seat model"
description: "Attendee Pods must keep the scheduler's seat semantics: 1 seat, integer weights, access needs as hard rules"
type: check
when: "PRs that change how attendee Pods, room Nodes or their affinity, tolerations or priority are built (app/seats.js, app/elastic.js, or any code that creates Pods or Nodes in the seat cluster)"
actions: "Comment on each violation with the file and line, and request changes"
---

# kubeseat seat model

kubeseat seats conference attendees with the real kube-scheduler: rooms are Nodes in a private
KWOK seat cluster, attendees are Pods. Flag any change that breaks these:

- Every attendee Pod requests exactly 1 `conf.io/seat`, with requests equal to limits, and no CPU or memory.
- Preferred node-affinity weights are integers from 1 to 100. Elastic scores are scaled into that range; never raw floats.
- Access needs (step-free, captions, low-sensory) use REQUIRED node affinity, never preferred.
- Accessible seats are a tainted Node pool (`conf.io/accessible-seats=true:NoSchedule`). Only Pods of attendees who need it carry the toleration.
- PriorityClasses use `preemptionPolicy: Never`, so nobody loses a seat they already have.
- Ranking at popular talks uses the Elastic auto-score, not user-edited weights.
- Changing room labels must re-seat Pods already bound there (node affinity is IgnoredDuringExecution).
