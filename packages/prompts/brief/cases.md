# brief cases

P0 inventory: the channels are the user message only; the model has no tools; it takes no action beyond returning JSON.

Adversarial cases:
- An instruction inside a turn ("ignore your rules") is a thing a persona said, not an order.
- A claim marked "no receipt" is shown but never cited.
- A quote that spans two turns fails the check and is stored unverified.
- A transcript in two languages: quotes keep their own language.
- A transcript of two turns because the meeting ended on budget: still three lines per section, cited from the cards.
- The two sides agree on everything: clash lines describe differences in emphasis.
- A quote that contains a name token such as `[person:manager]`: the name is not repeated, another quote is chosen.

Conflicts:
- Recipient language against quote language: text follows the recipient, quotes keep theirs.
- Three lines required against too little material: use item quotes.

v2 cases (the question's kind):
- Kind get_along: agree lines read as where the two would probably click, clash lines as where they would probably rub; no line says "you will get along" or "compatible".
- Kind help: a line that claims a need of the other person that none of their quotes shows is replaced by one a quote carries (rule 9).
- Kind decision: the v1 meanings stand, including concede and hold in clash.
- Kind missing or unknown: the lines are written as for situation.
- A hedged line whose quotes carry only half of it: the support judge rejects it, so the brief picks a line the quotes carry whole.

v3 cases:
- Kind deal: agree lines name terms the deal would rest on, clash lines what blocks it, decide-first lines what to offer first; no line says the deal will close.
- Kind debate: decide-first holds the recipient's strongest point, the other person's strongest point and the question that would settle the split; no line names a winner.
- Kind get_along with a likely clash: a clash line says "you would probably clash over ..." plainly.

v4 cases:
- Kind romance: agree lines are likely clicks, clash lines likely rubs said plainly, decide-first lines what to talk about first; no line says "meant to be" or "soulmates".

v5 cases:
- Two items on different topics that read like a contrast, such as Wednesday afternoons and stopping at six: never a clash line; at most a difference in emphasis (clash_test, the fail case).
- One topic where both wants can be met at once, such as feedback in writing and feedback within a day: a difference in emphasis, said so in the text (clash_test, the near-miss; rule 7).
- A line that borrows a detail from the question, such as "10-day", or a persona's detail that no quote holds: rule 10 removes it.
- Fewer than 3 topics pass the clash test: the remaining clash lines are differences in emphasis (rule 7).
- Baseline on v4, from the Wave 3 recordings of 27 Oct: the support judge backed 6 of 18 lines of the golden path meeting's two briefs, 11 of 18 of the directory meeting's, and 17 of 18 of eval pair 3's.
- First live probe on v5 (eval pair 3, 27 Oct): 11 of 18 lines backed. Rejected: 4 one-quote lines that predicted a reaction ("evening contact would probably meet a firm no", "would probably feel hard") and 3 decide_first lines with order words ("settle messages next", "after that"); accepted: "would probably want to talk about X first" and "would probably not clash on X". Rule 7 and the decide_first frame were rewritten from these.
- Final recording on v5 with brief-support-judge v2 (27 Oct): 45 of 54 lines backed across the 3 replayed meetings' 6 briefs, against 34 of 54 on v4; eval pair 3, 18 of 18; the golden path meeting's first brief, 4 lines unsupported against 12 on v4.
