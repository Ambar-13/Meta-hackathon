import { seededSample } from "./seeded-sample.js";

// The fixed quiz bank version, R4.7. A new bank is a new version, never an edit.
export const QUIZ_BANK_VERSION = 1;
// The 30 quiz questions, ids 1 to 30, drafted for the Wave 0 review (D28, no input lists them).
export const QUIZ_BANK: ReadonlyArray<{ id: number; text: string }> = [
  { id: 1, text: "What do you do when a plan you cared about falls apart?" },
  { id: 2, text: "How do you prefer to get bad news: straight away, or with context first?" },
  { id: 3, text: "What kind of work makes you lose track of time?" },
  { id: 4, text: "When a teammate misses a deadline, what do you do first?" },
  { id: 5, text: "How do you decide between two options that both look fine?" },
  { id: 6, text: "What is a boundary you hold at work that others sometimes push on?" },
  { id: 7, text: "How much structure do you want in a week: a fixed plan, or room to move?" },
  { id: 8, text: "What do you need from a collaborator before you trust them with something hard?" },
  { id: 9, text: "When you disagree with someone senior, what do you do?" },
  { id: 10, text: "What do you do on a day when nothing is going right?" },
  { id: 11, text: "Do you prefer to finish one thing before starting the next, or keep several moving?" },
  { id: 12, text: "What makes you say no to an otherwise good opportunity?" },
  { id: 13, text: "How do you like to be thanked, if at all?" },
  { id: 14, text: "What do you do when you realise you were wrong in front of others?" },
  { id: 15, text: "How late is too late to message you about work?" },
  { id: 16, text: "What do you want to be known for in five years?" },
  { id: 17, text: "Do you think out loud or come back with a finished view?" },
  { id: 18, text: "What is a habit you keep even when nobody is checking?" },
  { id: 19, text: "How do you handle a task you find boring but necessary?" },
  { id: 20, text: "What is the first thing you look at when judging someone else's work?" },
  { id: 21, text: "How do you want feedback delivered: in writing, in person, or either?" },
  { id: 22, text: "What would make you leave a project you had committed to?" },
  { id: 23, text: "Do you prefer to lead, to follow a clear lead, or to share the wheel?" },
  { id: 24, text: "What is something you are trying to get better at right now?" },
  { id: 25, text: "How do you react when someone changes a plan at the last minute?" },
  { id: 26, text: "What kind of question do you most enjoy being asked?" },
  { id: 27, text: "How do you split credit when a team wins?" },
  { id: 28, text: "What do you do in the first hour of a free day?" },
  { id: 29, text: "What topic do you avoid at work, and why?" },
  { id: 30, text: "If a project could only have one of speed, quality or low cost, which would you give up?" },
];
// How many bank questions one quiz asks, D28.
export const QUIZ_SAMPLE_SIZE = 10;
// Picks 10 distinct bank ids for a card, seeded by the card id so the same card always gets the same 10 (D28).
// The seed is the card id's text in lower case, as Postgres writes a uuid; seeded-sample.ts has the rule.
export function sampleQuiz(cardId: string): number[] {
  return seededSample(cardId.toLowerCase(), QUIZ_SAMPLE_SIZE, QUIZ_BANK.length);
}
