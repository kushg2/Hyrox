import React, { useState, useEffect, useMemo, useCallback } from "react";
import { load as loadState, save as saveState, pull, getSyncId, setSyncId, syncEnabled } from "./storage";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/* ============================================================
   SPLIT SHEET — HYROX Doubles, Dallas, 22 Nov 2026
   13-week build. Training + fuel + metrics.
   ============================================================ */

const RACE = new Date(2026, 10, 22);      // Sun 22 Nov 2026
const W1_START = new Date(2026, 7, 24);   // Mon 24 Aug 2026
const TOTAL_WEEKS = 13;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------------- date helpers ---------------- */
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

/* ---------------- pace maths ---------------- */
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const paceSet = (fiveKSec) => {
  const p = fiveKSec / 5; // sec per km at 5k effort
  return {
    easy: p + 90, long: p + 72, race: p + 25, thr: p + 15,
    fivek: p, vo2: p - 12, rep: p - 26,
  };
};
const PACE_LABEL = {
  easy: "Easy", long: "Long", race: "Race", thr: "Threshold",
  fivek: "5K", vo2: "VO₂", rep: "Rep",
};

/* ---------------- weekly phase table ---------------- */
const WEEK_META = [
  { phase: "Base", focus: "Rebuild continuous running. Learn the eight stations." },
  { phase: "Base", focus: "Add volume, keep every easy run genuinely easy." },
  { phase: "Base", focus: "First real interval density. Legs start to hold form." },
  { phase: "Base", focus: "Longest run yet. Sled work goes to race weight." },
  { phase: "Build", focus: "Compromised running begins — run on tired legs." },
  { phase: "Build", focus: "Mini simulation. Find out what the transitions cost you." },
  { phase: "Build", focus: "Threshold volume. This is where the 5K time drops." },
  { phase: "Build", focus: "Half-race simulation at target effort." },
  { phase: "Specific", focus: "Race-pace kilometres, short rest, station fatigue." },
  { phase: "Specific", focus: "The 8×1K session. Hardest run day of the block." },
  { phase: "Specific", focus: "PEAK — full doubles simulation on Saturday." },
  { phase: "Taper", focus: "Volume down 35%. Intensity stays. Legs come back." },
  { phase: "Race", focus: "Sharpen, travel, race. Nothing new this week." },
];

/* ---------------- run sessions ---------------- */
const INTERVALS = [
  { t: "6 × 400 m", z: "vo2", rest: "90 s jog", note: "First quality session back. Stop if form breaks — quality over count." },
  { t: "5 × 600 m", z: "vo2", rest: "2 min jog", note: "Slightly longer reps. Same effort, don't chase splits." },
  { t: "8 × 400 m", z: "vo2", rest: "75 s jog", note: "Density up. Last two should be your fastest." },
  { t: "4 × 800 m", z: "fivek", rest: "2 min jog", note: "Control the first 200 m of each rep." },
  { t: "10 × 400 m", z: "vo2", rest: "60 s jog", note: "Short rest. This one is about repeatability." },
  { t: "4 × 1000 m", z: "thr", rest: "90 s jog", note: "Threshold, not racing. You should finish wanting one more." },
  { t: "5 × 800 m", z: "fivek", rest: "2 min jog", note: "Key aerobic power session of the Build block." },
  { t: "5 × 1000 m", z: "race", rest: "60 s + 10 burpee broad jumps", note: "Burpees between reps. Welcome to HYROX running." },
  { t: "12 × 400 m", z: "vo2", rest: "45 s jog", note: "High density. Hold the last four together." },
  { t: "8 × 1000 m", z: "race", rest: "60 s standing", note: "THE session. Eight kilometres at race pace with the rest you'll actually get. If you finish this, you finish the race." },
  { t: "6 × 1000 m", z: "race", rest: "45 s standing", note: "Slightly faster than race pace, shorter rest. Peak week." },
  { t: "4 × 1000 m", z: "race", rest: "60 s standing", note: "Taper version. Sharp, not draining." },
  { t: "3 × 800 m", z: "race", rest: "90 s jog", note: "Race-week sharpener. Finish feeling springy." },
];

const EASY = [
  { t: "3 km easy", note: "Run 4 min / walk 1 min if needed. No shame in it." },
  { t: "3.5 km easy", note: "Nose-breathing pace. Conversational the whole way." },
  { t: "4 km easy + 4 × 20 s strides", note: "Strides are relaxed and fast, not sprints." },
  { t: "4 km easy", note: "Recovery between two hard days. Keep it slow." },
  { t: "5 km easy + 4 strides", note: "First 5K of the block done easy, not tested." },
  { t: "5 km easy", note: "Legs will be sore from Monday. That's fine." },
  { t: "5 km easy + 6 strides", note: "Add drills: A-skips, high knees, butt kicks." },
  { t: "6 km easy", note: "Longest midweek run. Steady and boring." },
  { t: "5 km easy", note: "Deliberately short — Saturday is the big one." },
  { t: "6 km easy + 4 strides", note: "Flush out Tuesday's 8×1K." },
  { t: "5 km easy", note: "Peak week. Protect Saturday's simulation." },
  { t: "4 km easy + 4 strides", note: "Taper. You should feel undertrained. Good." },
  { t: "3 km easy + 4 strides + station touch", note: "Add 10 wall balls, 40 m sled push light, 20 m lunge. Wake the pattern up, don't train it." },
];

const LONG = [
  { t: "4 km continuous", note: "No walking if you can help it. Slow is the answer." },
  { t: "5 km continuous", note: "Same pace as last week, one kilometre further." },
  { t: "6 km easy", note: "Fuel with a banana beforehand." },
  { t: "7 km easy", note: "Longest run so far. Last kilometre slightly quicker." },
  { t: "MINI SIM — 4 × (1 km + 1 station)", sim: true, note: "Ski 1000 m → Sled push 50 m → Burpee broad jump 80 m → Row 1000 m. Run each kilometre at race pace. Time everything." },
  { t: "8 km easy", note: "Pure aerobic. Nothing clever." },
  { t: "9 km, last 2 km at race pace", note: "Practise finishing strong on tired legs." },
  { t: "HALF SIM — 4 × 1 km + 4 stations", sim: true, note: "Farmers 200 m → Sandbag lunge 100 m → Wall balls 100 → Row 1000 m. Race effort. Log every split." },
  { t: "10 km, last 3 km at race pace", note: "Biggest aerobic day. Eat properly after." },
  { t: "10 km steady", note: "Recovery-flavoured long run after Tuesday's 8×1K." },
  { t: "FULL DOUBLES SIM — 8 × 1 km + all 8 stations", sim: true, note: "Full race, doubles splits with your partner. Treat it like Dallas: same kit, same fuelling, same shoes. This is your dress rehearsal." },
  { t: "8 km with 4 km at race pace", note: "Taper long run. Ends comfortably." },
  { t: "15 min shakeout + 3 strides", note: "Day before the race. Jog, three strides, five burpee broad jumps, done. Legs up after." },
];

const CIRCUIT = [
  { t: "3 rounds — 400 m run + 250 m ski + 20 wall balls", note: "Introduction to compromised running. Rest 2 min between rounds." },
  { t: "3 rounds — 600 m run + 250 m row + 10 m burpee broad jumps", note: "Learn the burpee broad jump rhythm: chest down, feet in, jump long." },
  { t: "4 rounds — 600 m run + 250 m ski + 25 wall balls", note: "Wall ball: 6 kg to 10 ft. Breathe at the top, not the bottom." },
  { t: "4 rounds — 800 m run + 250 m row + 20 m sandbag lunge", note: "30 kg sandbag. Knee kisses the floor every rep or it doesn't count." },
  { t: "4 rounds — 1 km run + 50 m sled push + 20 wall balls", note: "Sled at race weight (152 kg total, men's doubles). Low hips, short steps." },
  { t: "5 rounds — 1 km run + 250 m ski/row alternating + 50 m farmers", note: "2 × 24 kg farmers. Practise the turnaround without setting down." },
  { t: "4 rounds — 1 km run + 50 m sled push + 50 m sled pull + 25 wall balls", note: "Sled pull 103 kg. Sit back, use your legs, hand-over-hand." },
  { t: "5 rounds — 1 km run + rotating station", note: "Rotate: ski, sled push, burpee BJ, row, farmers. Race effort on the runs." },
  { t: "4 rounds — 1 km at race pace + 50 m sled push + 50 m sled pull", note: "Sleds back-to-back, exactly as they come in the race." },
  { t: "6 rounds — 1 km + rotating station, doubles split", note: "Do this with your partner if you can. Practise the handover — it's free time." },
  { t: "3 rounds — 800 m + 20 wall balls", note: "Deliberately light. Saturday's full simulation is the session that matters." },
  { t: "4 rounds — 1 km at race pace + 25 wall balls or 40 m lunge", note: "Taper circuit. Crisp movements, stop while it still feels good." },
  { t: "Rest — travel to Dallas", rest: true, note: "Pack: shoes, grip socks, belt, gloves, tape, chalk, electrolytes, two shakes. Walk-through if the venue allows it." },
];

/* ---------------- strength templates ---------------- */
const STRENGTH_A = [
  { // Base W1–4
    tag: "Legs & push",
    blocks: [
      { h: "Warm-up", items: ["5 min bike or row", "Leg swings, ankle rocks, hip openers", "2 × 10 air squats"] },
      { h: "Main", items: ["Back squat — 4 × 8 @ RPE 7", "Sled push — 4 × 20 m heavy (or leg press 4 × 10 + 40 m walking lunge)", "Bulgarian split squat — 3 × 10 each leg"] },
      { h: "HYROX", items: ["Wall balls — 4 × 15 (6 kg, 10 ft), 60 s rest"] },
      { h: "Core", items: ["Hanging knee raise — 3 × 12", "Side plank — 3 × 30 s each side"] },
    ],
  },
  { // Build W5–8
    tag: "Legs & push",
    blocks: [
      { h: "Warm-up", items: ["5 min row", "Hip and ankle mobility", "2 × 8 goblet squats"] },
      { h: "Main", items: ["Back squat — 5 × 5 @ RPE 8", "Sled push — 6 × 20 m at race weight, 60 s rest", "Sandbag walking lunge — 4 × 20 m (30 kg)"] },
      { h: "HYROX", items: ["Wall balls — 5 × 20 unbroken, 75 s rest"] },
      { h: "Core", items: ["Hollow hold — 3 × 40 s", "Pallof press — 3 × 12 each side"] },
    ],
  },
  { // Specific W9–12
    tag: "Legs & push",
    blocks: [
      { h: "Warm-up", items: ["5 min ski erg", "Dynamic mobility", "Empty bar front squats × 10"] },
      { h: "Main", items: ["Front squat — 4 × 5 @ RPE 8", "Sled push — 8 × 15 m at race weight, 30 s rest", "Sandbag lunge — 4 × 25 m unbroken"] },
      { h: "HYROX", items: ["Wall balls — 4 × 25, 90 s rest (target 25 unbroken by week 11)"] },
      { h: "Core", items: ["Weighted plank — 3 × 45 s", "V-ups — 3 × 15"] },
    ],
  },
  { // Race week W13
    tag: "Mobility",
    blocks: [
      { h: "Session", items: ["20 min easy bike or walk", "Full-body mobility flow — 15 min", "10 air squats, 10 wall balls, 20 m lunge — pattern only"] },
      { h: "Note", items: ["Nothing heavy. Nothing new. Legs up in the evening."] },
    ],
  },
];

const STRENGTH_B = [
  {
    tag: "Hinge & pull",
    blocks: [
      { h: "Warm-up", items: ["5 min ski erg easy", "Band pull-aparts 2 × 15", "Cat-cow, thoracic rotations"] },
      { h: "Main", items: ["Romanian deadlift — 4 × 8 @ RPE 7", "Seated cable row — 4 × 10 heavy", "Lat pulldown — 3 × 12"] },
      { h: "HYROX", items: ["Farmers carry — 4 × 40 m (2 × 24 kg)", "SkiErg — 6 × 250 m, 60 s rest"] },
      { h: "Core", items: ["Dead bug — 3 × 10 each side"] },
    ],
  },
  {
    tag: "Hinge & pull",
    blocks: [
      { h: "Warm-up", items: ["5 min row", "Band pull-aparts, scap pull-ups"] },
      { h: "Main", items: ["Deadlift — 5 × 5 @ RPE 8", "Sled pull — 6 × 25 m at race weight (103 kg)", "Pull-ups — 4 × AMRAP (or assisted)"] },
      { h: "HYROX", items: ["Farmers carry — 4 × 50 m unbroken", "SkiErg — 5 × 500 m at race pace, 90 s rest"] },
      { h: "Core", items: ["Suitcase carry — 3 × 30 m each side"] },
    ],
  },
  {
    tag: "Hinge & pull",
    blocks: [
      { h: "Warm-up", items: ["5 min ski", "Hip hinge drill, banded rows"] },
      { h: "Main", items: ["Trap-bar deadlift — 4 × 5 @ RPE 8", "Sled pull — 8 × 25 m, 30 s rest", "Ring rows or pull-ups — 4 × 10"] },
      { h: "HYROX", items: ["Farmers carry — 3 × 100 m with one turnaround", "SkiErg — 3 × 750 m at race pace"] },
      { h: "Core", items: ["Ab wheel or plank walk-out — 3 × 10"] },
    ],
  },
  {
    tag: "Rest",
    blocks: [
      { h: "Session", items: ["Complete rest, or 20 min walk", "Foam roll quads, calves, lats", "Sleep 8+ hours"] },
      { h: "Note", items: ["Race week. Recovery is the training."] },
    ],
  },
];

