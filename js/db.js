// Data access layer: maps between Supabase's snake_case rows and the
// camelCase shape app.js's in-memory `state` uses, and exposes one
// function per read/write the app needs.
import { supabase } from "./supabase-client.js";

function mapMetricFromDb(row) {
  return { id: row.id, name: row.name, unit: row.unit || "", target: Number(row.target) || 0, current: Number(row.current) || 0 };
}
function mapHabitFromDb(row) {
  return { id: row.id, name: row.name, cadence: row.cadence, log: row.log || {}, best: row.best || 0 };
}
function mapMilestoneFromDb(row) {
  return { id: row.id, name: row.name, done: !!row.done };
}
function mapContactFromDb(row) {
  return { id: row.id, name: row.name, category: row.category, notes: row.notes || "", reachedOutAt: row.reached_out_at, meetingAt: row.meeting_at, createdAt: row.created_at };
}
function mapGoalFromDb(row) {
  return {
    id: row.id,
    emoji: row.emoji,
    name: row.name,
    targetDate: row.target_date || "",
    why: row.why || "",
    identity: row.identity || "",
    createdAt: row.created_at,
    metrics: (row.metrics || []).map(mapMetricFromDb),
    habits: (row.habits || []).map(mapHabitFromDb),
    milestones: (row.milestones || []).map(mapMilestoneFromDb),
    contacts: (row.contacts || []).map(mapContactFromDb),
  };
}

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

export async function fetchGoals() {
  var res = await supabase
    .from("goals")
    .select("*, metrics(*), habits(*), milestones(*), contacts(*)")
    .order("created_at", { ascending: true });
  return check(res).map(mapGoalFromDb);
}

export async function insertGoal(userId, goal) {
  check(await supabase.from("goals").insert({
    id: goal.id, user_id: userId, emoji: goal.emoji, name: goal.name,
    target_date: goal.targetDate || null, why: goal.why, identity: goal.identity,
  }));
}
export async function updateGoal(id, patch) {
  var row = {};
  if ("emoji" in patch) row.emoji = patch.emoji;
  if ("name" in patch) row.name = patch.name;
  if ("targetDate" in patch) row.target_date = patch.targetDate || null;
  if ("why" in patch) row.why = patch.why;
  if ("identity" in patch) row.identity = patch.identity;
  check(await supabase.from("goals").update(row).eq("id", id));
}
export async function deleteGoal(id) {
  check(await supabase.from("goals").delete().eq("id", id));
}

export async function insertMetric(userId, goalId, metric) {
  check(await supabase.from("metrics").insert({
    id: metric.id, goal_id: goalId, user_id: userId, name: metric.name, unit: metric.unit, target: metric.target, current: metric.current,
  }));
}
export async function updateMetric(id, patch) {
  var row = {};
  if ("current" in patch) row.current = patch.current;
  if ("name" in patch) row.name = patch.name;
  if ("unit" in patch) row.unit = patch.unit;
  if ("target" in patch) row.target = patch.target;
  check(await supabase.from("metrics").update(row).eq("id", id));
}
export async function deleteMetric(id) {
  check(await supabase.from("metrics").delete().eq("id", id));
}

export async function insertHabit(userId, goalId, habit) {
  check(await supabase.from("habits").insert({
    id: habit.id, goal_id: goalId, user_id: userId, name: habit.name, cadence: habit.cadence, log: habit.log || {}, best: habit.best || 0,
  }));
}
export async function updateHabit(id, patch) {
  var row = {};
  if ("log" in patch) row.log = patch.log;
  if ("best" in patch) row.best = patch.best;
  if ("name" in patch) row.name = patch.name;
  if ("cadence" in patch) row.cadence = patch.cadence;
  check(await supabase.from("habits").update(row).eq("id", id));
}
export async function deleteHabit(id) {
  check(await supabase.from("habits").delete().eq("id", id));
}

export async function insertMilestone(userId, goalId, ms) {
  check(await supabase.from("milestones").insert({
    id: ms.id, goal_id: goalId, user_id: userId, name: ms.name, done: !!ms.done,
  }));
}
export async function updateMilestone(id, patch) {
  var row = {};
  if ("done" in patch) row.done = patch.done;
  if ("name" in patch) row.name = patch.name;
  check(await supabase.from("milestones").update(row).eq("id", id));
}
export async function deleteMilestone(id) {
  check(await supabase.from("milestones").delete().eq("id", id));
}

export async function insertContact(userId, goalId, c) {
  check(await supabase.from("contacts").insert({
    id: c.id, goal_id: goalId, user_id: userId, name: c.name, category: c.category, notes: c.notes || "", reached_out_at: c.reachedOutAt || null, meeting_at: c.meetingAt || null,
  }));
}
export async function updateContact(id, patch) {
  var row = {};
  if ("category" in patch) row.category = patch.category;
  if ("notes" in patch) row.notes = patch.notes;
  if ("reachedOutAt" in patch) row.reached_out_at = patch.reachedOutAt || null;
  if ("meetingAt" in patch) row.meeting_at = patch.meetingAt || null;
  check(await supabase.from("contacts").update(row).eq("id", id));
}
export async function deleteContact(id) {
  check(await supabase.from("contacts").delete().eq("id", id));
}
