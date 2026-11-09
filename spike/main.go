// kubeseat feasibility spike.
//
// Runs the real, unmodified kube-scheduler (default profile, v1.34) in-process
// against an in-memory Kubernetes API (client-go fake clientset). Rooms are
// Nodes that advertise an extended resource "conf.io/seat"; attendees are Pods
// that request one seat. Interests are weighted preferred node affinity, access
// needs are required node affinity, an accessible-seat pool is a tainted node,
// friends are preferred pod affinity.
//
// Nothing here talks to a real cluster. It answers one question: does the stock
// scheduler produce the seating behaviour kubeseat needs?
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/events"
	"k8s.io/klog/v2"
	"k8s.io/kubernetes/pkg/scheduler"
	"k8s.io/kubernetes/pkg/scheduler/profile"
)

const (
	ns       = "conf"
	seat     = v1.ResourceName("conf.io/seat")
	talkKey  = "conf.io/talk"
	stepFree = "access.conf.io/step-free"
	accTaint = "conf.io/accessible-seats"
)

var podsGVR = schema.GroupVersionResource{Version: "v1", Resource: "pods"}

// ---------- object builders ----------

type room struct {
	name     string
	talk     string
	seats    int64
	stepFree bool
	// accessible marks a reserved accessible-seat pool for the talk.
	accessible bool
}

func node(r room) *v1.Node {
	n := &v1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: r.name,
			UID:  types.UID("node-" + r.name),
			Labels: map[string]string{
				"kubernetes.io/hostname": r.name,
				talkKey:                  r.talk,
				stepFree:                 fmt.Sprint(r.stepFree),
			},
		},
		Status: v1.NodeStatus{
			Capacity:    v1.ResourceList{},
			Allocatable: v1.ResourceList{},
			Conditions:  []v1.NodeCondition{{Type: v1.NodeReady, Status: v1.ConditionTrue}},
		},
	}
	for _, rl := range []v1.ResourceList{n.Status.Capacity, n.Status.Allocatable} {
		rl[seat] = *resource.NewQuantity(r.seats, resource.DecimalSI)
		// Generous cpu/memory/pods so seats are the only real limit.
		rl[v1.ResourceCPU] = resource.MustParse("100000")
		rl[v1.ResourceMemory] = resource.MustParse("100000Gi")
		rl[v1.ResourcePods] = resource.MustParse("100000")
	}
	n.Labels["conf.io/pool"] = "general"
	if r.accessible {
		n.Labels["conf.io/pool"] = "accessible"
		n.Spec.Taints = []v1.Taint{{Key: accTaint, Value: "true", Effect: v1.TaintEffectNoSchedule}}
	}
	return n
}

type pref struct {
	talk   string
	weight int32 // 1..100, from Elastic similarity in the real app
}

type attendee struct {
	name      string
	prefs     []pref
	mustSee   string // required affinity to one talk (a pinned talk)
	stepFree  bool   // requires a step-free room
	needsSeat bool   // tolerates the accessible-seat pool
	friends   string // friend group label; preferred same-room
}

