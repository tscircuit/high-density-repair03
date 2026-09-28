import Std

/-!
List-level equivalence of root-filtered via collection and same-root site lookup.
No geometry is recomputed or approximated by this model: payload, overlap, and
site predicates are arbitrary and shared by both executions.
-/
namespace RootFilteredViaCollection

variable {Root Payload : Type} [DecidableEq Root]

structure Via (Root Payload : Type) where
  root : Root
  routeIndex : Nat
  payload : Payload

def allVias (indices : List Nat) (scan : Nat → List (Via Root Payload)) :=
  indices.flatMap scan

def rootVias (indices : List Nat) (scan : Nat → List (Via Root Payload))
    (rootAt : Nat → Root) (root : Root) :=
  indices.flatMap (fun i => if rootAt i = root then scan i else [])

/-- Every emitted record retains the source route's original index and root. -/
def ScanLabels (scan : Nat → List (Via Root Payload)) (rootAt : Nat → Root) : Prop :=
  ∀ i v, v ∈ scan i → v.routeIndex = i ∧ v.root = rootAt i

 theorem filter_scan (scan : Nat → List (Via Root Payload))
    (rootAt : Nat → Root) (labels : ScanLabels scan rootAt) (i : Nat) (root : Root) :
    (scan i).filter (fun v => decide (v.root = root)) =
      (if rootAt i = root then scan i else []) := by
  split
  next h =>
    apply List.filter_eq_self.mpr
    intro v hv
    simp [(labels i v hv).2, h]
  next h =>
    apply List.filter_eq_nil_iff.mpr
    intro v hv
    simp [(labels i v hv).2, h]

/-- Ordered records, original indices, and opaque payloads are all preserved. -/
theorem collection_equivalence (indices : List Nat)
    (scan : Nat → List (Via Root Payload)) (rootAt : Nat → Root)
    (labels : ScanLabels scan rootAt) (root : Root) :
    rootVias indices scan rootAt root =
      (allVias indices scan).filter (fun v => decide (v.root = root)) := by
  unfold rootVias allVias
  rw [List.filter_flatMap]
  congr 1
  funext i
  exact (filter_scan scan rootAt labels i root).symm

/-- Removing records that cannot match does not change the first match. -/
theorem find_filter_eq {α : Type} (xs : List α) (keep predicate : α → Bool)
    (implication : ∀ v ∈ xs, predicate v = true → keep v = true) :
    (xs.filter keep).find? predicate = xs.find? predicate := by
  induction xs with
  | nil => simp
  | cons x xs ih =>
    have tail : ∀ v ∈ xs, predicate v = true → keep v = true := by
      intro v hv
      exact implication v (by simp [hv])
    by_cases hk : keep x = true
    · simp [hk, List.find?_cons, ih tail]
    · have hm : predicate x = false := by
        cases h : predicate x with
        | false => rfl
        | true => exact False.elim (hk (implication x (by simp) h))
      simp [hk, hm, ih tail]

/-- Filtering out other roots leaves an already same-root site filter unchanged. -/
theorem site_filter_eq (xs : List (Via Root Payload)) (root : Root)
    (site : Via Root Payload → Bool) :
    ((xs.filter (fun v => decide (v.root = root))).filter
      (fun v => decide (v.root = root) && site v)) =
    xs.filter (fun v => decide (v.root = root) && site v) := by
  rw [List.filter_filter]
  congr 1
  funext v
  cases decide (v.root = root) <;> simp

def findSite (xs : List (Via Root Payload)) (targetIndex : Nat)
    (overlap : Via Root Payload → Bool)
    (sameSite : Via Root Payload → Via Root Payload → Bool) : List (Via Root Payload) :=
  match xs.find? (fun v => decide (v.routeIndex = targetIndex) && overlap v) with
  | none => []
  | some current => xs.filter (fun v => decide (v.root = current.root) && sameSite current v)

