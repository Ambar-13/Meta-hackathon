import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, quizView } from "../../testing/fixtures.js";
import { QuizScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

// Renders the quiz page for the fixture quiz.
function renderQuiz(): void {
  renderScreen(<QuizScreen />, { pattern: ROUTE_PATTERNS.quiz, url: APP_PATHS.quiz(IDS.quiz) });
}

describe("quiz screen", () => {
  it("R4.2-T1: the form stays locked while the persona answers and no persona answer shows before submitting", async () => {
    stubRoute(routes.cards.readQuiz, quizView("answering"));
    renderQuiz();
    expect(await screen.findByText("Your agent answers first. The form opens when it is done.")).toBeTruthy();
    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(10);
    for (const box of boxes) {
      expect(box.hasAttribute("disabled")).toBe(true);
    }
    expect(screen.queryByText(/^Your agent:/)).toBeNull();
  });

  it("R4.3-T1: each answer allows 200 characters and Send waits for all 10", async () => {
    stubRoute(routes.cards.readQuiz, [quizView("waiting_human"), quizView("judging")]);
    stubRoute(routes.cards.answerQuiz, { status: 202, body: { state: "judging" } });
    renderQuiz();
    const boxes = await screen.findAllByRole("textbox");
    for (const [index, box] of boxes.entries()) {
      if (index < 9) fireEvent.change(box, { target: { value: `answer ${String(index + 1)}` } });
    }
    const send = screen.getByRole("button", { name: "Send my answers" });
    expect(send.hasAttribute("disabled")).toBe(true);
    const last = boxes[9];
    if (last === undefined) throw new Error("the quiz has no tenth box");
    fireEvent.change(last, { target: { value: "answer 10" } });
    expect(send.hasAttribute("disabled")).toBe(false);
    for (const box of boxes) {
      expect(box.getAttribute("maxlength")).toBe("200");
    }
    fireEvent.click(send);
    await waitFor(() => {
      expect(requestsTo(routes.cards.answerQuiz)).toHaveLength(1);
    });
    const answers = (requestsTo(routes.cards.answerQuiz)[0]?.body as { answers: unknown[] }).answers;
    expect(answers).toHaveLength(10);
    expect(answers[0]).toEqual({ position: 1, text: "answer 1" });
  });

  it("D31-T1: the result shows the server's copy as sent and no percent sign", async () => {
    stubRoute(routes.cards.readQuiz, quizView("judged"));
    renderQuiz();
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("matched 7 of 10");
    expect(document.body.textContent).not.toContain("%");
    expect(screen.getByText("Your agent: Persona answer 1")).toBeTruthy();
    expect(screen.getAllByText("Matched")).toHaveLength(7);
    expect(screen.getAllByText("Did not match")).toHaveLength(3);
  });

  it("R4.2-T2: every control on the quiz page has an accessible name at 375 px", async () => {
    stubRoute(routes.cards.readQuiz, quizView("waiting_human"));
    renderQuiz();
    await screen.findAllByRole("textbox");
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
