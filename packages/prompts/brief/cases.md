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
