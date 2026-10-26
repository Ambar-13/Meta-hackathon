# comic-image: inventory and test set

Status: draft. 3 cases specified, 0 runs recorded.

## Inventory
- Principal: the render_comic job, which fills this template once per panel and sends the result as the image prompt.
- Channel, data: the style prefix and the two avatar descriptors from the fixed list, the panel number, and the panel's image prompt from the comic-panels reply.
- Tools: none. Output: one image, so there is no schema.

## Test set
| # | Case | What must hold |
|---|---|---|
| 1 | An avatar descriptor with a comma ("owl with round glasses" has none; a test value adds one) | the sentence still reads as "A is ..." and the scrubber passes it |
| 2 | An image prompt that ends without a full stop | the template adds the next sentence on its own line |
| 3 | An image prompt with an email address | the scrubber finds it, the job refuses the comic, and no image call is made |

Case 3 is checked by the render_comic test that refuses a prompt before any image call.