func pod(a attendee) *v1.Pod {
	p := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: a.name, Namespace: ns, UID: types.UID("pod-" + a.name),
			Labels: map[string]string{"app": "attendee"},
		},
		Spec: v1.PodSpec{
			SchedulerName: v1.DefaultSchedulerName,
			Containers: []v1.Container{{
				Name: "seat", Image: "none",
				Resources: v1.ResourceRequirements{
					Requests: v1.ResourceList{seat: resource.MustParse("1")},
					Limits:   v1.ResourceList{seat: resource.MustParse("1")},
				},
			}},
			Affinity: &v1.Affinity{NodeAffinity: &v1.NodeAffinity{}},
		},
	}
	na := p.Spec.Affinity.NodeAffinity
	for _, pr := range a.prefs {
		na.PreferredDuringSchedulingIgnoredDuringExecution = append(na.PreferredDuringSchedulingIgnoredDuringExecution,
			v1.PreferredSchedulingTerm{Weight: pr.weight, Preference: v1.NodeSelectorTerm{
				MatchExpressions: []v1.NodeSelectorRequirement{{Key: talkKey, Operator: v1.NodeSelectorOpIn, Values: []string{pr.talk}}},
			}})
	}
	var req []v1.NodeSelectorRequirement
	if a.mustSee != "" {
		req = append(req, v1.NodeSelectorRequirement{Key: talkKey, Operator: v1.NodeSelectorOpIn, Values: []string{a.mustSee}})
	}
	if a.stepFree {
		req = append(req, v1.NodeSelectorRequirement{Key: stepFree, Operator: v1.NodeSelectorOpIn, Values: []string{"true"}})
	}
	if len(req) > 0 {
		na.RequiredDuringSchedulingIgnoredDuringExecution = &v1.NodeSelector{
			NodeSelectorTerms: []v1.NodeSelectorTerm{{MatchExpressions: req}},
		}
	}
	if a.needsSeat {
		p.Spec.Tolerations = []v1.Toleration{{Key: accTaint, Operator: v1.TolerationOpEqual, Value: "true", Effect: v1.TaintEffectNoSchedule}}
		// Steer people who need an accessible seat into the reserved pool, so
		// they do not use up a general seat someone else could take.
		na.PreferredDuringSchedulingIgnoredDuringExecution = append(na.PreferredDuringSchedulingIgnoredDuringExecution,
			v1.PreferredSchedulingTerm{Weight: 100, Preference: v1.NodeSelectorTerm{
				MatchExpressions: []v1.NodeSelectorRequirement{{Key: "conf.io/pool", Operator: v1.NodeSelectorOpIn, Values: []string{"accessible"}}},
			}})
	}
	if a.friends != "" {
		p.Labels["conf.io/friends"] = a.friends
		p.Spec.Affinity.PodAffinity = &v1.PodAffinity{PreferredDuringSchedulingIgnoredDuringExecution: []v1.WeightedPodAffinityTerm{{
			Weight: 100,
			PodAffinityTerm: v1.PodAffinityTerm{
				LabelSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"conf.io/friends": a.friends}},
				TopologyKey:   "kubernetes.io/hostname",
			},
		}}}
	}
	return p
}

// ---------- harness ----------

type harness struct {
	ctx    context.Context
	cancel context.CancelFunc
	client *fake.Clientset
	mu     sync.Mutex
	bound  map[string]time.Time
}

func newHarness() (*harness, error) {
	ctx, cancel := context.WithCancel(context.Background())
	client := fake.NewClientset()
	h := &harness{ctx: ctx, cancel: cancel, client: client, bound: map[string]time.Time{}}

	// The fake API does not persist Bindings, so emulate the API server:
	// a Binding sets spec.nodeName on the pod.
	client.PrependReactor("create", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		ca, ok := action.(clienttesting.CreateAction)
		if !ok || action.GetSubresource() != "binding" {
			return false, nil, nil
		}
		b := ca.GetObject().(*v1.Binding)
		obj, err := client.Tracker().Get(podsGVR, b.Namespace, b.Name)
		if err != nil {
			return true, nil, err
		}
		p := obj.(*v1.Pod).DeepCopy()
		p.Spec.NodeName = b.Target.Name
		if err := client.Tracker().Update(podsGVR, p, b.Namespace); err != nil {
			return true, nil, err
		}
		h.mu.Lock()
		h.bound[b.Name] = time.Now()
		h.mu.Unlock()
		return true, b, nil
	})

	factory := informers.NewSharedInformerFactory(client, 0)
	broadcaster := events.NewBroadcaster(&events.EventSinkImpl{Interface: client.EventsV1()})
	sched, err := scheduler.New(ctx, client, factory, nil, profile.NewRecorderFactory(broadcaster),
		scheduler.WithPodInitialBackoffSeconds(1), scheduler.WithPodMaxBackoffSeconds(1))
	if err != nil {
		cancel()
		return nil, err
	}
	broadcaster.StartRecordingToSink(ctx.Done())
	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())
	go sched.Run(ctx)
	return h, nil
}

// stop lets in-flight binding cycles finish before tearing the scheduler down,
// so shutdown doesn't interrupt a bind that the checks already observed.
func (h *harness) stop() {
	time.Sleep(300 * time.Millisecond)
	h.cancel()
}

func (h *harness) addRooms(rs ...room) {
	for _, r := range rs {
		if _, err := h.client.CoreV1().Nodes().Create(h.ctx, node(r), metav1.CreateOptions{}); err != nil {
			panic(err)
		}
	}
}