const phaseIdx = (w) => (w <= 4 ? 0 : w <= 8 ? 1 : w <= 12 ? 2 : 3);

/* ---------------- plan builder ---------------- */
function buildWeek(w /* 1-indexed */) {
  const i = w - 1;
  const pi = phaseIdx(w);
  const days = [];

  // Mon — strength A
  days.push({
    slot: "strengthA", type: "Strength", title: STRENGTH_A[pi].tag,
    est: pi === 3 ? "35 min" : "60 min", blocks: STRENGTH_A[pi].blocks,
  });

  // Tue — intervals
  const iv = INTERVALS[i];
  days.push({
    slot: "intervals", type: "Track", title: iv.t, est: "55 min", zone: iv.z,
    blocks: [
      { h: "Warm-up", items: ["10 min easy jog", "Drills: A-skips, high knees, butt kicks", "3 × 20 s strides"] },
      { h: "Main set", items: [`${iv.t} at {${iv.z}} pace`, `Recovery: ${iv.rest}`] },
      { h: "Cool-down", items: ["8 min easy jog", "5 min stretching"] },
    ],
    note: iv.note,
  });

  // Wed — strength B
  days.push({
    slot: "strengthB", type: "Strength", title: STRENGTH_B[pi].tag,
    est: pi === 3 ? "30 min" : "60 min", blocks: STRENGTH_B[pi].blocks,
  });

  // Thu — easy run
  const ez = EASY[i];
  days.push({
    slot: "easy", type: "Run", title: ez.t, est: "40 min", zone: "easy",
    blocks: [
      { h: "Session", items: [`${ez.t} at {easy} pace`] },
      { h: "After", items: ["10 min mobility: hips, calves, T-spine"] },
    ],
    note: ez.note,
  });

  // Fri — circuit
  const ci = CIRCUIT[i];
  days.push({
    slot: "circuit", type: ci.rest ? "Rest" : "HYROX", title: ci.t,
    est: ci.rest ? "—" : "60–75 min", zone: "race",
    blocks: ci.rest
      ? [{ h: "Session", items: ["Rest and travel"] }]
      : [
          { h: "Warm-up", items: ["8 min easy jog", "10 air squats, 10 wall balls, 20 m lunge"] },
          { h: "Main", items: [ci.t, "Runs at {race} pace. Move continuously through transitions."] },
          { h: "Cool-down", items: ["5 min walk", "Stretch quads, hips, lats"] },
        ],
    note: ci.note,
  });

  // Sat — long / sim
  const lg = LONG[i];
  days.push({
    slot: "long", type: lg.sim ? "Simulation" : "Run", title: lg.t,
    est: lg.sim ? "90–120 min" : "50–75 min", zone: lg.sim ? "race" : "long",
    blocks: lg.sim
      ? [
          { h: "Warm-up", items: ["10 min easy jog", "Full station warm-up, light loads"] },
          { h: "Main", items: [lg.t, "Runs at {race} pace"] },
          { h: "After", items: ["Log every split in Metrics", "Shake within 30 min, full meal within 90"] },
        ]
      : [
          { h: "Session", items: [`${lg.t} — base pace {long}`] },
          { h: "After", items: ["Refuel properly. This is your biggest calorie day."] },
        ],
    note: lg.note,
  });

  // Sun — rest / race
  const isRaceDay = w === TOTAL_WEEKS;
  days.push({
    slot: "rest", type: isRaceDay ? "RACE" : "Rest",
    title: isRaceDay ? "HYROX Dallas — Men's Doubles" : "Rest & mobility",
    est: isRaceDay ? "~1:40" : "20 min",
    blocks: isRaceDay
      ? [
          { h: "Morning", items: ["Eat 3 h out: rice or oats + banana + half shake", "Sip electrolytes, stop 45 min before"] },
          { h: "Warm-up", items: ["12 min jog, 4 strides", "10 wall balls, 5 burpee broad jumps, 20 m lunge"] },
          { h: "Race", items: ["Runs at {race} pace. Never chase the first kilometre.", "Talk to your partner before every station, not during."] },
        ]
      : [
          { h: "Session", items: ["20 min walk or easy spin", "Foam roll: quads, calves, glutes, lats", "10 min stretching"] },
          { h: "Admin", items: ["Log weight and body fat", "Plan next week's cheat meals"] },
        ],
    note: isRaceDay ? "You have done every part of this in training. Execute, don't improvise." : "Sleep is the session. Aim for 8 hours.",
  });

  return {
    n: w, ...WEEK_META[i],
    start: addDays(W1_START, i * 7),
    days,
  };
}

const PLAN = Array.from({ length: TOTAL_WEEKS }, (_, i) => buildWeek(i + 1));

/* ---------------- swap alternatives ---------------- */
const ALTS = {
  intervals: [
    { title: "Treadmill version", type: "Run", est: "50 min", blocks: [{ h: "Session", items: ["Same rep structure at 1% incline", "Walk the recoveries at 5 km/h", "Cut one rep — treadmill reps are harder to bail on"] }], note: "Use when it's over 95 °F in Austin or the track is closed." },
    { title: "Hill repeats — 10 × 60 s uphill", type: "Run", est: "45 min", blocks: [{ h: "Session", items: ["10 × 60 s hard uphill, jog down recovery", "Find a 5–7% grade"] }], note: "Lower impact, builds the sled-push muscles. Good substitute if shins are sore." },
    { title: "Low-impact: 8 × 3 min bike or row hard", type: "Cross", est: "45 min", blocks: [{ h: "Session", items: ["8 × 3 min hard, 90 s easy", "Bike, row or ski erg"] }], note: "For niggles. Keeps the aerobic stimulus, spares the legs." },
    { title: "Fartlek — 30 min", type: "Run", est: "45 min", blocks: [{ h: "Session", items: ["30 min continuous: alternate 2 min hard / 2 min easy", "No watch checking"] }], note: "When you want quality without the mental load of a track session." },
  ],
  easy: [
    { title: "Recovery walk + mobility", type: "Recovery", est: "40 min", blocks: [{ h: "Session", items: ["30 min brisk walk", "15 min full-body mobility"] }], note: "Use when yesterday hurt more than it should have." },
    { title: "45 min easy bike", type: "Cross", est: "45 min", blocks: [{ h: "Session", items: ["45 min zone 2 bike", "Keep cadence above 85"] }], note: "Zero impact, same aerobic value." },
    { title: "Easy run + 8 strides", type: "Run", est: "40 min", blocks: [{ h: "Session", items: ["Same distance at {easy} pace", "8 × 20 s strides after"] }], note: "Adds a little leg speed without adding load." },
  ],
  long: [
    { title: "Run–walk long session", type: "Run", est: "70 min", blocks: [{ h: "Session", items: ["Same distance, 9 min run / 1 min walk", "Walk breaks are planned, not earned"] }], note: "Better than cutting the run short. Keeps time on feet." },
    { title: "Bike + run brick", type: "Cross", est: "75 min", blocks: [{ h: "Session", items: ["40 min easy bike", "Straight into 20 min easy run"] }], note: "Low impact, teaches you to run on pre-fatigued legs." },
    { title: "Treadmill long run", type: "Run", est: "60 min", blocks: [{ h: "Session", items: ["Same distance at 1% incline", "Change speed every 5 min by ±0.2 km/h to stay engaged"] }], note: "Texas summer insurance." },
  ],
  circuit: [
    { title: "Gym-limited circuit (no sled)", type: "HYROX", est: "60 min", blocks: [{ h: "Session", items: ["4 rounds: 1 km treadmill + 250 m row + 20 wall balls + 40 m dumbbell farmers", "Swap sled push for 20 heavy leg press or 40 m heavy walking lunge"] }], note: "Every commercial gym can run this." },
    { title: "Home / bodyweight version", type: "HYROX", est: "45 min", blocks: [{ h: "Session", items: ["5 rounds: 800 m run + 15 burpee broad jumps + 20 goblet squats + 40 m suitcase carry"] }], note: "No equipment beyond one dumbbell or kettlebell." },
    { title: "Erg-only session", type: "Cross", est: "50 min", blocks: [{ h: "Session", items: ["4 × (500 m ski + 500 m row + 20 wall balls)", "2 min rest between rounds"] }], note: "When you can't run — knee, shin, heat." },
  ],
  strengthA: [
    { title: "Dumbbell-only legs", type: "Strength", est: "45 min", blocks: [{ h: "Main", items: ["Goblet squat — 4 × 12", "DB walking lunge — 4 × 20 m", "DB step-ups — 3 × 10 each leg", "Wall balls or DB thrusters — 4 × 15"] }, { h: "Core", items: ["Plank 3 × 45 s"] }], note: "Home or hotel gym." },
    { title: "Deload legs", type: "Strength", est: "35 min", blocks: [{ h: "Main", items: ["Back squat — 3 × 5 @ RPE 5", "Sled push — 3 × 20 m moderate", "Wall balls — 3 × 12"] }], note: "Use when you're beaten up. Better than skipping entirely." },
    { title: "Machine circuit", type: "Strength", est: "45 min", blocks: [{ h: "Main", items: ["Leg press — 4 × 12", "Hack squat — 3 × 10", "Leg curl — 3 × 12", "Calf raise — 3 × 15", "Wall balls — 4 × 15"] }], note: "Joint-friendly, easy to load." },
  ],
  strengthB: [
    { title: "Dumbbell-only pull", type: "Strength", est: "45 min", blocks: [{ h: "Main", items: ["DB Romanian deadlift — 4 × 10", "Single-arm DB row — 4 × 10 each", "DB farmers carry — 4 × 40 m", "Band pull-aparts — 3 × 20"] }], note: "Home or hotel gym." },
    { title: "Deload pull", type: "Strength", est: "35 min", blocks: [{ h: "Main", items: ["RDL — 3 × 6 @ RPE 5", "Cable row — 3 × 10", "Farmers carry — 3 × 30 m", "Ski erg — 4 × 250 m easy"] }], note: "Keeps the pattern, drops the load." },
    { title: "Grip & carry focus", type: "Strength", est: "40 min", blocks: [{ h: "Main", items: ["Farmers carry — 6 × 60 m", "Dead hang — 4 × max", "Sled pull — 6 × 25 m", "Suitcase carry — 3 × 40 m each side"] }], note: "If farmers carry or sled pull is your limiter, run this instead." },
  ],
  rest: [
    { title: "Yoga / mobility flow", type: "Recovery", est: "40 min", blocks: [{ h: "Session", items: ["40 min hip and hamstring focused flow", "Finish with 5 min box breathing"] }], note: "" },
    { title: "Easy swim", type: "Recovery", est: "30 min", blocks: [{ h: "Session", items: ["30 min easy swim, any stroke", "No intervals"] }], note: "" },
    { title: "Complete rest", type: "Rest", est: "—", blocks: [{ h: "Session", items: ["Nothing. Sit down."] }], note: "" },
  ],
};

