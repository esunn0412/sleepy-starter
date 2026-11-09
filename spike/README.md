# kubeseat feasibility spike

**Status: throwaway prep work, written before the hackathon's coding window. Not the submission.**
It lives in `spike/` on `main` as reference; the app in `app/` is the submission.

## The question

Does the real, unmodified kube-scheduler seat conference attendees the way kubeseat needs, if
rooms are Nodes and attendees are Pods?

## How it works

`main.go` runs the stock kube-scheduler from Kubernetes v1.34.1 (default profile, no plugins
added) in-process against an in-memory Kubernetes API (client-go's fake clientset).

| Conference | Kubernetes |
| --- | --- |
| Room | Node advertising the extended resource `conf.io/seat` |
| Attendee | Pod requesting 1 `conf.io/seat` |
| Interests (1–100) | Weighted preferred node affinity on label `conf.io/talk` |
| Must-see talk | Required node affinity |
| Needs step-free access | Required node affinity on `access.conf.io/step-free=true` |
| Accessible-seat pool | Tainted node + toleration + preferred affinity to steer into it |
| Friends | Preferred pod affinity on the same `kubernetes.io/hostname` |
| More capacity (spike-only test) | Adding a Node; the app has no overflow room, organizers change capacity or swap rooms |

The only emulation: the fake API doesn't persist Bindings, so a small reactor sets
`spec.nodeName` when the scheduler binds, as the real API server would.

## Results

All checks pass at 1,000 and 3,000 attendees (see `results-*.txt`).

1. **Interests become seat choices.** Each person lands in their highest-weighted talk.
2. **Seats are a hard limit.** 5 fans for a 3-seat room: 3 get it, 2 fall back to their next choice. No room ever goes over capacity.
3. **Must-see + full room = Pending, with a reason.** Kubernetes says `Insufficient conf.io/seat`. Adding an overflow node seats them all in about 100 ms.
4. **Access is enforced.** The step-free attendee never lands in a room with stairs. The accessible pool is used only by the person who needs it; someone else stays Pending rather than take it (`untolerated taint`).
5. **Friends sit together.** Pod affinity overrides a weak preference to keep two friends in one room.
6. **Scale.** 1,000 attendees into 12 rooms of 100 seats: all seated in about 5.4 s (about 180 attendees/s on 2 CPUs). 3,000 attendees: 1,200 seated, 1,800 Pending, in about 17.5 s.

## Findings that change the design

- **Steer access needs into the reserved pool.** Without a preference toward the pool, a person who needs an accessible seat can take a general seat instead and push someone else out. A weight-100 preferred affinity to `conf.io/pool=accessible` fixes it.
- **The scheduler is first-come, first-served, not a global optimizer.** Earlier requests get seats first. That's fair and explainable, but a "fair launch" (everyone submits, then seat in a random or priority order) needs the app to control the order. PriorityClass could favour first-timers.
- **No workable preference = any room.** If every room someone picked is impossible for them (for example all have stairs), the scheduler seats them in any room that fits. The app should flag "no match for your needs" instead of seating them silently.
- **Pending messages need translating.** The raw text includes preemption details nobody needs; show "Room full" or "No step-free room for this talk."

## Not tested here (still open)

- A real kube-apiserver and KWOK nodes; a real API server adds network latency per pod.
- Whether this runs inside the hackathon's vcluster (see the game-plan doc).

## Run it

```
./run.sh                  # 1,000 attendees in the scale test
./run.sh -attendees 3000
```

Needs Go 1.24+ and git. It clones Kubernetes v1.34.1 once (about 360 MB) and builds with its
vendored dependencies.