func (h *harness) addAttendees(as ...attendee) {
	for _, a := range as {
		if _, err := h.client.CoreV1().Pods(ns).Create(h.ctx, pod(a), metav1.CreateOptions{}); err != nil {
			panic(err)
		}
	}
}

type result struct {
	name, room, reason string
}

// settle waits until every pod is either bound or marked unschedulable.
func (h *harness) settle(timeout time.Duration) []result {
	deadline := time.Now().Add(timeout)
	for {
		pods, _ := h.client.CoreV1().Pods(ns).List(h.ctx, metav1.ListOptions{})
		done, out := true, make([]result, 0, len(pods.Items))
		for _, p := range pods.Items {
			r := result{name: p.Name, room: p.Spec.NodeName}
			if r.room == "" {
				for _, c := range p.Status.Conditions {
					if c.Type == v1.PodScheduled && c.Status == v1.ConditionFalse {
						r.reason = c.Message
					}
				}
				if r.reason == "" {
					done = false
				}
			}
			out = append(out, r)
		}
		if done || time.Now().After(deadline) {
			sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
			return out
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func roomOf(rs []result, name string) result {
	for _, r := range rs {
		if r.name == name {
			return r
		}
	}
	return result{}
}

// ---------- checks ----------

var failures int

func check(ok bool, format string, args ...any) {
	mark := "PASS"
	if !ok {
		mark = "FAIL"
		failures++
	}
	fmt.Printf("  [%s] %s\n", mark, fmt.Sprintf(format, args...))
}

func show(rs []result) {
	for _, r := range rs {
		if r.room != "" {
			fmt.Printf("    %-10s -> %s\n", r.name, r.room)
		} else {
			fmt.Printf("    %-10s -> Pending: %s\n", r.name, r.reason)
		}
	}
}

// ---------- scenarios ----------

func scenarioPreferences() {
	fmt.Println("\n1. Interests become seat choices (weighted preferred affinity)")
	h, err := newHarness()
	if err != nil {
		panic(err)
	}
	defer h.stop()
	h.addRooms(
		room{name: "room-155", talk: "ebpf-security", seats: 10, stepFree: true},
		room{name: "room-251", talk: "cilium-101", seats: 10, stepFree: true},
		room{name: "room-355", talk: "wasm-edge", seats: 10, stepFree: false},
	)
	h.addAttendees(
		attendee{name: "priya", prefs: []pref{{"ebpf-security", 87}, {"cilium-101", 62}}},
		attendee{name: "marco", prefs: []pref{{"wasm-edge", 91}, {"ebpf-security", 20}}},
		attendee{name: "lee", prefs: []pref{{"cilium-101", 75}, {"wasm-edge", 30}}},
	)
	rs := h.settle(10 * time.Second)
	show(rs)
	check(roomOf(rs, "priya").room == "room-155", "priya gets her top interest (eBPF, weight 87)")
	check(roomOf(rs, "marco").room == "room-355", "marco gets his top interest (Wasm, weight 91)")
	check(roomOf(rs, "lee").room == "room-251", "lee gets his top interest (Cilium, weight 75)")
}

func scenarioCapacityAndPlanB() {
	fmt.Println("\n2. Seats are a hard limit; extra people fall back to their next choice")
	h, _ := newHarness()
	defer h.stop()
	h.addRooms(
		room{name: "room-155", talk: "ebpf-security", seats: 3, stepFree: true},
		room{name: "room-251", talk: "cilium-101", seats: 10, stepFree: true},
	)
	var as []attendee
	for i := 1; i <= 5; i++ {
		as = append(as, attendee{name: fmt.Sprintf("fan-%d", i), prefs: []pref{{"ebpf-security", 90}, {"cilium-101", 40}}})
	}
	h.addAttendees(as...)
	rs := h.settle(10 * time.Second)
	show(rs)
	in155 := 0
	for _, r := range rs {
		if r.room == "room-155" {
			in155++
		}
	}
	check(in155 == 3, "exactly 3 seated in the 3-seat eBPF room (got %d)", in155)
	pend := 0
	for _, r := range rs {
		if r.room == "" {
			pend++
		}
	}
	check(pend == 0, "nobody left without a seat while Cilium has room (pending %d)", pend)
}

func scenarioMustSeeAndOverflow() {
	fmt.Println("\n3. Must-see talk: full room means Pending with a reason; an overflow room seats them")
	h, _ := newHarness()
	defer h.stop()
	h.addRooms(
		room{name: "room-155", talk: "ebpf-security", seats: 2, stepFree: true},
		room{name: "room-251", talk: "cilium-101", seats: 10, stepFree: true},
	)
	h.addAttendees(
		attendee{name: "pin-1", mustSee: "ebpf-security"},
		attendee{name: "pin-2", mustSee: "ebpf-security"},
		attendee{name: "pin-3", mustSee: "ebpf-security"},
		attendee{name: "pin-4", mustSee: "ebpf-security"},
	)
	rs := h.settle(10 * time.Second)
	show(rs)
	pending := 0
	reason := ""
	for _, r := range rs {
		if r.room == "" {
			pending++
			reason = r.reason
		}
	}
	check(pending == 2, "2 of 4 are Pending (got %d)", pending)
	check(strings.Contains(reason, "Insufficient conf.io/seat"), "Pending reason names the seat shortage: %q", reason)

	fmt.Println("  organizer adds overflow room room-155b (same talk, 50 seats)...")
	t0 := time.Now()
	h.addRooms(room{name: "room-155b", talk: "ebpf-security", seats: 50, stepFree: true})
	var rs2 []result
	for time.Since(t0) < 15*time.Second {
		rs2 = h.settle(1 * time.Second)
		left := 0
		for _, r := range rs2 {
			if r.room == "" {
				left++
			}
		}
		if left == 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	show(rs2)
	left := 0
	for _, r := range rs2 {
		if r.room == "" {
			left++
		}
	}
	check(left == 0, "all Pending people seated after overflow added, in %v", time.Since(t0).Round(time.Millisecond))
}

func scenarioAccess() {
	fmt.Println("\n4. Access needs are hard constraints; the accessible-seat pool is protected")
	h, _ := newHarness()
	defer h.stop()
	h.addRooms(
		room{name: "room-355", talk: "wasm-edge", seats: 1, stepFree: false},
		room{name: "room-155", talk: "wasm-edge", seats: 1, stepFree: true},
		room{name: "room-155-acc", talk: "wasm-edge", seats: 2, stepFree: true, accessible: true},
	)
	h.addAttendees(
		attendee{name: "ana", stepFree: true, needsSeat: true, mustSee: "wasm-edge"},
		attendee{name: "ben", mustSee: "wasm-edge"},
		attendee{name: "cy", mustSee: "wasm-edge"},
		attendee{name: "dee", mustSee: "wasm-edge"},
	)
	rs := h.settle(10 * time.Second)
	show(rs)
	check(roomOf(rs, "ana").room != "room-355", "step-free attendee never placed in the room with stairs (got %s)", roomOf(rs, "ana").room)
	inAcc := []string{}
	for _, r := range rs {
		if r.room == "room-155-acc" {
			inAcc = append(inAcc, r.name)
		}
	}
	onlyAna := true
	for _, n := range inAcc {
		if n != "ana" {
			onlyAna = false
		}
	}
	check(onlyAna && len(inAcc) == 1, "the person who needs it gets an accessible seat, and only they use the pool (in pool: %v)", inAcc)
	seated := 0
	var pend result
	for _, r := range rs {
		if r.room != "" {
			seated++
		} else {
			pend = r
		}
	}
	check(seated == 3, "both general seats go to others, so 3 of 4 are seated (got %d)", seated)
	check(pend.room == "" && strings.Contains(pend.reason, "untolerated taint"),
		"the 4th person stays Pending rather than taking the spare accessible seat: %q", pend.reason)
}

func scenarioFriends() {
	fmt.Println("\n5. Friends prefer the same room (preferred pod affinity)")
	h, _ := newHarness()
	defer h.stop()
	h.addRooms(
		room{name: "room-155", talk: "ebpf-security", seats: 10, stepFree: true},
		room{name: "room-251", talk: "cilium-101", seats: 10, stepFree: true},
	)
	// sam slightly prefers Cilium but has a friend in eBPF.
	h.addAttendees(attendee{name: "kim", prefs: []pref{{"ebpf-security", 90}}, friends: "g1"})
	time.Sleep(500 * time.Millisecond)
	h.addAttendees(attendee{name: "sam", prefs: []pref{{"cilium-101", 30}, {"ebpf-security", 25}}, friends: "g1"})
	rs := h.settle(10 * time.Second)
	show(rs)
	check(roomOf(rs, "sam").room == roomOf(rs, "kim").room, "sam sits with friend kim (%s)", roomOf(rs, "kim").room)
}

func scenarioScale(attendees, rooms int, seatsPer int64) {
	fmt.Printf("\n6. Scale: %d attendees, %d rooms x %d seats\n", attendees, rooms, seatsPer)
	h, _ := newHarness()
	defer h.stop()
	talks := []string{}
	for i := 0; i < rooms; i++ {
		t := fmt.Sprintf("talk-%02d", i)
		talks = append(talks, t)
		h.addRooms(room{name: fmt.Sprintf("room-%02d", i), talk: t, seats: seatsPer, stepFree: i%3 != 0})
	}
	// Skewed demand: everyone's top choice is one of the first 3 talks.
	t0 := time.Now()
	var as []attendee
	for i := 0; i < attendees; i++ {
		as = append(as, attendee{
			name:     fmt.Sprintf("a-%04d", i),
			prefs:    []pref{{talks[i%3], 90}, {talks[3+i%(rooms-3)], 50}, {talks[(i*7)%rooms], 20}},
			stepFree: i%25 == 0,
		})
	}
	h.addAttendees(as...)
	rs := h.settle(120 * time.Second)
	elapsed := time.Since(t0)
	seated, pending := 0, 0
	perRoom := map[string]int{}
	for _, r := range rs {
		if r.room != "" {
			seated++
			perRoom[r.room]++
		} else {
			pending++
		}
	}
	over := 0
	for _, n := range perRoom {
		if int64(n) > seatsPer {
			over++
		}
	}
	fmt.Printf("    seated %d, pending %d, in %v (%.0f attendees/s)\n", seated, pending, elapsed.Round(time.Millisecond), float64(attendees)/elapsed.Seconds())
	top := 0
	for _, r := range rs {
		var idx int
		fmt.Sscanf(r.name, "a-%04d", &idx)
		if r.room == fmt.Sprintf("room-%02d", idx%3) {
			top++
		}
	}
	fmt.Printf("    got first choice: %d of %d (first-choice rooms hold %d seats)\n", top, attendees, 3*seatsPer)
	// A seat in a first-choice room should only go to someone else if that
	// person had no workable preference (e.g. needs step-free access and every
	// room they picked has stairs). Rooms with index divisible by 3 have stairs.
	hasStairs := func(k int) bool { return k%3 == 0 }
	unfair := 0
	for _, r := range rs {
		var idx int
		fmt.Sscanf(r.name, "a-%04d", &idx)
		for k := 0; k < 3; k++ {
			if r.room != fmt.Sprintf("room-%02d", k) || idx%3 == k {
				continue
			}
			workable := false
			for _, choice := range []int{idx % 3, 3 + idx%(rooms-3), (idx * 7) % rooms} {
				if !(idx%25 == 0 && hasStairs(choice)) {
					workable = true
				}
			}
			fmt.Printf("    seat in %s went to %s, whose picks all had stairs: %v\n", r.room, r.name, !workable)
			if workable {
				unfair++
			}
		}
	}
	check(over == 0, "no room over capacity")
	check(int64(seated) == min(int64(attendees), int64(rooms)*seatsPer), "everyone seated who can be (seated %d)", seated)
	check(unfair == 0, "first-choice seats only go elsewhere when the person had no workable preference (%d did)", unfair)
}

func main() {
	n := flag.Int("attendees", 1000, "attendees in the scale scenario")
	flag.Parse()
	klog.LogToStderr(false)
	klog.SetOutput(io.Discard)

	scenarioPreferences()
	scenarioCapacityAndPlanB()
	scenarioMustSeeAndOverflow()
	scenarioAccess()
	scenarioFriends()
	scenarioScale(*n, 12, 100)

	fmt.Printf("\n%d check(s) failed\n", failures)
	if failures > 0 {
		os.Exit(1)
	}
}