/* ---------------- grocery catalog ---------------- */
const AISLES = ["Produce", "Dairy & chilled", "Bakery", "Frozen", "Pantry"];
const ITEMS = {
  paneer:      { label: "Paneer (low-fat)", aisle: "Dairy & chilled", unit: "g", pack: 200 },
  tofu:        { label: "Extra-firm tofu", aisle: "Dairy & chilled", unit: "g", pack: 400 },
  halloumi:    { label: "Halloumi", aisle: "Dairy & chilled", unit: "g", pack: 225 },
  feta:        { label: "Feta", aisle: "Dairy & chilled", unit: "g", pack: 200 },
  cheddar:     { label: "Cheddar or Monterey Jack", aisle: "Dairy & chilled", unit: "g", pack: 225 },
  parmesan:    { label: "Parmesan", aisle: "Dairy & chilled", unit: "g", pack: 100 },
  cottage:     { label: "Low-fat cottage cheese", aisle: "Dairy & chilled", unit: "g", pack: 680 },
  gyogurt:     { label: "0% Greek yogurt", aisle: "Dairy & chilled", unit: "g", pack: 1000 },
  hummus:      { label: "Hummus", aisle: "Dairy & chilled", unit: "g", pack: 250 },
  milk:        { label: "Skim milk", aisle: "Dairy & chilled", unit: "ml", pack: 1900 },
  banana:      { label: "Bananas", aisle: "Produce", unit: "" },
  berries:     { label: "Berries (fresh or frozen)", aisle: "Produce", unit: "g" },
  avocado:     { label: "Avocados", aisle: "Produce", unit: "" },
  sweetpotato: { label: "Sweet potatoes", aisle: "Produce", unit: "" },
  spinach:     { label: "Spinach", aisle: "Produce", unit: "g" },
  broccoli:    { label: "Broccoli", aisle: "Produce", unit: "g" },
  capsicum:    { label: "Bell peppers", aisle: "Produce", unit: "" },
  onion:       { label: "Onions", aisle: "Produce", unit: "" },
  tomato:      { label: "Tomatoes", aisle: "Produce", unit: "" },
  cucumber:    { label: "Cucumbers", aisle: "Produce", unit: "" },
  lettuce:     { label: "Romaine or mixed greens", aisle: "Produce", unit: "bag" },
  lemon:       { label: "Lemons and limes", aisle: "Produce", unit: "" },
  aromatics:   { label: "Ginger and garlic", aisle: "Produce", unit: "pack" },
  coriander:   { label: "Coriander", aisle: "Produce", unit: "bunch" },
  roti:        { label: "Roti or chapati", aisle: "Bakery", unit: "" },
  tortilla:    { label: "Large whole-wheat tortillas", aisle: "Bakery", unit: "" },
  pita:        { label: "Pita", aisle: "Bakery", unit: "" },
  bread:       { label: "Seeded or sourdough bread", aisle: "Bakery", unit: "slices" },
  falafel:     { label: "Frozen falafel — check the label for nuts", aisle: "Frozen", unit: "" },
  peas:        { label: "Frozen peas", aisle: "Frozen", unit: "g" },
  chickpeas:   { label: "Chickpeas", aisle: "Pantry", unit: "cans" },
  blackbeans:  { label: "Black beans", aisle: "Pantry", unit: "cans" },
  rajma:       { label: "Kidney beans (rajma)", aisle: "Pantry", unit: "cans" },
  tomatocan:   { label: "Chopped tomatoes", aisle: "Pantry", unit: "cans" },
  rice:        { label: "Rice", aisle: "Pantry", unit: "g" },
  couscous:    { label: "Couscous or quinoa", aisle: "Pantry", unit: "g" },
  cpasta:      { label: "Chickpea pasta (Banza)", aisle: "Pantry", unit: "g", pack: 227 },
  marinara:    { label: "Marinara sauce", aisle: "Pantry", unit: "jars" },
  salsa:       { label: "Salsa", aisle: "Pantry", unit: "jars" },
  granola:     { label: "Nut-free granola", aisle: "Pantry", unit: "g", pack: 400 },
  honey:       { label: "Honey", aisle: "Pantry", unit: "jar" },
  olives:      { label: "Olives", aisle: "Pantry", unit: "g" },
  soysauce:    { label: "Soy or teriyaki sauce", aisle: "Pantry", unit: "bottle" },
  oil:         { label: "Olive oil", aisle: "Pantry", unit: "bottle" },
  whey:        { label: "Whey protein — check you have 14 scoops", aisle: "Pantry", unit: "tub" },
};

/* Bought every week regardless of what's on the menu */
const STAPLES = { banana: 7, milk: 2100, whey: 1, oil: 1, aromatics: 1 };

/* ---------------- meals ----------------
   Vegetarian, no eggs. No mushrooms, asparagus, nuts or nut butters.
   No soy protein or mock meat — tofu and paneer only.
   cat:  'indian' | 'quick' | 'out'
   prep: 0 no cooking · 1 light (one pan, few ingredients) · 2 needs a proper shop
   'out' items never auto-rotate; they're swap-ins for days you're not cooking. */
const MEALS = [
  /* ---------- INDIAN (3) ---------- */
  { id: "i1", cat: "indian", prep: 2, slots: ["lunch", "dinner"], name: "Paneer Bhurji + 3 Roti + Curd",
    cal: 840, p: 63, c: 88, f: 22, time: "20 min",
    shop: { paneer: 150, roti: 4, gyogurt: 150, onion: 1, tomato: 2 },
    ing: "150 g low-fat paneer · 4 whole-wheat roti · onion, tomato, ginger · 150 g Greek yogurt · 1 tsp oil",
    how: "Crumble paneer. Fry onion, tomato, ginger, turmeric and garam masala in 1 tsp oil. Add paneer, 3 min. Serve with roti and yogurt." },
  { id: "i2", cat: "indian", prep: 2, slots: ["lunch", "dinner"], name: "Rajma Chawal + Paneer + Yogurt",
    cal: 890, p: 64, c: 114, f: 18, time: "25 min",
    shop: { rajma: 1, rice: 80, paneer: 100, gyogurt: 200, onion: 1, tomato: 2 },
    ing: "1 can kidney beans · 1 cup rice · 100 g paneer · 200 g Greek yogurt · onion, tomato, 1 tsp ghee",
    how: "Simmer the beans in onion-tomato masala 15 min until the gravy thickens. Dry-sear paneer cubes. Over rice, yogurt alongside. Doubles easily — cook once, eat twice." },
  { id: "i3", cat: "indian", prep: 2, slots: ["lunch", "dinner"], name: "Paneer Tikka + 3 Roti + Kachumber",
    cal: 830, p: 73, c: 75, f: 25, time: "25 min",
    shop: { paneer: 200, roti: 3, gyogurt: 150, capsicum: 1, onion: 1, cucumber: 1, tomato: 1 },
    ing: "200 g low-fat paneer · 3 roti · 150 g Greek yogurt · capsicum, onion · tandoori masala",
    how: "Marinate paneer in yogurt and tandoori masala 15 min. Air-fryer or dry pan with peppers until charred. Kachumber salad alongside." },

  /* ---------- QUICK & EASY (13) ---------- */
  { id: "q1", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Avocado Toast, Cottage Cheese & Chickpeas",
    cal: 845, p: 62, c: 104, f: 22, time: "10 min",
    shop: { bread: 3, avocado: 1, cottage: 250, chickpeas: 1, lemon: 1 },
    ing: "3 slices seeded or sourdough bread · ½ avocado · 250 g low-fat cottage cheese · 1 can chickpeas · lemon, chilli flakes, smoked paprika",
    how: "Pan-fry drained chickpeas in a dry pan with paprika and salt, 5 min, until they blister. Mash avocado onto toast with lemon. Cottage cheese spooned over, chickpeas on top, chilli flakes." },
  { id: "q2", cat: "quick", prep: 0, slots: ["lunch"], name: "Greek Yogurt & Cottage Cheese Bowl",
    cal: 730, p: 55, c: 108, f: 8, time: "5 min",
    shop: { gyogurt: 300, cottage: 150, banana: 1, berries: 100, granola: 50, honey: 1 },
    ing: "300 g 0% Greek yogurt · 150 g cottage cheese · 1 banana · 100 g berries · 50 g nut-free granola · 1 tbsp honey",
    how: "Stir the cottage cheese through the yogurt so it isn't grainy. Fruit, granola, honey. Zero cooking, 55 g of protein, five minutes." },
  { id: "q3", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Chickpea & Feta Mediterranean Bowl",
    cal: 850, p: 50, c: 95, f: 24, time: "15 min",
    shop: { chickpeas: 1, feta: 60, couscous: 60, cucumber: 1, tomato: 2, onion: 1, olives: 30, gyogurt: 150 },
    ing: "1 can chickpeas · 60 g feta · 1 cup cooked couscous or quinoa · cucumber, tomato, red onion, olives · 150 g Greek yogurt · lemon, olive oil, oregano",
    how: "Couscous is five minutes in boiling water off the heat. Everything else is assembly. Dress with lemon, 1 tsp olive oil and oregano." },
  { id: "q4", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Chickpea Pasta, Cottage Cheese Sauce",
    cal: 820, p: 55, c: 88, f: 29, time: "20 min",
    shop: { cpasta: 100, cottage: 150, marinara: 1, spinach: 100, parmesan: 20 },
    ing: "100 g dry chickpea or lentil pasta (Banza) · 150 g cottage cheese · 1 cup marinara · spinach · 20 g parmesan · 1 tbsp olive oil",
    how: "Blend cottage cheese smooth, stir into warm marinara off the heat so it doesn't split. Wilt spinach in. Toss with pasta, parmesan over." },
  { id: "q5", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Home Burrito Bowl with Paneer",
    cal: 850, p: 70, c: 90, f: 24, time: "20 min",
    shop: { rice: 80, blackbeans: 1, paneer: 120, cheddar: 30, gyogurt: 150, salsa: 1, lettuce: 1, lime: 0 },
    ing: "1 cup rice · 1 can black beans · 120 g paneer · 30 g cheddar · 150 g Greek yogurt · salsa, romaine, lime",
    how: "Sear paneer cubes hard in a dry pan with chilli powder and cumin until they blister. Beans warmed with lime. Build the bowl, yogurt instead of sour cream." },
  { id: "q6", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Loaded Sweet Potato, Beans & Cottage Cheese",
    cal: 810, p: 61, c: 110, f: 10, time: "10 min",
    shop: { sweetpotato: 2, blackbeans: 1, cottage: 200, gyogurt: 100, cheddar: 20, salsa: 1 },
    ing: "1.5 medium sweet potatoes · 1 can black beans · 200 g cottage cheese · 100 g Greek yogurt · 20 g cheese · salsa, coriander",
    how: "Microwave the potatoes 8 minutes. Split, load with beans warmed in cumin, cottage cheese, yogurt, salsa. Highest protein for the least effort in the whole rotation." },
  { id: "q7", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Crispy Tofu Rice Bowl",
    cal: 850, p: 49, c: 78, f: 30, time: "20 min",
    shop: { tofu: 250, rice: 80, broccoli: 200, capsicum: 1, soysauce: 1 },
    ing: "250 g extra-firm tofu · 1 cup rice · broccoli, capsicum, spring onion · soy or teriyaki sauce, garlic · 1 tbsp oil",
    how: "Press tofu 10 min, cube, toss in cornflour, sear hard until golden on every side. Remove, stir-fry veg fast, return tofu with the sauce at the very end so it stays crisp." },
  { id: "q8", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Falafel & Hummus Plate",
    cal: 880, p: 50, c: 80, f: 33, time: "10 min",
    shop: { falafel: 6, pita: 1, hummus: 50, feta: 50, gyogurt: 200, tomato: 1, cucumber: 1, onion: 1 },
    ing: "6 baked falafel · 1 pita · 50 g hummus · 50 g feta · 200 g Greek yogurt · tomato, cucumber, red onion",
    how: "Air-fry frozen falafel 8 minutes. Warm the pita. Plate with hummus, feta, chopped salad and yogurt stirred with lemon and garlic." },
  { id: "q9", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Bean & Cheese Quesadilla + Greek Yogurt",
    cal: 880, p: 57, c: 90, f: 27, time: "12 min",
    shop: { tortilla: 2, blackbeans: 1, cheddar: 60, gyogurt: 200, salsa: 1 },
    ing: "2 whole-wheat tortillas · 1 can black beans · 60 g cheddar or Monterey Jack · 200 g Greek yogurt · salsa, pickled jalapeño",
    how: "Mash the beans slightly so they hold. Beans and cheese between tortillas, dry pan, medium heat, four minutes a side under a plate to press." },
  { id: "q10", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Chickpea & Tomato Stew, Feta, Sourdough",
    cal: 880, p: 54, c: 100, f: 24, time: "20 min",
    shop: { chickpeas: 1, tomatocan: 1, capsicum: 1, onion: 1, feta: 60, bread: 2, gyogurt: 200 },
    ing: "1 can chickpeas · 1 can chopped tomatoes · onion, red pepper, garlic · 60 g feta · 2 slices sourdough · 200 g Greek yogurt · paprika, cumin",
    how: "Soften onion and pepper, add tomatoes, chickpeas, paprika and cumin, simmer 12 min until thick. Crumble feta over, yogurt on the side, bread to mop." },
  { id: "q11", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Halloumi, Chickpea & Pita Salad",
    cal: 900, p: 59, c: 82, f: 30, time: "10 min",
    shop: { halloumi: 80, chickpeas: 1, gyogurt: 200, pita: 1, cucumber: 1, tomato: 2, lettuce: 1 },
    ing: "80 g halloumi · 1 can chickpeas · 200 g Greek yogurt · 1 pita · greens, cucumber, tomato · lemon, olive oil",
    how: "Slice halloumi thick, dry pan two minutes a side until it squeaks and browns. Whisk yogurt with lemon and garlic as the dressing rather than oil alone — cuts the fat, adds 20 g protein." },
  { id: "q12", cat: "quick", prep: 1, slots: ["lunch", "dinner"], name: "Protein Mac & Cheese with Peas",
    cal: 800, p: 66, c: 90, f: 20, time: "20 min",
    shop: { cpasta: 100, cottage: 150, cheddar: 40, peas: 150, milk: 60 },
    ing: "100 g chickpea pasta · 150 g cottage cheese · 40 g cheddar · 150 g frozen peas · splash of milk · mustard, pepper",
    how: "Blend cottage cheese with milk and a teaspoon of mustard until smooth. Warm gently, melt cheddar in, fold through pasta and peas. Never boil the sauce." },
  { id: "q13", cat: "quick", prep: 2, slots: ["lunch", "dinner"], name: "Halloumi, Rice & Black Bean Bowl",
    cal: 845, p: 56, c: 90, f: 30, time: "15 min",
    shop: { halloumi: 100, rice: 80, blackbeans: 1, gyogurt: 150, salsa: 1, lemon: 1, coriander: 1 },
    ing: "100 g halloumi · 1 cup rice · 1 can black beans · 150 g Greek yogurt · salsa, lime, coriander",
    how: "Halloumi in a dry pan until browned. Beans warmed with cumin and lime. Build the bowl, yogurt on top." },

  /* ---------- EATING OUT (4) ---------- */
  { id: "o1", cat: "out", prep: 0, slots: ["lunch", "dinner"], name: "Chipotle — Veggie Burrito Bowl",
    cal: 780, p: 34, c: 80, f: 25, time: "order", shop: {},
    out: "Vegetarian protein tops out near 35 g here. Take a third scoop today.",
    ing: "White rice · double black beans · sofritas (braised tofu) · fajita veggies · fresh tomato salsa · cheese · romaine",
    how: "Ask for double beans — cheapest protein on the line. Skip guacamole and sour cream: 280 kcal, almost no protein. Sofritas is braised tofu, not mock meat; skip it for triple beans if you'd rather." },
  { id: "o2", cat: "out", prep: 0, slots: ["lunch", "dinner"], name: "CAVA — Greens & Grains Bowl",
    cal: 720, p: 34, c: 68, f: 28, time: "order", shop: {},
    out: "Around 35 g protein. Take a third scoop today.",
    ing: "SuperGreens + RightRice base · black lentils · falafel · feta · tzatziki · pickled onion, tomato, cucumber · harissa",
    how: "RightRice is the highest-protein base they have — take it over brown rice. Lentils plus falafel plus feta is the best stack available. Tzatziki over the crazy feta dressing." },
  { id: "o3", cat: "out", prep: 0, slots: ["lunch", "dinner"], name: "Chi'Lantro — Tofu Rice Bowl",
    cal: 700, p: 32, c: 78, f: 24, time: "order", shop: {},
    out: "Around 32 g protein. Take a third scoop today. Kimchi fries are a cheat meal, not this.",
    ing: "Tofu · brown or white rice · kimchi · lettuce, carrot, onion · magic sauce on the side",
    how: "Ask for double tofu if they'll do it. Sauce on the side, use half — that's where the calories hide." },
  { id: "o4", cat: "out", prep: 0, slots: ["lunch", "dinner"], name: "Sweetgreen — Custom Protein Bowl",
    cal: 690, p: 33, c: 62, f: 26, time: "order", shop: {},
    out: "Around 33 g protein. Take a third scoop today.",
    ing: "Warm wild rice base · double chickpeas · tofu · feta · roasted sweet potato · cucumber, tomato · lemon vinaigrette",
    how: "Build your own rather than taking a signature bowl — the preset vegetarian ones sit near 20 g protein. Double chickpeas plus tofu plus feta is the fix." },
];

