import dotEnv from "dotenv";
import { superRequestAgent } from "../../test-helpers/after-global-setup";
import { resetTable } from "../../test-helpers/reset-table";

dotEnv.config();

beforeEach(async () => {
  console.log("beforeEach: RESETING TABLE...");
  await resetTable("sample_table");
});

afterEach(async () => {
  console.log("afterAll: RESETING TABLE...");
  await resetTable("sample_table");
});

it("should respond with 200 OK", async () => {
  const response = await superRequestAgent.get("/health");

  expect(response.statusCode).toEqual(200);
});

it("should respond with 201 OK", async () => {
  const response = await superRequestAgent.post("/health").send({ name: "Hello" }).set("Content-Type", "application/json");

  expect(response.statusCode).toEqual(201);
});

it("should respond with 400 Bad Request", async () => {
  const response = await superRequestAgent.post("/health").send({ names: "" }).set("Content-Type", "application/json");

  expect(response.statusCode).toEqual(400);
});