/-- Both the first overlapping record and the final ordered site list agree. -/
theorem same_root_site_equivalence (indices : List Nat)
    (scan : Nat → List (Via Root Payload)) (rootAt : Nat → Root)
    (labels : ScanLabels scan rootAt) (targetIndex : Nat)
    (overlap : Via Root Payload → Bool)
    (sameSite : Via Root Payload → Via Root Payload → Bool) :
    findSite (rootVias indices scan rootAt (rootAt targetIndex)) targetIndex overlap sameSite =
    findSite (allVias indices scan) targetIndex overlap sameSite := by
  let xs := allVias indices scan
  let keep := fun v : Via Root Payload => decide (v.root = rootAt targetIndex)
  let predicate := fun v : Via Root Payload => decide (v.routeIndex = targetIndex) && overlap v
  have matchRoot : ∀ v ∈ xs, predicate v = true → v.root = rootAt targetIndex := by
    intro v hv hm
    obtain ⟨i, _, hi⟩ := List.mem_flatMap.mp hv
    have hindex : v.routeIndex = targetIndex := by
      have parts : v.routeIndex = targetIndex ∧ overlap v = true := by simpa [predicate] using hm
      exact parts.1
    obtain ⟨hvi, hroot⟩ := labels i v hi
    simpa [← hvi, hindex] using hroot
  have hfind : (xs.filter keep).find? predicate = xs.find? predicate := by
    apply find_filter_eq
    intro v hv hm
    simp [keep, matchRoot v hv hm]
  rw [collection_equivalence indices scan rootAt labels]
  change findSite (xs.filter keep) targetIndex overlap sameSite = findSite xs targetIndex overlap sameSite
  unfold findSite
  change (match (xs.filter keep).find? predicate with
    | none => []
    | some current => (xs.filter keep).filter (fun v : Via Root Payload => decide (v.root = current.root) && sameSite current v)) = _
  rw [hfind]
  cases hresult : xs.find? predicate with
  | none => rfl
  | some current =>
    have hroot := matchRoot current (List.mem_of_find?_eq_some hresult) (List.find?_some hresult)
    simp only [hroot]
    exact site_filter_eq xs (rootAt targetIndex) (sameSite current)

/-- Logical cost of each original inner scan; excludes outer traversal overhead. -/
def fullScanCost (indices : List Nat) (cost : Nat → Nat) : Nat :=
  (indices.map cost).sum

def selectedScanCost (indices : List Nat) (rootAt : Nat → Root)
    (root : Root) (cost : Nat → Nat) : Nat :=
  (indices.map (fun i => if rootAt i = root then cost i else 0)).sum

def skippedScanCost (indices : List Nat) (rootAt : Nat → Root)
    (root : Root) (cost : Nat → Nat) : Nat :=
  (indices.map (fun i => if rootAt i = root then 0 else cost i)).sum

/-- The removed inner work is exactly the sum of the skipped route costs. -/
theorem scan_cost_decomposition (indices : List Nat) (rootAt : Nat → Root)
    (root : Root) (cost : Nat → Nat) :
    fullScanCost indices cost =
      selectedScanCost indices rootAt root cost + skippedScanCost indices rootAt root cost := by
  induction indices with
  | nil => simp [fullScanCost, selectedScanCost, skippedScanCost]
  | cons i indices ih =>
    by_cases h : rootAt i = root
    · simp [fullScanCost, selectedScanCost, skippedScanCost, h] at *
      omega
    · simp [fullScanCost, selectedScanCost, skippedScanCost, h] at *
      omega

/-- Root filtering cannot increase this nonnegative inner-scan work measure. -/
theorem selected_scan_cost_le (indices : List Nat) (rootAt : Nat → Root)
    (root : Root) (cost : Nat → Nat) :
    selectedScanCost indices rootAt root cost ≤ fullScanCost indices cost := by
  rw [scan_cost_decomposition indices rootAt root cost]
  omega

/-- A positive skipped cost gives a strict decrease in this work measure. -/
theorem selected_scan_cost_lt (indices : List Nat) (rootAt : Nat → Root)
    (root : Root) (cost : Nat → Nat)
    (positive : 0 < skippedScanCost indices rootAt root cost) :
    selectedScanCost indices rootAt root cost < fullScanCost indices cost := by
  rw [scan_cost_decomposition indices rootAt root cost]
  omega

#print axioms scan_cost_decomposition
#print axioms selected_scan_cost_le
#print axioms selected_scan_cost_lt
#print axioms collection_equivalence
#print axioms same_root_site_equivalence
end RootFilteredViaCollection