const MEAL_BY_ID = Object.fromEntries(MEALS.map((m) => [m.id, m]));
const CATS = [["all", "All"], ["quick", "Quick"], ["indian", "Indian"], ["out", "Eating out"]];

/* Week 1 is shopping week. Mon–Tue need nothing, Wed is a light corner-shop day,
   and everything that needs real cooking sits Thursday onward. */
const WEEK1_FIXED = {
  "0lunch": "o1",  "0dinner": "o2",   // Mon — eating out, shop nothing
  "1lunch": "q2",  "1dinner": "q9",   // Tue — no-cook + one pan, corner-shop run
  "2lunch": "q1",  "2dinner": "q6",   // Wed — light; main shop tonight
  "3lunch": "q5",  "3dinner": "q7",   // Thu — cooking starts
  "4lunch": "q3",  "4dinner": "i1",
  "5lunch": "q11", "5dinner": "q10",
  "6lunch": "q12", "6dinner": "i2",
};

const LUNCH_POOL = MEALS.filter((m) => m.cat !== "out" && m.slots.includes("lunch"));
const DINNER_POOL = MEALS.filter((m) => m.cat !== "out" && m.slots.includes("dinner"));

const SHAKES = [
  { id: "s1", name: "Scoop 1 — post-training, in 300 ml skim milk", cal: 230, p: 34, c: 17, f: 2 },
  { id: "s2", name: "Scoop 2 — with water, mid-afternoon", cal: 125, p: 25, c: 3, f: 1.5 },
];
const EXTRAS = { name: "Banana pre-training", cal: 105, p: 1, c: 27, f: 0 };

const TARGETS = { cal: 2150, p: 170, c: 215, f: 55 };

/* ---------------- storage ---------------- */
const DEFAULT_STATE = {
  settings: { fiveK: 2040, weight: 173, bf: 26, eggs: true },
  swaps: {},        // dayKey -> {kind:'alt', idx} | {kind:'custom', title, text}
  done: {},         // dayKey -> true
  mealSwaps: {},    // mealKey -> mealId | {custom:true,name,cal,p,c,f} | {cheat:true,name}
  mealDone: {},     // mealKey -> true
  shop: {},         // "w0main:paneer" -> true
  logs: [],         // {date, weight, bf, rhr, fiveK, note}
  prs: {},          // benchmark id -> value
};

const SYNC_ID = getSyncId();

function useStore() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");

  const flash = useCallback((msg, ms = 1600) => {
    setStatus(msg);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setStatus(""), ms);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { state: found, source, offline } = await loadState(SYNC_ID);
      if (!live) return;
      if (found) setState({ ...DEFAULT_STATE, ...found });
      setReady(true);
      if (offline) flash("Offline — using this device's copy", 3000);
      else if (source === "cloud") flash("Loaded your latest", 2000);
    })();
    return () => { live = false; };
  }, [flash]);

  // Pull fresh data when the app comes back to the foreground.
  useEffect(() => {
    if (!syncEnabled) return;
    const onFocus = async () => {
      try {
        const fresher = await pull(SYNC_ID);
        if (fresher) { setState({ ...DEFAULT_STATE, ...fresher }); flash("Updated from your other device", 2500); }
      } catch { /* offline; nothing to do */ }
    };
    const onVis = () => document.visibilityState === "visible" && onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [flash]);

  const update = useCallback((fn) => setState((prev) => {
    const next = fn(prev);
    return saveState(SYNC_ID, next, flash);
  }), [flash]);

  const save = useCallback((next) => setState(saveState(SYNC_ID, next, flash)), [flash]);

  return { state, update, save, ready, status };
}

/* ---------------- small components ---------------- */
const Mark = ({ children }) => <span className="mark">{children}</span>;

function Bar({ value, max, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
      {label && <div className="bar-label">{label}</div>}
    </div>
  );
}

function Sheet({ open, title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function SplitSheet() {
  const { state, update, ready, status } = useStore();
  const today = startOfDay(new Date());

  const weekIdxToday = useMemo(() => {
    const d = daysBetween(W1_START, today);
    return Math.max(0, Math.min(TOTAL_WEEKS - 1, Math.floor(d / 7)));
  }, [today]);
  const dayIdxToday = useMemo(() => {
    const d = daysBetween(W1_START, today);
    return d < 0 ? 0 : Math.min(6, ((d % 7) + 7) % 7);
  }, [today]);

  const [tab, setTab] = useState("today");
  const [viewWeek, setViewWeek] = useState(weekIdxToday);
  useEffect(() => { setViewWeek(weekIdxToday); }, [weekIdxToday]);

  const paces = useMemo(() => paceSet(state.settings.fiveK), [state.settings.fiveK]);
  const toRace = daysBetween(today, RACE);

  /* resolve a workout with swaps applied */
  const getWorkout = useCallback((w, d) => {
    const base = PLAN[w].days[d];
    const key = `w${w}d${d}`;
    const sw = state.swaps[key];
    if (!sw) return base;
    if (sw.kind === "custom") {
      return { ...base, title: sw.title || "Custom session", type: "Custom", est: sw.est || "—",
        blocks: [{ h: "Session", items: (sw.text || "").split("\n").filter(Boolean) }], note: "", custom: true };
    }
    const alt = ALTS[base.slot]?.[sw.idx];
    return alt ? { ...base, ...alt, swapped: true } : base;
  }, [state.swaps]);

  /* resolve a meal with swaps applied */
  const mealFor = useCallback((w, d, kind) => {
    const key = `w${w}d${d}${kind}`;
    const ov = state.mealSwaps[key];
    if (ov) {
      if (typeof ov === "string" && MEAL_BY_ID[ov]) return MEAL_BY_ID[ov];
      if (ov.cheat) return { id: "cheat", name: ov.name || "Cheat meal", cal: 0, p: 0, c: 0, f: 0, cheat: true, time: "—", ing: "", how: "", shop: {} };
      if (ov.custom) return { ...ov, id: "custom", time: "—", ing: "", how: "", shop: {} };
    }
    if (w === 0 && WEEK1_FIXED[`${d}${kind}`]) return MEAL_BY_ID[WEEK1_FIXED[`${d}${kind}`]];
    if (kind === "lunch") return LUNCH_POOL[(w * 7 + d) % LUNCH_POOL.length];
    const lunchId = (w === 0 && WEEK1_FIXED[`${d}lunch`])
      ? WEEK1_FIXED[`${d}lunch`]
      : LUNCH_POOL[(w * 7 + d) % LUNCH_POOL.length].id;
    let i = (w * 7 + d + 6) % DINNER_POOL.length;
    if (DINNER_POOL[i].id === lunchId) i = (i + 1) % DINNER_POOL.length;
    return DINNER_POOL[i];
  }, [state.mealSwaps]);

  const cheatsThisWeek = useCallback((w) => {
    let n = 0;
    for (let d = 0; d < 7; d++) for (const k of ["lunch", "dinner"]) {
      const ov = state.mealSwaps[`w${w}d${d}${k}`];
      if (ov && ov.cheat) n++;
    }
    return n;
  }, [state.mealSwaps]);

  /* ---- interpolate {zone} tokens into pace strings ---- */
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, z) =>
    paces[z] ? `${mmss(paces[z])}/km (${mmss(paces[z] * 1.60934)}/mi)` : `{${z}}`);

  /* ---- swap UI state ---- */
  const [swapTarget, setSwapTarget] = useState(null);   // {w,d}
  const [mealTarget, setMealTarget] = useState(null);   // {w,d,kind}
  const [customText, setCustomText] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [cheatName, setCheatName] = useState("");
  const [mealCat, setMealCat] = useState("all");

  const applyAlt = (w, d, idx) =>
    update((s) => ({ ...s, swaps: { ...s.swaps, [`w${w}d${d}`]: { kind: "alt", idx } } }));
  const applyCustom = (w, d) =>
    update((s) => ({ ...s, swaps: { ...s.swaps, [`w${w}d${d}`]: { kind: "custom", title: customTitle, text: customText } } }));
  const resetSwap = (w, d) =>
    update((s) => { const n = { ...s.swaps }; delete n[`w${w}d${d}`]; return { ...s, swaps: n }; });
  const toggleDone = (w, d) =>
    update((s) => { const n = { ...s.done }; const k = `w${w}d${d}`; n[k] ? delete n[k] : (n[k] = true); return { ...s, done: n }; });

  const setMeal = (w, d, kind, val) =>
    update((s) => ({ ...s, mealSwaps: { ...s.mealSwaps, [`w${w}d${d}${kind}`]: val } }));
  const resetMeal = (w, d, kind) =>
    update((s) => { const n = { ...s.mealSwaps }; delete n[`w${w}d${d}${kind}`]; return { ...s, mealSwaps: n }; });
  const toggleMealDone = (w, d, kind) =>
    update((s) => { const n = { ...s.mealDone }; const k = `w${w}d${d}${kind}`; n[k] ? delete n[k] : (n[k] = true); return { ...s, mealDone: n }; });

  /* ---- completion stats ---- */
  const weekDone = (w) => DAY_NAMES.reduce((a, _, d) => a + (state.done[`w${w}d${d}`] ? 1 : 0), 0);
  const totalDone = Object.keys(state.done).length;

  if (!ready) return <div className="boot">Loading your plan…</div>;

  return (
    <div className="app">
      <style>{CSS}</style>

      {/* ---------- masthead ---------- */}
      <header className="mast">
        <div className="mast-l">
          <div className="eyebrow">Split Sheet</div>
          <h1>HYROX Dallas<span className="div">/</span>Men's Doubles</h1>
          <div className="sub">22 November 2026 · 13-week build</div>
        </div>
        <div className="mast-r">
          <div className="count">{Math.max(0, toRace)}</div>
          <div className="count-label">days out</div>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {[["today", "Today"], ["train", "Train"], ["fuel", "Fuel"], ["shop", "Shop"], ["metrics", "Metrics"], ["race", "Race"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id}
            className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {status && <div className="toast">{status}</div>}

      <main>
        {tab === "today" && (
          <TodayView
            {...{ weekIdxToday, dayIdxToday, getWorkout, fill, state, update, toggleDone,
                  setSwapTarget, mealFor, setMealTarget, toggleMealDone, paces, cheatsThisWeek, toRace }}
          />
        )}

        {tab === "train" && (
          <TrainView
            {...{ viewWeek, setViewWeek, getWorkout, fill, state, toggleDone, setSwapTarget,
                  weekIdxToday, dayIdxToday, weekDone, resetSwap, paces }}
          />
        )}

        {tab === "fuel" && (
          <FuelView
            {...{ viewWeek, setViewWeek, mealFor, setMealTarget, state, update, toggleMealDone,
                  cheatsThisWeek, weekIdxToday, dayIdxToday }}
          />
        )}

        {tab === "shop" && (
          <ShopView {...{ viewWeek, setViewWeek, mealFor, state, update, weekIdxToday }} />
        )}

        {tab === "metrics" && (
          <MetricsView {...{ state, update, totalDone, paces }} />
        )}

        {tab === "race" && <RaceView paces={paces} />}
      </main>

      {/* ---------- workout swap sheet ---------- */}
      <Sheet
        open={!!swapTarget}
        title="Replace this session"
        onClose={() => { setSwapTarget(null); setCustomText(""); setCustomTitle(""); }}
      >
        {swapTarget && (() => {
          const { w, d } = swapTarget;
          const base = PLAN[w].days[d];
          const alts = ALTS[base.slot] || [];
          const cur = state.swaps[`w${w}d${d}`];
          return (
            <>
              <div className="opt-group-label">Planned</div>
              <button className={`opt ${!cur ? "sel" : ""}`} onClick={() => { resetSwap(w, d); setSwapTarget(null); }}>
                <div className="opt-t">{base.title}</div>
                <div className="opt-s">{base.type} · {base.est}</div>
              </button>

              <div className="opt-group-label">Alternatives</div>
              {alts.map((a, i) => (
                <button key={i} className={`opt ${cur?.kind === "alt" && cur.idx === i ? "sel" : ""}`}
                  onClick={() => { applyAlt(w, d, i); setSwapTarget(null); }}>
                  <div className="opt-t">{a.title}</div>
                  <div className="opt-s">{a.type} · {a.est}</div>
                  {a.note && <div className="opt-n">{a.note}</div>}
                </button>
              ))}

              <div className="opt-group-label">Write your own</div>
              <input className="inp" placeholder="Session name" value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)} />
              <textarea className="inp ta" rows={4} placeholder="One line per item"
                value={customText} onChange={(e) => setCustomText(e.target.value)} />
              <button className="btn-primary" disabled={!customTitle && !customText}
                onClick={() => { applyCustom(w, d); setSwapTarget(null); setCustomText(""); setCustomTitle(""); }}>
                Use this session
              </button>
            </>
          );
        })()}
      </Sheet>

      {/* ---------- meal swap sheet ---------- */}
      <Sheet
        open={!!mealTarget}
        title={mealTarget ? `Replace ${mealTarget.kind}` : ""}
        onClose={() => { setMealTarget(null); setCheatName(""); }}
      >
        {mealTarget && (() => {
          const { w, d, kind } = mealTarget;
          const list = MEALS.filter((m) =>
            m.slots.includes(kind) &&
            (mealCat === "all" ? true : m.cat === mealCat));
          const cur = state.mealSwaps[`w${w}d${d}${kind}`];
          const used = cheatsThisWeek(w);
          return (
            <>
              <div className="catbar">
                {CATS.map(([id, label]) => (
                  <button key={id} className={`catchip ${mealCat === id ? "on" : ""}`}
                    onClick={() => setMealCat(id)}>{label}</button>
                ))}
              </div>
              {list.map((m) => (
                <button key={m.id} className={`opt ${cur === m.id ? "sel" : ""}`}
                  onClick={() => { setMeal(w, d, kind, m.id); setMealTarget(null); }}>
                  <div className="opt-t">{m.name}</div>
                  <div className="opt-s mono">{m.cal} kcal · {m.p} P · {m.c} C · {m.f} F · {m.time}</div>
                  {m.out && <div className="opt-n">{m.out}</div>}
                </button>
              ))}

              <div className="opt-group-label">
                Cheat meal <span className="mono dim">{used}/3 used this week</span>
              </div>
              {used >= 3 && !cur?.cheat && (
                <div className="warn">You've already booked three this week. Adding another puts you over.</div>
              )}
              <input className="inp" placeholder="What are you eating?" value={cheatName}
                onChange={(e) => setCheatName(e.target.value)} />
              <button className="btn-cheat"
                onClick={() => { setMeal(w, d, kind, { cheat: true, name: cheatName || "Cheat meal" }); setMealTarget(null); setCheatName(""); }}>
                Book as a cheat meal
              </button>

              <div className="opt-group-label">Reset</div>
              <button className="opt" onClick={() => { resetMeal(w, d, kind); setMealTarget(null); }}>
                <div className="opt-t">Back to the planned meal</div>
              </button>
            </>
          );
        })()}
      </Sheet>

      <footer className="foot">
        <p>Built for one athlete, one race. Update your 5K time in Metrics and every pace in the plan recalculates.</p>
      </footer>
    </div>
  );
}

/* ============================================================
   TODAY
   ============================================================ */
function TodayView({ weekIdxToday, dayIdxToday, getWorkout, fill, state, toggleDone,
  setSwapTarget, mealFor, setMealTarget, toggleMealDone, paces, cheatsThisWeek, toRace }) {
  const w = weekIdxToday, d = dayIdxToday;
  const wk = PLAN[w];
  const wo = getWorkout(w, d);
  const date = addDays(wk.start, d);
  const done = !!state.done[`w${w}d${d}`];
  const lunch = mealFor(w, d, "lunch");
  const dinner = mealFor(w, d, "dinner");

  const totals = [lunch, dinner, ...SHAKES, EXTRAS].reduce(
    (a, m) => ({ cal: a.cal + (m.cal || 0), p: a.p + (m.p || 0), c: a.c + (m.c || 0), f: a.f + (m.f || 0) }),
    { cal: 0, p: 0, c: 0, f: 0 });

  return (
    <>
      <section className="panel hero">
        <div className="hero-top">
          <div>
            <div className="eyebrow">Week {wk.n} · {wk.phase} · {DAY_NAMES[d]} {fmtShort(date)}</div>
            <h2 className="hero-title"><Mark>{wo.title}</Mark></h2>
            <div className="meta mono">{wo.type} · {wo.est}{wo.swapped ? " · swapped" : ""}{wo.custom ? " · your session" : ""}</div>
          </div>
          <button className={`check ${done ? "on" : ""}`} onClick={() => toggleDone(w, d)} aria-pressed={done}>
            {done ? "✓ Done" : "Mark done"}
          </button>
        </div>

        <div className="blocks">
          {wo.blocks.map((b, i) => (
            <div className="block" key={i}>
              <div className="block-h">{b.h}</div>
              <ul>{b.items.map((it, j) => <li key={j}>{fill(it)}</li>)}</ul>
            </div>
          ))}
        </div>

        {wo.note && <p className="note">{wo.note}</p>}

        <div className="row-actions">
          <button className="btn-ghost" onClick={() => setSwapTarget({ w, d })}>Replace this session</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">Today's paces</div>
        <div className="pace-grid">
          {["easy", "long", "race", "thr", "fivek", "vo2"].map((z) => (
            <div className="pace" key={z}>
              <div className="pace-z">{PACE_LABEL[z]}</div>
              <div className="pace-v mono">{mmss(paces[z])}<span>/km</span></div>
              <div className="pace-m mono">{mmss(paces[z] * 1.60934)}/mi</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">Eating today <span className="dim mono">{cheatsThisWeek(w)}/3 cheat meals booked</span></div>

        {[["lunch", lunch], ["dinner", dinner]].map(([kind, m]) => {
          const md = !!state.mealDone[`w${w}d${d}${kind}`];
          return (
            <div className={`meal ${m.cheat ? "cheat" : ""} ${md ? "eaten" : ""}`} key={kind}>
              <div className="meal-head">
                <div>
                  <div className="eyebrow">{kind}{m.cheat ? " · cheat meal" : ""}</div>
                  <div className="meal-name">{m.name}</div>
                  {!m.cheat && <div className="meal-macros mono">{m.cal} kcal · {m.p} P · {m.c} C · {m.f} F · {m.time}</div>}
                </div>
                <div className="meal-actions">
                  <button className={`check sm ${md ? "on" : ""}`} onClick={() => toggleMealDone(w, d, kind)}>{md ? "✓" : "Ate it"}</button>
                  <button className="btn-ghost sm" onClick={() => setMealTarget({ w, d, kind })}>Swap</button>
                </div>
              </div>
              {m.out && <div className="outnote">{m.out}</div>}
              {!m.cheat && m.ing && (
                <details className="recipe">
                  <summary>{m.cat === "out" ? "What to order" : "Ingredients & method"}</summary>
                  <p className="ing">{m.ing}</p>
                  <p className="how">{m.how}</p>
                </details>
              )}
            </div>
          );
        })}

        <div className="fixed-items">
          {SHAKES.map((s) => (
            <div className="fixed" key={s.id}>
              <span>{s.name}</span>
              <span className="mono">{s.cal} kcal · {s.p} P</span>
            </div>
          ))}
          <div className="fixed">
            <span>{EXTRAS.name}</span><span className="mono">{EXTRAS.cal} kcal</span>
          </div>
        </div>

        <div className="macro-grid">
          {[["Calories", totals.cal, TARGETS.cal, "kcal"], ["Protein", totals.p, TARGETS.p, "g"],
            ["Carbs", totals.c, TARGETS.c, "g"], ["Fat", totals.f, TARGETS.f, "g"]].map(([label, v, t, u]) => (
            <div className="macro" key={label}>
              <div className="macro-l">{label}</div>
              <div className="macro-v mono">{Math.round(v)}<span className="dim"> / {t} {u}</span></div>
              <Bar value={v} max={t} />
            </div>
          ))}
        </div>
        {(lunch.cheat || dinner.cheat) && (
          <p className="note">Cheat meals aren't counted above. Eat it, enjoy it, and get back on the plan at the next meal.</p>
        )}
      </section>
    </>
  );
}

/* ============================================================
   TRAIN
   ============================================================ */
function TrainView({ viewWeek, setViewWeek, getWorkout, fill, state, toggleDone,
  setSwapTarget, weekIdxToday, dayIdxToday, weekDone }) {
  const wk = PLAN[viewWeek];
  const [openDay, setOpenDay] = useState(viewWeek === weekIdxToday ? dayIdxToday : -1);
  useEffect(() => { setOpenDay(viewWeek === weekIdxToday ? dayIdxToday : -1); }, [viewWeek, weekIdxToday, dayIdxToday]);

  return (
    <>
      <section className="panel">
        <div className="weekstrip">
          {PLAN.map((p, i) => (
            <button key={i} className={`wchip ${i === viewWeek ? "on" : ""} ${i === weekIdxToday ? "now" : ""}`}
              onClick={() => setViewWeek(i)}>
              <span className="wn">{p.n}</span>
              <span className="wp">{p.phase}</span>
            </button>
          ))}
        </div>
        <div className="week-head">
          <div>
            <div className="eyebrow">{fmtShort(wk.start)} – {fmtShort(addDays(wk.start, 6))} · {wk.phase}</div>
            <h2 className="week-focus">{wk.focus}</h2>
          </div>
          <div className="week-prog mono">{weekDone(viewWeek)}/7</div>
        </div>
      </section>

      <section className="panel ladder">
        {wk.days.map((_, d) => {
          const wo = getWorkout(viewWeek, d);
          const done = !!state.done[`w${viewWeek}d${d}`];
          const open = openDay === d;
          const isToday = viewWeek === weekIdxToday && d === dayIdxToday;
          return (
            <div className={`rung ${open ? "open" : ""} ${done ? "done" : ""} ${isToday ? "today" : ""}`} key={d}>
              <button className="rung-head" onClick={() => setOpenDay(open ? -1 : d)} aria-expanded={open}>
                <span className="rung-day">{DAY_NAMES[d]}</span>
                <span className="rung-body">
                  <span className="rung-title">{wo.title}</span>
                  <span className="rung-meta mono">{wo.type} · {wo.est}{wo.swapped || wo.custom ? " · replaced" : ""}</span>
                </span>
                <span className="rung-caret">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="rung-detail">
                  <div className="blocks">
                    {wo.blocks.map((b, i) => (
                      <div className="block" key={i}>
                        <div className="block-h">{b.h}</div>
                        <ul>{b.items.map((it, j) => <li key={j}>{fill(it)}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                  {wo.note && <p className="note">{wo.note}</p>}
                  <div className="row-actions">
                    <button className={`check ${done ? "on" : ""}`} onClick={() => toggleDone(viewWeek, d)}>{done ? "✓ Done" : "Mark done"}</button>
                    <button className="btn-ghost" onClick={() => setSwapTarget({ w: viewWeek, d })}>Replace</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

/* ============================================================
   FUEL
   ============================================================ */
function FuelView({ viewWeek, setViewWeek, mealFor, setMealTarget, state, update,
  toggleMealDone, cheatsThisWeek, weekIdxToday }) {
  const wk = PLAN[viewWeek];
  const used = cheatsThisWeek(viewWeek);

  return (
    <>
      <section className="panel">
        <div className="panel-h">The numbers</div>
        <div className="target-row">
          {[["Calories", `${TARGETS.cal}`, "kcal/day"], ["Protein", `${TARGETS.p}`, "g/day"],
            ["Carbs", `${TARGETS.c}`, "g/day"], ["Fat", `${TARGETS.f}`, "g/day"]].map(([l, v, u]) => (
            <div className="target" key={l}>
              <div className="target-v mono">{v}</div>
              <div className="target-l">{l}<span className="dim"> {u}</span></div>
            </div>
          ))}
        </div>
        <p className="explain">
          Two meals, two scoops, one banana. That's a deficit of roughly 350 kcal against your training load —
          about 0.6 lb of fat a week, so 173 lb now lands near 165 lb on race day with your muscle intact.
          Protein is deliberately high because a deficit plus 13 weeks of hard sessions is exactly when lean mass leaves.
        </p>
        <p className="explain">
          Thirteen quick meals, three Indian ones, four restaurant builds. Every cooked meal clears 49 g of protein.
          The restaurant bowls don't — vegetarian fast-casual tops out near 35 g however you build it — so those days
          need a third scoop. Protein comes from paneer, tofu, cottage cheese, Greek yogurt, feta, halloumi, beans
          and chickpeas. No eggs, no soy protein, no mock meat.
        </p>
      </section>

      <section className="panel">
        <div className="weekstrip">
          {PLAN.map((p, i) => (
            <button key={i} className={`wchip ${i === viewWeek ? "on" : ""} ${i === weekIdxToday ? "now" : ""}`}
              onClick={() => setViewWeek(i)}>
              <span className="wn">{p.n}</span><span className="wp">{p.phase}</span>
            </button>
          ))}
        </div>
        <div className="week-head">
          <div>
            <div className="eyebrow">{fmtShort(wk.start)} – {fmtShort(addDays(wk.start, 6))}</div>
            <h2 className="week-focus">Week {wk.n} meals</h2>
          </div>
          <div className={`cheat-count mono ${used > 3 ? "over" : ""}`}>{used}/3 cheats</div>
        </div>
      </section>

      {wk.days.map((_, d) => {
        const lunch = mealFor(viewWeek, d, "lunch");
        const dinner = mealFor(viewWeek, d, "dinner");
        const day = [lunch, dinner, ...SHAKES, EXTRAS].reduce(
          (a, m) => ({ cal: a.cal + (m.cal || 0), p: a.p + (m.p || 0) }), { cal: 0, p: 0 });
        return (
          <section className="panel day-meals" key={d}>
            <div className="day-meals-h">
              <span className="rung-day">{DAY_NAMES[d]}</span>
              <span className="mono dim">{Math.round(day.cal)} kcal · {Math.round(day.p)} g protein</span>
            </div>
            {[["lunch", lunch], ["dinner", dinner]].map(([kind, m]) => {
              const md = !!state.mealDone[`w${viewWeek}d${d}${kind}`];
              return (
                <div className={`meal compact ${m.cheat ? "cheat" : ""} ${md ? "eaten" : ""}`} key={kind}>
                  <div className="meal-head">
                    <div>
                      <div className="eyebrow">{kind}{m.cheat ? " · cheat" : ""}</div>
                      <div className="meal-name">{m.name}</div>
                      {!m.cheat && <div className="meal-macros mono">{m.cal} kcal · {m.p} P · {m.c} C · {m.f} F · {m.time}</div>}
                    </div>
                    <div className="meal-actions">
                      <button className={`check sm ${md ? "on" : ""}`} onClick={() => toggleMealDone(viewWeek, d, kind)}>{md ? "✓" : "Ate it"}</button>
                      <button className="btn-ghost sm" onClick={() => setMealTarget({ w: viewWeek, d, kind })}>Swap</button>
                    </div>
                  </div>
                  {m.out && <div className="outnote">{m.out}</div>}
                  {!m.cheat && m.ing && (
                    <details className="recipe">
                      <summary>{m.cat === "out" ? "What to order" : "Ingredients & method"}</summary>
                      <p className="ing">{m.ing}</p>
                      <p className="how">{m.how}</p>
                    </details>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}


/* ============================================================
   SHOP
   ============================================================ */
function aggregate(mealsList) {
  const totals = {};
  for (const m of mealsList) {
    if (!m || !m.shop) continue;
    for (const [k, v] of Object.entries(m.shop)) {
      if (!ITEMS[k]) continue;
      totals[k] = (totals[k] || 0) + v;
    }
  }
  return totals;
}

function formatQty(id, qty) {
  const it = ITEMS[id];
  const n = Math.ceil(qty);
  const base = it.unit ? `${n} ${it.unit}` : `${n}`;
  if (it.pack && qty > 0) {
    const packs = Math.ceil(qty / it.pack);
    return `${base}  ·  ${packs} × ${it.pack}${it.unit || ""}`;
  }
  return base;
}

function ShopList({ totals, weekKey, state, update, title, sub }) {
  const byAisle = {};
  for (const id of Object.keys(totals)) {
    const a = ITEMS[id].aisle;
    (byAisle[a] = byAisle[a] || []).push(id);
  }
  const ids = Object.keys(totals);
  const gotCount = ids.filter((id) => state.shop?.[`${weekKey}:${id}`]).length;

  const toggle = (id) => update((s) => {
    const shop = { ...(s.shop || {}) };
    const k = `${weekKey}:${id}`;
    shop[k] ? delete shop[k] : (shop[k] = true);
    return { ...s, shop };
  });

  if (ids.length === 0) return null;

  return (
    <section className="panel">
      <div className="panel-h">{title}<span className="dim mono">{gotCount}/{ids.length} in the cart</span></div>
      {sub && <p className="explain">{sub}</p>}
      {AISLES.filter((a) => byAisle[a]).map((a) => (
        <div className="aisle" key={a}>
          <div className="aisle-h">{a}</div>
          {byAisle[a].sort((x, y) => ITEMS[x].label.localeCompare(ITEMS[y].label)).map((id) => {
            const got = !!state.shop?.[`${weekKey}:${id}`];
            return (
              <button className={`shop-row ${got ? "got" : ""}`} key={id} onClick={() => toggle(id)}
                aria-pressed={got}>
                <span className="box">{got ? "✓" : ""}</span>
                <span className="shop-l">{ITEMS[id].label}</span>
                <span className="shop-q mono">{formatQty(id, totals[id])}</span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function ShopView({ viewWeek, setViewWeek, mealFor, state, update, weekIdxToday }) {
  const wk = PLAN[viewWeek];
  const mealsFor = (days) => days.flatMap((d) => [mealFor(viewWeek, d, "lunch"), mealFor(viewWeek, d, "dinner")]);

  const isShopWeek = viewWeek === 0;
  const early = isShopWeek ? aggregate(mealsFor([0, 1, 2])) : null;
  const main = aggregate(mealsFor(isShopWeek ? [3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6]));
  // staples ride with the main shop
  for (const [k, v] of Object.entries(STAPLES)) main[k] = (main[k] || 0) + v;

  const eatingOut = mealsFor([0, 1, 2, 3, 4, 5, 6]).filter((m) => m.cat === "out").length;
  const cheats = mealsFor([0, 1, 2, 3, 4, 5, 6]).filter((m) => m.cheat).length;

  return (
    <>
      <section className="panel">
        <div className="weekstrip">
          {PLAN.map((p, i) => (
            <button key={i} className={`wchip ${i === viewWeek ? "on" : ""} ${i === weekIdxToday ? "now" : ""}`}
              onClick={() => setViewWeek(i)}>
              <span className="wn">{p.n}</span><span className="wp">{p.phase}</span>
            </button>
          ))}
        </div>
        <div className="week-head">
          <div>
            <div className="eyebrow">{fmtShort(wk.start)} – {fmtShort(addDays(wk.start, 6))}</div>
            <h2 className="week-focus">Week {wk.n} shop</h2>
          </div>
        </div>
        <p className="explain">
          Built from the fourteen meals currently on your Fuel tab for this week. Swap a meal there and this list
          updates. {eatingOut > 0 && `${eatingOut} meal${eatingOut > 1 ? "s are" : " is"} out, `}
          {cheats > 0 && `${cheats} cheat meal${cheats > 1 ? "s" : ""} booked, `}
          so neither needs buying.
        </p>
      </section>

      {isShopWeek && (
        <ShopList totals={early} weekKey={`w${viewWeek}early`} state={state} update={update}
          title="Grab today"
          sub="Monday and Tuesday are eating out, so this is a corner-shop run, not a full trip. Everything below covers you through Wednesday." />
      )}

      <ShopList totals={main} weekKey={`w${viewWeek}main`} state={state} update={update}
        title={isShopWeek ? "Main shop — do this Wednesday" : "This week's shop"}
        sub={isShopWeek
          ? "Covers Thursday through Sunday, when the cooking properly starts. Do it once, on Wednesday evening."
          : "One trip. Quantities are for two meals a day, seven days."} />

      <section className="panel">
        <div className="panel-h">Worth batching</div>
        <div className="blocks">
          <div className="block">
            <div className="block-h">Sunday, 40 minutes</div>
            <ul>
              <li>Cook a big pot of rice — it carries three or four meals.</li>
              <li>Rinse and drain every can you'll open this week; store in one tub.</li>
              <li>Chop onions, peppers and cucumber. Half the meals become assembly jobs.</li>
            </ul>
          </div>
          <div className="block">
            <div className="block-h">Buy the big tubs</div>
            <ul>
              <li>Greek yogurt and cottage cheese are in nearly every meal. The 1 kg tubs are half the price per gram.</li>
              <li>Paneer and halloumi freeze well. Buy several, freeze what you won't use in four days.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

/* ============================================================
   METRICS
   ============================================================ */
const BENCHMARKS = [
  { id: "fivek", label: "5 km run", unit: "mm:ss", start: "34:00", goal: "29:30" },
  { id: "ski", label: "1000 m SkiErg", unit: "mm:ss", start: "—", goal: "4:20" },
  { id: "row", label: "1000 m Row", unit: "mm:ss", start: "—", goal: "4:05" },
  { id: "wb", label: "Wall balls unbroken", unit: "reps", start: "—", goal: "30" },
  { id: "sled", label: "50 m sled push @ 152 kg", unit: "mm:ss", start: "—", goal: "1:15" },
  { id: "farm", label: "200 m farmers @ 2×24 kg", unit: "mm:ss", start: "—", goal: "1:40" },
  { id: "bbj", label: "80 m burpee broad jump", unit: "mm:ss", start: "—", goal: "4:30" },
];

function SyncPanel() {
  const [id, setId] = useState(SYNC_ID);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}?id=${SYNC_ID}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked — the field below is selectable */ }
  };

  return (
    <section className="panel">
      <div className="panel-h">
        Sync
        <span className="dim mono">{syncEnabled ? "cloud on" : "this device only"}</span>
      </div>
      {!syncEnabled ? (
        <p className="explain">
          No cloud credentials are set, so everything lives in this browser. Add your Supabase URL and anon key
          to the environment and redeploy to sync across devices.
        </p>
      ) : (
        <>
          <p className="explain">
            Open this link on your phone once and both devices share the same data. Treat it like a password —
            anyone with it can read and edit your log.
          </p>
          <input className="inp mono" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn-primary" onClick={copy}>{copied ? "Copied" : "Copy sync link"}</button>
          <div className="opt-group-label">Or paste an ID from another device</div>
          <input className="inp mono" value={id} onChange={(e) => setId(e.target.value)} />
          <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }}
            onClick={() => { setSyncId(id); location.reload(); }}>
            Switch to this ID
          </button>
        </>
      )}
    </section>
  );
}

function MetricsView({ state, update, totalDone, paces }) {
  const [form, setForm] = useState({ date: iso(new Date()), weight: "", bf: "", rhr: "", fiveK: "", note: "" });

  const addLog = () => {
    const entry = {
      date: form.date,
      weight: form.weight ? Number(form.weight) : null,
      bf: form.bf ? Number(form.bf) : null,
      rhr: form.rhr ? Number(form.rhr) : null,
      fiveK: form.fiveK || null,
      note: form.note || "",
    };
    update((s) => {
      const logs = [...s.logs.filter((l) => l.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date));
      let settings = { ...s.settings };
      if (entry.weight) settings.weight = entry.weight;
      if (entry.bf) settings.bf = entry.bf;
      if (entry.fiveK) {
        const [m, sec] = entry.fiveK.split(":").map(Number);
        if (!isNaN(m) && !isNaN(sec)) settings.fiveK = m * 60 + sec;
      }
      return { ...s, logs, settings };
    });
    setForm({ date: iso(new Date()), weight: "", bf: "", rhr: "", fiveK: "", note: "" });
  };

  const removeLog = (date) => update((s) => ({ ...s, logs: s.logs.filter((l) => l.date !== date) }));

  const chartData = state.logs.filter((l) => l.weight || l.bf).map((l) => ({
    date: l.date.slice(5), weight: l.weight, bf: l.bf,
  }));

  const first = state.logs.find((l) => l.weight);
  const last = [...state.logs].reverse().find((l) => l.weight);
  const delta = first && last ? (last.weight - first.weight).toFixed(1) : null;

  return (
    <>
      <section className="panel">
        <div className="panel-h">Where you are</div>
        <div className="target-row">
          <div className="target"><div className="target-v mono">{state.settings.weight}</div><div className="target-l">Weight<span className="dim"> lb</span></div></div>
          <div className="target"><div className="target-v mono">{state.settings.bf}</div><div className="target-l">Body fat<span className="dim"> %</span></div></div>
          <div className="target"><div className="target-v mono">{mmss(state.settings.fiveK)}</div><div className="target-l">5K<span className="dim"> current</span></div></div>
          <div className="target"><div className="target-v mono">{totalDone}</div><div className="target-l">Sessions<span className="dim"> done</span></div></div>
        </div>
        {delta && <p className="explain">Since your first log: <strong>{delta > 0 ? "+" : ""}{delta} lb</strong>.</p>}
        <p className="explain">
          Your 5K time drives every pace in the plan. Retest it in weeks 4, 8 and 12 — log it here and the whole
          programme recalculates around the new number.
        </p>
      </section>

      <section className="panel">
        <div className="panel-h">Log today</div>
        <div className="form-grid">
          <label>Date<input className="inp" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label>Weight (lb)<input className="inp" inputMode="decimal" placeholder="173" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></label>
          <label>Body fat (%)<input className="inp" inputMode="decimal" placeholder="26" value={form.bf} onChange={(e) => setForm({ ...form, bf: e.target.value })} /></label>
          <label>Resting HR<input className="inp" inputMode="numeric" placeholder="58" value={form.rhr} onChange={(e) => setForm({ ...form, rhr: e.target.value })} /></label>
          <label>5K test (mm:ss)<input className="inp" placeholder="34:00" value={form.fiveK} onChange={(e) => setForm({ ...form, fiveK: e.target.value })} /></label>
          <label className="wide">Note<input className="inp" placeholder="How did it feel?" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        <button className="btn-primary" onClick={addLog}>Save entry</button>
      </section>

      <section className="panel">
        <div className="panel-h">Weight & body fat</div>
        {chartData.length < 2 ? (
          <p className="empty">Log two entries and the trend appears here.</p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#CDD1C7" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6E736C" }} axisLine={{ stroke: "#CDD1C7" }} tickLine={false} />
                <YAxis yAxisId="l" domain={["dataMin - 3", "dataMax + 3"]} tick={{ fontSize: 11, fill: "#6E736C" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 11, fill: "#6E736C" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#FBFBF8", border: "1px solid #16191A", borderRadius: 0, fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="weight" name="Weight (lb)" stroke="#1F3B2C" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="bf" name="Body fat (%)" stroke="#B4441F" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-h">Station benchmarks</div>
        <p className="explain">Test these in week 2, then again in weeks 7 and 11. Goals are what a 1:40 doubles finish looks like.</p>
        <div className="bench">
          {BENCHMARKS.map((b) => (
            <div className="bench-row" key={b.id}>
              <div className="bench-l">{b.label}</div>
              <input className="inp bench-i mono" placeholder="—" value={state.prs[b.id] || ""}
                onChange={(e) => update((s) => ({ ...s, prs: { ...s.prs, [b.id]: e.target.value } }))} />
              <div className="bench-g mono dim">goal {b.goal}</div>
            </div>
          ))}
        </div>
      </section>

      <SyncPanel />

      <section className="panel">
        <div className="panel-h">History</div>
        {state.logs.length === 0 ? (
          <p className="empty">Nothing logged yet. Start with today's weight.</p>
        ) : (
          <div className="hist">
            {[...state.logs].reverse().map((l) => (
              <div className="hist-row" key={l.date}>
                <span className="mono">{l.date}</span>
                <span className="mono">
                  {l.weight ? `${l.weight} lb` : ""}{l.bf ? ` · ${l.bf}%` : ""}{l.rhr ? ` · ${l.rhr} bpm` : ""}{l.fiveK ? ` · 5K ${l.fiveK}` : ""}
                </span>
                <span className="hist-note">{l.note}</span>
                <button className="x sm" onClick={() => removeLog(l.date)} aria-label="Delete entry">✕</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ============================================================
   RACE
   ============================================================ */
const RACE_ORDER = [
  { k: "run", n: 1, label: "Run 1", d: "1000 m" },
  { k: "st", label: "SkiErg", d: "1000 m", split: "Split however you like — 500/500 works" },
  { k: "run", n: 2, label: "Run 2", d: "1000 m" },
  { k: "st", label: "Sled Push", d: "50 m · 152 kg", split: "25 m each, or whoever's fresher takes 30" },
  { k: "run", n: 3, label: "Run 3", d: "1000 m" },
  { k: "st", label: "Sled Pull", d: "50 m · 103 kg", split: "25 m each" },
  { k: "run", n: 4, label: "Run 4", d: "1000 m" },
  { k: "st", label: "Burpee Broad Jumps", d: "80 m", split: "Swap every 10 m — short turns keep the pace up" },
  { k: "run", n: 5, label: "Run 5", d: "1000 m" },
  { k: "st", label: "Row", d: "1000 m", split: "500/500" },
  { k: "run", n: 6, label: "Run 6", d: "1000 m" },
  { k: "st", label: "Farmers Carry", d: "200 m · 2×24 kg", split: "100 m each, or 50 m turns if grip goes" },
  { k: "run", n: 7, label: "Run 7", d: "1000 m" },
  { k: "st", label: "Sandbag Lunges", d: "100 m · 30 kg", split: "Swap every 25 m" },
  { k: "run", n: 8, label: "Run 8", d: "1000 m" },
  { k: "st", label: "Wall Balls", d: "100 reps · 6 kg to 10 ft", split: "Sets of 10–15 alternating. Never go to failure." },
];

function RaceView({ paces }) {
  return (
    <>
      <section className="panel">
        <div className="panel-h">The race</div>
        <p className="explain">
          Men's doubles: you both run all eight kilometres together, and you split every station however you want.
          Nothing is fixed except that the work gets done. The runs are where doubles teams lose time — not the stations.
        </p>
        <div className="target-row">
          <div className="target"><div className="target-v mono">1:35–1:45</div><div className="target-l">Target finish</div></div>
          <div className="target"><div className="target-v mono">{mmss(paces.race)}</div><div className="target-l">Run pace<span className="dim"> /km</span></div></div>
          <div className="target"><div className="target-v mono">8 km</div><div className="target-l">Total running</div></div>
          <div className="target"><div className="target-v mono">~35 min</div><div className="target-l">Station time</div></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">Split sheet</div>
        <div className="race-ladder">
          {RACE_ORDER.map((r, i) => (
            <div className={`race-row ${r.k}`} key={i}>
              <div className="race-i mono">{String(i + 1).padStart(2, "0")}</div>
              <div className="race-body">
                <div className="race-label">{r.k === "run" ? `Run ${r.n}` : r.label}</div>
                <div className="race-d mono">{r.d}</div>
                {r.split && <div className="race-split">{r.split}</div>}
              </div>
              {r.k === "run" && <div className="race-target mono">{mmss(paces.race)}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">How to run it</div>
        <div className="blocks">
          <div className="block">
            <div className="block-h">First two kilometres</div>
            <ul>
              <li>Go out 15 seconds per kilometre <em>slower</em> than target. Everyone goes out too hard; the field will pull you.</li>
              <li>If you feel good at run 5, that's when you spend it.</li>
            </ul>
          </div>
          <div className="block">
            <div className="block-h">The roxzone</div>
            <ul>
              <li>Keep moving. Walking the transitions costs a doubles team three to five minutes across a race.</li>
              <li>Agree your split before you enter the station, not while you're standing in it.</li>
            </ul>
          </div>
          <div className="block">
            <div className="block-h">Where it goes wrong</div>
            <ul>
              <li>Sled push: low hips, short choppy steps, keep the sled moving. Stopping is what kills you.</li>
              <li>Wall balls: this is the last station and everyone blows up here. Small sets from rep one.</li>
              <li>Burpee broad jumps: pace it like a run, not a sprint. It comes before three more kilometres.</li>
            </ul>
          </div>
          <div className="block">
            <div className="block-h">Fuelling on the day</div>
            <ul>
              <li>Three hours out: rice or oats, a banana, half a shake. Nothing new.</li>
              <li>30 minutes out: 200 ml electrolyte, then stop drinking.</li>
              <li>Gel or dates at run 4 if the wave is late morning.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

/* ============================================================
   STYLE — "Split Sheet": cool grey stock, condensed bib type,
   one fluorescent highlighter mark.
   ============================================================ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');

.app {
  --stock:#E7E9E2; --card:#FBFBF8; --ink:#15181A; --muted:#6E736C;
  --rule:#CDD1C7; --deep:#1F3B2C; --mark:#D6FF3D; --alert:#B4441F;
  --display:'Barlow Condensed','Arial Narrow',sans-serif;
  --body:'Inter',system-ui,-apple-system,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono',monospace;
  background: var(--stock); color: var(--ink);
  font-family: var(--body); font-size: 15px; line-height: 1.5;
  min-height: 100vh; padding: 0 0 64px;
  -webkit-font-smoothing: antialiased;
}
.app *, .app *::before, .app *::after { box-sizing: border-box; }
.boot { padding: 40px; font-family: 'Inter', sans-serif; color: #6E736C; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.dim { color: var(--muted); font-weight: 400; }

/* masthead */
.mast {
  display:flex; justify-content:space-between; align-items:flex-end; gap:16px;
  padding: 26px 20px 18px; max-width: 980px; margin: 0 auto;
  border-bottom: 2px solid var(--ink);
}
.eyebrow {
  font-family: var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.14em; font-size:11px; color: var(--muted);
}
.mast h1 {
  font-family: var(--display); font-weight:700; text-transform:uppercase;
  font-size: clamp(28px, 7vw, 46px); line-height:.94; letter-spacing:-.005em;
  margin: 4px 0 6px;
}
.mast h1 .div { color: var(--muted); margin: 0 .3em; font-weight:500; }
.mast .sub { font-size:12.5px; color: var(--muted); }
.mast-r { text-align:right; flex-shrink:0; }
.count {
  font-family: var(--display); font-weight:700; font-size: clamp(44px,12vw,72px);
  line-height:.82; letter-spacing:-.02em;
  background: linear-gradient(transparent 62%, var(--mark) 62%, var(--mark) 92%, transparent 92%);
  padding: 0 .06em;
}
.count-label {
  font-family: var(--display); text-transform:uppercase; letter-spacing:.14em;
  font-size:11px; color: var(--muted); margin-top:4px;
}

/* tabs */
.tabs {
  display:flex; gap:2px; max-width:980px; margin:0 auto; padding: 0 12px;
  position:sticky; top:0; z-index:20; background: var(--stock);
  border-bottom:1px solid var(--rule); overflow-x:auto; scrollbar-width:none;
}
.tabs::-webkit-scrollbar { display:none; }
.tab {
  appearance:none; background:none; border:0; cursor:pointer;
  font-family: var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.1em; font-size:13px; color: var(--muted);
  padding: 14px 12px 12px; border-bottom:3px solid transparent; white-space:nowrap;
}
.tab.on { color: var(--ink); border-bottom-color: var(--ink); }
.tab:focus-visible, .app button:focus-visible, .app input:focus-visible,
.app textarea:focus-visible, .app summary:focus-visible {
  outline: 2px solid var(--deep); outline-offset: 2px;
}

main { max-width: 980px; margin: 0 auto; padding: 16px 12px 0; }

/* panels */
.panel {
  background: var(--card); border:1px solid var(--rule);
  padding: 18px 16px; margin-bottom: 12px;
}
.panel-h {
  font-family: var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.12em; font-size:12px; color: var(--ink);
  padding-bottom:8px; margin-bottom:14px; border-bottom:1px solid var(--rule);
  display:flex; justify-content:space-between; align-items:baseline; gap:10px;
}
.hero { border-color: var(--ink); border-width: 2px; }
.hero-top { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; flex-wrap:wrap; }
.hero-title {
  font-family: var(--display); font-weight:700; text-transform:uppercase;
  font-size: clamp(24px,6vw,38px); line-height:1.02; margin:6px 0 8px; letter-spacing:-.005em;
}
.mark {
  background: linear-gradient(transparent 58%, var(--mark) 58%, var(--mark) 94%, transparent 94%);
  padding: 0 .08em;
}
.meta { font-size:11.5px; color: var(--muted); text-transform:uppercase; letter-spacing:.08em; }

/* blocks */
.blocks { margin-top:16px; display:grid; gap:14px; }
.block { border-left:2px solid var(--rule); padding-left:12px; }
.block-h {
  font-family: var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.12em; font-size:11px; color: var(--muted); margin-bottom:5px;
}
.block ul { margin:0; padding-left:16px; }
.block li { margin: 3px 0; font-size:14.5px; }
.note {
  margin-top:14px; padding:11px 13px; background: var(--stock);
  border-left:3px solid var(--deep); font-size:14px; color:#2C312D;
}
.explain { font-size:14px; color:#3A403B; margin: 0 0 12px; }
.empty { font-size:14px; color: var(--muted); font-style:italic; margin:0; }
.warn {
  font-size:13.5px; color: var(--alert); border:1px dashed var(--alert);
  padding:9px 11px; margin-bottom:10px;
}

/* buttons */
.row-actions { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
.check, .btn-ghost, .btn-primary, .btn-cheat {
  font-family: var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.1em; font-size:12.5px; cursor:pointer; padding:10px 16px;
  border:1.5px solid var(--ink); background: var(--card); color: var(--ink);
  transition: background .12s, color .12s;
}
.check:hover, .btn-ghost:hover { background: var(--mark); }
.check.on { background: var(--deep); border-color: var(--deep); color:#F4F7F2; }
.check.sm, .btn-ghost.sm { padding:6px 10px; font-size:11px; letter-spacing:.08em; }
.btn-primary {
  background: var(--deep); border-color: var(--deep); color:#F4F7F2; width:100%; margin-top:10px;
}
.btn-primary:disabled { opacity:.4; cursor:not-allowed; }
.btn-cheat { border-style:dashed; width:100%; margin-top:8px; }
.btn-cheat:hover { background: var(--mark); }
.x { background:none; border:0; font-size:15px; cursor:pointer; color: var(--muted); padding:4px 6px; }
.x:hover { color: var(--alert); }

/* pace grid */
.pace-grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(96px,1fr)); gap:1px; background: var(--rule); border:1px solid var(--rule); }
.pace { background: var(--card); padding:10px 8px; }
.pace-z { font-family: var(--display); text-transform:uppercase; letter-spacing:.1em; font-size:10.5px; color: var(--muted); }
.pace-v { font-size:19px; font-weight:600; margin-top:2px; }
.pace-v span { font-size:11px; color: var(--muted); font-weight:400; }
.pace-m { font-size:11px; color: var(--muted); }

/* week strip */
.weekstrip { display:flex; gap:4px; overflow-x:auto; padding-bottom:10px; margin-bottom:14px; scrollbar-width:none; }
.weekstrip::-webkit-scrollbar { display:none; }
.wchip {
  flex:0 0 auto; border:1px solid var(--rule); background: var(--card); cursor:pointer;
  padding:6px 9px; display:flex; flex-direction:column; align-items:center; min-width:48px;
}
.wchip .wn { font-family:var(--display); font-weight:700; font-size:17px; line-height:1; }
.wchip .wp { font-family:var(--display); text-transform:uppercase; letter-spacing:.08em; font-size:8.5px; color:var(--muted); margin-top:2px; }
.wchip.now { border-color: var(--deep); }
.wchip.on { background: var(--mark); border-color: var(--ink); }
.week-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.week-focus { font-family:var(--display); font-weight:600; font-size:clamp(19px,4.5vw,26px); line-height:1.1; margin:4px 0 0; text-transform:uppercase; }
.week-prog { font-family:var(--display); font-weight:700; font-size:22px; flex-shrink:0; }
.cheat-count { font-family:var(--display); font-weight:700; font-size:16px; flex-shrink:0; }
.cheat-count.over { color: var(--alert); }

/* ladder */
.ladder { padding: 0; }
.rung { border-bottom:1px solid var(--rule); }
.rung:last-child { border-bottom:0; }
.rung-head {
  width:100%; display:flex; align-items:center; gap:12px; padding:13px 16px;
  background:none; border:0; cursor:pointer; text-align:left;
}
.rung-head:hover { background: var(--stock); }
.rung-day {
  font-family:var(--display); font-weight:700; text-transform:uppercase;
  letter-spacing:.08em; font-size:13px; width:34px; flex-shrink:0; color:var(--muted);
}
.rung-body { flex:1; min-width:0; }
.rung-title { display:block; font-family:var(--display); font-weight:600; font-size:17px; text-transform:uppercase; line-height:1.15; }
.rung-meta { display:block; font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-top:2px; }
.rung-caret { font-family:var(--mono); color:var(--muted); font-size:17px; flex-shrink:0; }
.rung.today .rung-day { color: var(--ink); }
.rung.today .rung-title { background: linear-gradient(transparent 60%, var(--mark) 60%, var(--mark) 94%, transparent 94%); display:inline; }
.rung.done .rung-title, .rung.done .rung-day { color: var(--muted); }
.rung.done .rung-head::after { content:'✓'; color: var(--deep); font-weight:700; }
.rung-detail { padding: 0 16px 18px; }
.rung.open { background: var(--card); }

/* meals */
.meal { border:1px solid var(--rule); padding:12px 13px; margin-bottom:8px; }
.meal:last-child { margin-bottom:0; }
.meal.cheat { border-style:dashed; border-color: var(--alert); }
.meal.eaten { background: var(--stock); }
.meal-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.meal-name { font-family:var(--display); font-weight:600; font-size:18px; text-transform:uppercase; line-height:1.12; margin:2px 0 3px; }
.meal-macros { font-size:11.5px; color:var(--muted); }
.meal-actions { display:flex; gap:6px; flex-shrink:0; }
.recipe { margin-top:9px; border-top:1px solid var(--rule); padding-top:8px; }
.recipe summary {
  cursor:pointer; font-family:var(--display); text-transform:uppercase;
  letter-spacing:.1em; font-size:11px; color:var(--muted);
}
.recipe .ing { font-size:13px; color:#3A403B; margin:8px 0 6px; }
.recipe .how { font-size:13.5px; margin:0; }
.day-meals { padding:14px 14px; }
.day-meals-h { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; }
.fixed-items { margin-top:12px; border-top:1px solid var(--rule); padding-top:10px; }
.fixed { display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:3px 0; color:#3A403B; }

/* macros */
.macro-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-top:16px; }
.macro-l { font-family:var(--display); text-transform:uppercase; letter-spacing:.1em; font-size:10.5px; color:var(--muted); }
.macro-v { font-size:19px; font-weight:600; }
.macro-v span { font-size:12px; }
.bar { margin-top:5px; }
.bar-track { height:6px; background: var(--stock); border:1px solid var(--rule); }
.bar-fill { height:100%; background: var(--deep); }

/* targets */
.target-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:1px; background:var(--rule); border:1px solid var(--rule); margin-bottom:14px; }
.target { background:var(--card); padding:11px 10px; }
.target-v { font-family:var(--display); font-weight:700; font-size:26px; line-height:1; }
.target-l { font-family:var(--display); text-transform:uppercase; letter-spacing:.09em; font-size:10.5px; color:var(--ink); margin-top:4px; }

/* forms */
.form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
.form-grid label, .toggle { font-family:var(--display); text-transform:uppercase; letter-spacing:.1em; font-size:10.5px; color:var(--muted); display:block; }
.form-grid label.wide { grid-column:1/-1; }
.inp {
  width:100%; margin-top:4px; padding:9px 10px; border:1px solid var(--rule);
  background:#fff; font-family:var(--body); font-size:14.5px; color:var(--ink); border-radius:0;
}
.inp:focus { border-color:var(--ink); }
.ta { resize:vertical; margin-top:8px; }
.toggle { display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12px; }
.toggle input { width:16px; height:16px; accent-color: var(--deep); }

/* sheet options */
.opt-group-label { font-family:var(--display); text-transform:uppercase; letter-spacing:.12em; font-size:11px; color:var(--muted); margin:16px 0 7px; display:flex; justify-content:space-between; }
.opt-group-label:first-child { margin-top:0; }
.opt { display:block; width:100%; text-align:left; background:var(--card); border:1px solid var(--rule); padding:11px 12px; margin-bottom:6px; cursor:pointer; }
.opt:hover { border-color:var(--ink); }
.opt.sel { border-color:var(--ink); background:var(--mark); }
.opt-t { font-family:var(--display); font-weight:600; font-size:16px; text-transform:uppercase; line-height:1.15; }
.opt-s { font-family:var(--mono); font-size:11px; color:var(--muted); margin-top:2px; }
.opt-n { font-size:12.5px; color:#3A403B; margin-top:5px; }

.outnote {
  margin-top:8px; font-size:12.5px; color:#3A403B;
  border-left:3px solid var(--alert); padding:6px 10px; background:var(--stock);
}
.catbar { display:flex; gap:4px; margin-bottom:12px; flex-wrap:wrap; }
.catchip {
  font-family:var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.1em; font-size:11px; padding:7px 12px; cursor:pointer;
  border:1px solid var(--rule); background:var(--card); color:var(--muted);
}
.catchip.on { background:var(--mark); border-color:var(--ink); color:var(--ink); }

/* shop */
.aisle { margin-bottom:16px; }
.aisle:last-child { margin-bottom:0; }
.aisle-h {
  font-family:var(--display); font-weight:600; text-transform:uppercase;
  letter-spacing:.12em; font-size:11px; color:var(--muted);
  border-bottom:1px solid var(--rule); padding-bottom:5px; margin-bottom:4px;
}
.shop-row {
  display:flex; align-items:center; gap:10px; width:100%; text-align:left;
  background:none; border:0; border-bottom:1px solid var(--rule); cursor:pointer;
  padding:9px 2px; font-family:var(--body); font-size:14.5px; color:var(--ink);
}
.shop-row:last-child { border-bottom:0; }
.shop-row:hover { background:var(--stock); }
.box {
  width:18px; height:18px; border:1.5px solid var(--ink); flex-shrink:0;
  display:flex; align-items:center; justify-content:center; font-size:12px; line-height:1;
}
.shop-row.got .box { background:var(--deep); border-color:var(--deep); color:#F4F7F2; }
.shop-row.got .shop-l { color:var(--muted); text-decoration:line-through; }
.shop-l { flex:1; min-width:0; }
.shop-q { font-size:11.5px; color:var(--muted); flex-shrink:0; text-align:right; }

/* benchmarks & history */
.bench-row { display:grid; grid-template-columns:1fr 90px 90px; gap:8px; align-items:center; padding:7px 0; border-bottom:1px solid var(--rule); }
.bench-row:last-child { border-bottom:0; }
.bench-l { font-size:14px; }
.bench-i { text-align:center; padding:6px; margin:0; }
.bench-g { font-size:11px; text-align:right; }
.hist-row { display:grid; grid-template-columns:82px 1fr auto 26px; gap:8px; align-items:center; padding:7px 0; border-bottom:1px solid var(--rule); font-size:12px; }
.hist-row:last-child { border-bottom:0; }
.hist-note { color:var(--muted); font-size:12px; }

/* race ladder */
.race-ladder { border-top:1px solid var(--rule); }
.race-row { display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--rule); }
.race-row.run { background: linear-gradient(90deg, var(--stock) 0%, transparent 70%); }
.race-i { font-family:var(--display); font-weight:700; font-size:14px; color:var(--muted); width:24px; flex-shrink:0; padding-top:2px; }
.race-body { flex:1; }
.race-label { font-family:var(--display); font-weight:600; font-size:17px; text-transform:uppercase; line-height:1.1; }
.race-d { font-size:11.5px; color:var(--muted); }
.race-split { font-size:13px; margin-top:4px; color:#3A403B; }
.race-target { font-family:var(--display); font-weight:700; font-size:16px; flex-shrink:0; padding-top:2px; }

/* sheet */
.sheet-wrap { position:fixed; inset:0; background:rgba(21,24,26,.5); z-index:100; display:flex; align-items:flex-end; justify-content:center; }
.sheet { background:var(--stock); width:100%; max-width:560px; max-height:88vh; display:flex; flex-direction:column; border:2px solid var(--ink); border-bottom:0; }
.sheet-head { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:2px solid var(--ink); background:var(--card); }
.sheet-head h3 { font-family:var(--display); font-weight:700; text-transform:uppercase; letter-spacing:.06em; font-size:19px; margin:0; }
.sheet-body { overflow-y:auto; padding:16px; }

.toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:var(--deep); color:#F4F7F2; font-family:var(--display); text-transform:uppercase; letter-spacing:.1em; font-size:11.5px; padding:9px 16px; z-index:200; }
.foot { max-width:980px; margin:0 auto; padding:20px 16px; }
.foot p { font-size:12.5px; color:var(--muted); margin:0; }

@media (min-width:720px) { .sheet-wrap { align-items:center; } .sheet { border-bottom:2px solid var(--ink); } }
@media (prefers-reduced-motion: reduce) { .app * { transition:none !important; animation:none !important; } }
`;
